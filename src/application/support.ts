// application/support — сервис и поддержка (тикет-система) в кабинете:
// заявки на ремонт, техподдержку и обслуживание + переписка по тикету.
// Видимость: клиент видит заявки своей компании, сервисный партнёр — назначенные
// на него и открытые рынком, внутренний сотрудник платформы — все.

import { getContainer } from '@/infrastructure/container';
import { DomainError, errForbidden, errNotFound } from '@/shared/errors';
import { hasPermission, isCleared } from '@/shared/permissions';
import { isInternal, roleBucket } from '@/application/cabinet-view';
import { optionalList, requireModule014 } from '@/application/module-014';
import type { SupportTicket, TicketMessage, TicketPriority, TicketStatus, Viewer } from '@/domain';

export type TicketRow = SupportTicket & {
  assetName: string | null;
  companyName: string | null;
  /** Просрочен SLA (или срок истекает в ближайшие сутки). */
  slaOverdue: boolean;
  slaSoon: boolean;
  isMine: boolean;
};

export type TicketScope = 'all' | 'mine' | 'assigned';

export async function listTickets(viewer: Viewer, scope: TicketScope = 'all'): Promise<TicketRow[]> {
  // Таблиц 014 может ещё не быть в PostgreSQL — модуль молча пустой.
  return optionalList(() => listTicketsInner(viewer, scope), 'заявки сервиса');
}

async function listTicketsInner(viewer: Viewer, scope: TicketScope): Promise<TicketRow[]> {
  const { deps } = getContainer();
  const bucket = roleBucket(viewer);
  const internal = isInternal(viewer);

  let rows: SupportTicket[] = [];
  if (internal) {
    rows = await deps.support.listAll();
  } else if (!viewer.companyId) {
    rows = [];
  } else if (bucket === 'service' && scope !== 'mine') {
    // сервисный партнёр: свои заявки + назначенные лично
    const [own, assigned] = await Promise.all([
      deps.support.listForCompany(viewer.companyId),
      deps.support.listAssigned(viewer.userId),
    ]);
    rows = [...own];
    for (const t of assigned) if (!rows.some((r) => r.id === t.id)) rows.push(t);
  } else {
    rows = await deps.support.listForCompany(viewer.companyId);
  }

  const now = Date.now();
  const out: TicketRow[] = [];
  for (const t of rows) {
    const [asset, company] = await Promise.all([
      t.asset ? deps.assets.findById(t.asset) : Promise.resolve(null),
      t.company ? deps.companies.findById(t.company) : Promise.resolve(null),
    ]);
    const due = t.sla_due_at ? t.sla_due_at.getTime() : null;
    const open = t.status !== 'resolved' && t.status !== 'closed';
    out.push({
      ...t,
      assetName: asset?.name ?? null,
      companyName: company?.company_name ?? null,
      slaOverdue: Boolean(open && due !== null && due < now),
      slaSoon: Boolean(open && due !== null && due >= now && due - now < 24 * 3600 * 1000),
      isMine: viewer.companyId !== null && t.company === viewer.companyId,
    });
  }
  return out.sort((a, b) => {
    const rank = (t: TicketRow) => (t.slaOverdue ? 0 : t.status === 'new' ? 1 : t.status === 'in_progress' ? 2 : 3);
    return rank(a) - rank(b) || b.created.getTime() - a.created.getTime();
  });
}

export type TicketDetail = {
  ticket: SupportTicket;
  messages: TicketMessage[];
  assetName: string | null;
  assetIdentifier: string | null;
  companyName: string | null;
  /** Авторы сообщений: id → имя (для подписи). */
  senderNames: Record<string, string>;
  slaOverdue: boolean;
};

export async function getTicketDetail(viewer: Viewer, id: string): Promise<TicketDetail | null> {
  return requireModule014(() => getTicketDetailInner(viewer, id), 'Карточка заявки');
}

