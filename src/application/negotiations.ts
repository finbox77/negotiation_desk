// application/negotiations — стол переговоров: окна, участники, сообщения с допуском.

import { getContainer } from '@/infrastructure/container';
import { errForbidden, errNotFound } from '@/shared/errors';
import { isCleared } from '@/shared/permissions';
import type {
  NegotiationMessage,
  NegotiatingTable,
  ParticipantRole,
  Viewer,
} from '@/domain';

export type NegotiationWithParticipants = NegotiatingTable & {
  participantCount: number;
};

export async function listNegotiationsFor(viewer: Viewer): Promise<NegotiationWithParticipants[]> {
  const { deps } = getContainer();
  const tables = await deps.negotiations.listForUser(viewer.userId);
  const withCounts = await Promise.all(
    tables.map(async (t) => {
      const participants = await deps.negotiations.listParticipants(t.id);
      return { ...t, participantCount: participants.length };
    }),
  );
  return withCounts;
}

export async function getNegotiationFor(viewer: Viewer, id: string): Promise<NegotiatingTable> {
  const { deps } = getContainer();
  const table = await deps.negotiations.findById(id);
  if (!table) throw errNotFound('Окно переговоров');
  const participants = await deps.negotiations.listParticipants(id);
  const isInitiator = table.initiator_user === viewer.userId;
  const isParticipant = participants.some((p) => p.user_id === viewer.userId);
  if (!isInitiator && !isParticipant) {
    throw errForbidden('Доступно только участникам этого окна (initiator/respondent/participants)');
  }
  return table;
}

export type MessageWithMeta = NegotiationMessage & {
  senderName: string | null;
  visibleDocuments: number;
};

/* ============================================================================
 * Карточка стола для отдельного приложения (apps/negotiation-desk).
 * Участники — с именами и компаниями, чтобы PWA не делала N запросов к /users.
 * ========================================================================== */

export type NegotiationParticipantView = {
  userId: string;
  name: string;
  role: ParticipantRole;
  companyId: string | null;
  companyName: string | null;
  isInitiator: boolean;
};

/** Контекст стола человекочитаемо: приложение не должно показывать голые id. */
export type NegotiationCardContext = {
  deal: { id: string; dealType: string; status: string; totalAmount: number } | null;
  product: { id: string; title: string } | null;
  environment: { id: string; name: string } | null;
};

export type NegotiationCard = {
  table: NegotiatingTable;
  participants: NegotiationParticipantView[];
  context: NegotiationCardContext;
  /** Сколько сообщений видит смотрящий (с учётом допуска). */
  messageCount: number;
};

export async function getNegotiationCard(
  viewer: Viewer,
  id: string,
): Promise<NegotiationCard> {
  const table = await getNegotiationFor(viewer, id); // проверка участия
  const { deps } = getContainer();
  const [participants, messages, deal, product, environment] = await Promise.all([
    deps.negotiations.listParticipants(id),
    deps.negotiations.listMessages(id).catch(() => []),
    table.deal ? deps.deals.findById(table.deal).catch(() => null) : null,
    table.product ? deps.products.findById(table.product).catch(() => null) : null,
    table.environment ? deps.environments.findById(table.environment).catch(() => null) : null,
  ]);

  const rows = participants.map((p) => ({
    userId: p.user_id,
    role: p.participant_role,
    companyId: p.company_id,
  }));
  // Триггер 010 обычно заводит инициатора сам, но старые столы могли его не иметь.
  if (!rows.some((p) => p.userId === table.initiator_user)) {
    rows.unshift({
      userId: table.initiator_user,
      role: 'initiator' as ParticipantRole,
      companyId: table.initiator_company,
    });
  }

  const views = await Promise.all(
    rows.map(async (p) => {
      const [user, company] = await Promise.all([
        deps.users.findById(p.userId).catch(() => null),
        p.companyId ? deps.companies.findById(p.companyId).catch(() => null) : null,
      ]);
      return {
        userId: p.userId,
        name: user?.name ?? 'участник',
        role: p.role,
        companyId: p.companyId,
        companyName: company?.company_name ?? null,
        isInitiator: p.userId === table.initiator_user,
      };
    }),
  );

  return {
    table,
    participants: views,
    context: {
      deal: deal
        ? {
            id: deal.id,
            dealType: deal.deal_type,
            status: deal.status,
            totalAmount: deal.total_amount,
          }
        : null,
      product: product ? { id: product.id, title: product.title } : null,
      environment: environment ? { id: environment.id, name: environment.name } : null,
    },
    messageCount: messages.filter((m) => isCleared(viewer, m.required_clearance)).length,
  };
}

/**
 * Сообщения окна для зрителя: фильтруем по допуску (required_clearance)
 * и по приватным получателям, если они заданы (рецепт 006/010).
 */
export async function listMessagesFor(viewer: Viewer, negotiationId: string): Promise<MessageWithMeta[]> {
  await getNegotiationFor(viewer, negotiationId); // проверка участия
  const { deps } = getContainer();
  const [messages, recipients] = await Promise.all([
    deps.negotiations.listMessages(negotiationId),
    Promise.resolve(null),
  ]);
  void recipients;

  const userCache = new Map<string, string | null>();
  const rows = await Promise.all(
    messages
      .filter((m) => isCleared(viewer, m.required_clearance))
      .map(async (m) => {
        let senderName = userCache.get(m.sender);
        if (senderName === undefined) {
          const sender = await deps.users.findById(m.sender);
          senderName = sender?.name ?? null;
          userCache.set(m.sender, senderName);
        }
        const docs = await deps.negotiations.listMessageDocuments([m.id]);
        return { ...m, senderName, visibleDocuments: docs.length };
      }),
  );
  return rows;
}

export type SendMessageInput = {
  text?: string | null;
  files?: string[] | null;
  requiredClearance?: number;
  documentRef?: { collection: 'asset' | 'internal' | 'commercial' | 'medical' | 'public'; documentId: string } | null;
};

export async function sendMessageTo(viewer: Viewer, negotiationId: string, input: SendMessageInput): Promise<string> {
  await getNegotiationFor(viewer, negotiationId); // проверка участия
  const { deps } = getContainer();
  const clearance = input.requiredClearance ?? 3;
  if (clearance < viewer.clearanceLevel) {
    throw errForbidden('Нельзя выставить допуск выше своего (сообщение будет невидимо вам же)');
  }
  if (!input.text?.trim() && !input.files?.length && !input.documentRef) {
    throw new Error('Сообщение пустое');
  }
  return deps.negotiations.sendMessage({
    negotiationId,
    senderId: viewer.userId,
    messageType: input.text ? 'text' : 'file',
    text: input.text ?? null,
    files: input.files ?? null,
    requiredClearance: clearance,
    documentRef: input.documentRef ?? null,
  });
}
