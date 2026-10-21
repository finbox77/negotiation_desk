// application/negotiation-desk — сводка столов переговоров для шапки кабинета.
//
// Кнопка стола переговоров стоит рядом с названием раздела и всегда на виду:
// на ней видно, сколько сообщений пришло. Полноценный стол (окна, документы,
// звонки) разрабатывается отдельно — здесь только лента поступившего.

import { getContainer } from '@/infrastructure/container';
import { isCleared } from '@/shared/permissions';
import type { Viewer } from '@/domain';

export type DeskMessage = {
  id: string;
  author: string;
  text: string;
  at: string;
  /** Пришло недавно и не от меня. */
  fresh: boolean;
};

/**
 * Цвет кружка на кнопке стола:
 *  none   — серый: нового ничего нет;
 *  team   — жёлтый: пишут свои, сотрудники компании или партнёры (вендор,
 *           дилер, сервис, банк, логистика);
 *  client — зелёный: пишет клиент, такое сообщение важнее внутреннего.
 */
export type DeskSignal = 'none' | 'team' | 'client';

export type DeskTable = {
  id: string;
  title: string;
  status: string;
  participants: number;
  fresh: number;
  /** Кто написал в этот стол последним из «новых». */
  signal: DeskSignal;
  last: DeskMessage | null;
};

export type NegotiationDeskData = {
  tables: DeskTable[];
  /** Сколько сообщений пришло (не от меня, за последние трое суток). */
  fresh: number;
  /** Сколько из них — от клиентов. */
  freshFromClients: number;
  /** Итоговый цвет кружка на кнопке. */
  signal: DeskSignal;
};

const STATUS_LABEL: Record<string, string> = {
  open: 'открыт',
  waiting_platform: 'ждёт платформу',
  resolved: 'решён',
  closed: 'закрыт',
};

const FRESH_WINDOW_MS = 72 * 3600 * 1000;