async function getTicketDetailInner(viewer: Viewer, id: string): Promise<TicketDetail | null> {
  const { deps } = getContainer();
  const ticket = await deps.support.findById(id);
  if (!ticket) return null;
  const [messages, asset, company] = await Promise.all([
    deps.support.listMessages(id),
    ticket.asset ? deps.assets.findById(ticket.asset) : Promise.resolve(null),
    ticket.company ? deps.companies.findById(ticket.company) : Promise.resolve(null),
  ]);
  const senderNames: Record<string, string> = {};
  for (const m of messages) {
    if (m.sender && !senderNames[m.sender]) {
      const u = await deps.users.findById(m.sender);
      senderNames[m.sender] = u?.name ?? u?.email ?? 'Пользователь';
    }
  }
  return {
    ticket,
    messages,
    assetName: asset?.name ?? null,
    assetIdentifier: asset?.identifier ?? null,
    companyName: company?.company_name ?? null,
    senderNames,
    slaOverdue: Boolean(
      ticket.sla_due_at &&
        ticket.status !== 'resolved' &&
        ticket.status !== 'closed' &&
        ticket.sla_due_at.getTime() < Date.now(),
    ),
  };
}

export type NewTicketInput = {
  title: string;
  kind: SupportTicket['kind'];
  priority: TicketPriority;
  description: string;
  asset: string | null;
  product: string | null;
};

/** Заявка клиента или сервисного партнёра: SLA — 24 ч (критично) / 72 ч. */
export async function createTicket(viewer: Viewer, input: NewTicketInput): Promise<string> {
  return requireModule014(() => createTicketInner(viewer, input), 'Новая заявка');
}

async function createTicketInner(viewer: Viewer, input: NewTicketInput): Promise<string> {
  if (!input.title.trim()) throw new DomainError(400, 'Тема заявки обязательна');
  const { deps } = getContainer();
  const hours = input.priority === 'critical' ? 4 : input.priority === 'high' ? 24 : 72;
  return deps.support.create(
    {
      title: input.title.trim(),
      company: viewer.companyId,
      asset: input.asset,
      product: input.product,
      kind: input.kind,
      priority: input.priority,
      description: input.description.trim() || null,
      slaDueAt: new Date(Date.now() + hours * 3600 * 1000),
    },
    viewer,
  );
}

/** Сообщение в тикете; внутренние комментарии видны только своим (не клиенту). */
export async function addTicketMessage(
  viewer: Viewer,
  ticketId: string,
  text: string,
  internalComment = false,
): Promise<string> {
  return requireModule014(
    () => addTicketMessageInner(viewer, ticketId, text, internalComment),
    'Сообщение по заявке',
  );
}

async function addTicketMessageInner(
  viewer: Viewer,
  ticketId: string,
  text: string,
  internalComment: boolean,
): Promise<string> {
  if (!text.trim()) throw new DomainError(400, 'Текст сообщения обязателен');
  const { deps } = getContainer();
  const ticket = await deps.support.findById(ticketId);
  if (!ticket) throw errNotFound('Заявка');
  const canSeeAll = isInternal(viewer) || roleBucket(viewer) === 'service';
  const isMyTicket = viewer.companyId !== null && ticket.company === viewer.companyId;
  if (!canSeeAll && !isMyTicket) throw errForbidden('Заявка другой компании');
  // внутренние пометки ставит только исполнитель (сервис/платформа)
  const flag = internalComment && canSeeAll;
  return deps.support.addMessage(ticketId, text.trim(), flag, viewer);
}

/** Смена статуса заявки исполнителем. */
export async function setTicketStatus(viewer: Viewer, ticketId: string, status: TicketStatus): Promise<void> {
  return requireModule014(() => setTicketStatusInner(viewer, ticketId, status), 'Статус заявки');
}

async function setTicketStatusInner(viewer: Viewer, ticketId: string, status: TicketStatus): Promise<void> {
  const { deps } = getContainer();
  const ticket = await deps.support.findById(ticketId);
  if (!ticket) throw errNotFound('Заявка');
  const canSeeAll = isInternal(viewer) || roleBucket(viewer) === 'service';
  const isMyTicket = viewer.companyId !== null && ticket.company === viewer.companyId;
  if (!canSeeAll && !isMyTicket) throw errForbidden('Заявка другой компании');
  if (!hasPermission(viewer, 'assets_manage') && !canSeeAll) {
    throw errForbidden('Менять статус может сервисный инженер (assets_manage)');
  }
  await deps.support.updateStatus(ticketId, status, viewer);
}

/** Служебная проверка допуска к заявке (используется блоками кабинета). */
export function canSeeTicket(viewer: Viewer, ticket: SupportTicket): boolean {
  if (isInternal(viewer)) return true;
  return isCleared(viewer, ticket.min_clearance);
}