const fmt = (d: Date): string =>
  `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * Кем автор сообщения приходится смотрящему.
 * Клиент — сотрудник чужой компании с ролью заказчика. Остальные — свои и партнёры.
 * Кэш живёт в пределах одной сборки сводки: на список из 12 столов хватает.
 */
function makeOriginResolver(viewer: Viewer): (userId: string) => Promise<DeskSignal> {
  const { deps } = getContainer();
  const origins = new Map<string, DeskSignal>();

  return async (userId: string): Promise<DeskSignal> => {
    const cached = origins.get(userId);
    if (cached) return cached;
    let origin: DeskSignal = 'team';
    try {
      const author = await deps.users.findById(userId);
      if (author?.company_id && author.company_id !== viewer.companyId) {
        const company = await deps.companies.findById(author.company_id);
        if (company?.company_type.includes('client')) origin = 'client';
      }
    } catch {
      origin = 'team';
    }
    origins.set(userId, origin);
    return origin;
  };
}

export async function getNegotiationDesk(viewer: Viewer): Promise<NegotiationDeskData> {
  const { deps } = getContainer();
  try {
    const rows = await deps.negotiations.listForUser(viewer.userId);
    const now = Date.now();
    const names = new Map<string, string>();
    const originOf = makeOriginResolver(viewer);

    const tables: DeskTable[] = [];
    let fresh = 0;
    let freshFromClients = 0;

    for (const t of rows.slice(0, 12)) {
      const [participants, messages] = await Promise.all([
        deps.negotiations.listParticipants(t.id),
        deps.negotiations.listMessages(t.id),
      ]);
      const visible = messages.filter((m) => isCleared(viewer, m.required_clearance));
      const incoming = visible.filter((m) => m.sender !== viewer.userId && now - m.created.getTime() < FRESH_WINDOW_MS);
      fresh += incoming.length;

      let tableSignal: DeskSignal = 'none';
      for (const m of incoming) {
        const origin = await originOf(m.sender);
        if (origin === 'client') {
          freshFromClients += 1;
          tableSignal = 'client';
        } else if (tableSignal === 'none') {
          tableSignal = 'team';
        }
      }

      const lastRaw = visible[visible.length - 1] ?? null;
      let last: DeskMessage | null = null;
      if (lastRaw) {
        let author = names.get(lastRaw.sender);
        if (author === undefined) {
          const u = await deps.users.findById(lastRaw.sender);
          author = u?.name ?? 'участник';
          names.set(lastRaw.sender, author);
        }
        last = {
          id: lastRaw.id,
          author,
          text: lastRaw.text ?? (lastRaw.message_type === 'file' ? 'приложен файл' : 'системное событие'),
          at: fmt(lastRaw.created),
          fresh: lastRaw.sender !== viewer.userId && now - lastRaw.created.getTime() < FRESH_WINDOW_MS,
        };
      }

      tables.push({
        id: t.id,
        title: t.title,
        status: STATUS_LABEL[t.status] ?? t.status,
        participants: participants.length,
        fresh: incoming.length,
        signal: tableSignal,
        last,
      });
    }

    tables.sort((a, b) => b.fresh - a.fresh);
    return {
      tables,
      fresh,
      freshFromClients,
      signal: freshFromClients > 0 ? 'client' : fresh > 0 ? 'team' : 'none',
    };
  } catch {
    return { tables: [], fresh: 0, freshFromClients: 0, signal: 'none' };
  }
}

/* ============================================================================
 * Снимок стола для отдельного приложения (apps/negotiation-desk).
 *
 * Отличие от getNegotiationDesk выше: это не короткая витрина для кнопки в
 * шапке кабинета, а полный контракт PWA — типы спора, контекст сделки, число
 * сообщений и ISO-даты. Ключи — camelCase: приложение живёт отдельно и не
 * должно зависеть от snake_case колонок БД.
 * ========================================================================== */

export type DeskTableSnapshot = {
  id: string;
  title: string;
  disputeType: string;
  status: string;
  statusLabel: string;
  dealId: string | null;
  productId: string | null;
  environmentId: string | null;
  participants: number;
  messages: number;
  fresh: number;
  signal: DeskSignal;
  last: {
    id: string;
    author: string;
    text: string;
    createdAt: string;
    fresh: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type DeskSnapshot = {
  viewer: {
    id: string;
    name: string | null;
    clearanceLevel: number;
    companyId: string | null;
  };
  tables: DeskTableSnapshot[];
  totals: {
    tables: number;
    fresh: number;
    freshFromClients: number;
    signal: DeskSignal;
  };
};

export async function getNegotiationDeskSnapshot(viewer: Viewer): Promise<DeskSnapshot> {
  const { deps } = getContainer();
  const snapshot: DeskSnapshot = {
    viewer: {
      id: viewer.userId,
      name: viewer.name,
      clearanceLevel: viewer.clearanceLevel,
      companyId: viewer.companyId,
    },
    tables: [],
    totals: { tables: 0, fresh: 0, freshFromClients: 0, signal: 'none' },
  };

  try {
    const rows = await deps.negotiations.listForUser(viewer.userId);
    const now = Date.now();
    const originOf = makeOriginResolver(viewer);
    const names = new Map<string, string>();

    async function authorName(userId: string): Promise<string> {
      const cached = names.get(userId);
      if (cached !== undefined) return cached;
      const user = await deps.users.findById(userId);
      const name = user?.name ?? 'участник';
      names.set(userId, name);
      return name;
    }

    const tables: DeskTableSnapshot[] = [];
    let fresh = 0;
    let freshFromClients = 0;

    for (const t of rows) {
      const [participants, messages] = await Promise.all([
        deps.negotiations.listParticipants(t.id),
        deps.negotiations.listMessages(t.id),
      ]);
      const visible = messages.filter((m) => isCleared(viewer, m.required_clearance));
      const incoming = visible.filter(
        (m) => m.sender !== viewer.userId && now - m.created.getTime() < FRESH_WINDOW_MS,
      );

      let tableSignal: DeskSignal = 'none';
      for (const m of incoming) {
        const origin = await originOf(m.sender);
        if (origin === 'client') {
          freshFromClients += 1;
          tableSignal = 'client';
        } else if (tableSignal === 'none') {
          tableSignal = 'team';
        }
      }
      fresh += incoming.length;

      const lastRaw = visible[visible.length - 1] ?? null;
      const last = lastRaw
        ? {
            id: lastRaw.id,
            author: await authorName(lastRaw.sender),
            text:
              lastRaw.text ??
              (lastRaw.message_type === 'file' ? 'приложен файл' : 'системное событие'),
            createdAt: lastRaw.created.toISOString(),
            fresh:
              lastRaw.sender !== viewer.userId &&
              now - lastRaw.created.getTime() < FRESH_WINDOW_MS,
          }
        : null;

      tables.push({
        id: t.id,
        title: t.title,
        disputeType: t.dispute_type,
        status: t.status,
        statusLabel: STATUS_LABEL[t.status] ?? t.status,
        dealId: t.deal,
        productId: t.product,
        environmentId: t.environment,
        participants: participants.length,
        messages: visible.length,
        fresh: incoming.length,
        signal: tableSignal,
        last,
        createdAt: t.created.toISOString(),
        updatedAt: t.updated.toISOString(),
      });
    }

    tables.sort(
      (a, b) =>
        b.fresh - a.fresh ||
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
        Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );

    snapshot.tables = tables;
    snapshot.totals = {
      tables: tables.length,
      fresh,
      freshFromClients,
      signal: freshFromClients > 0 ? 'client' : fresh > 0 ? 'team' : 'none',
    };
    return snapshot;
  } catch (e) {
    console.warn(
      '[simonix] стол переговоров: сводка недоступна —',
      e instanceof Error ? e.message : e,
    );
    return snapshot;
  }
}
