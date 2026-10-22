// desk/labels.ts — русские подписи доменных значений (как в основном сайте).

import type { NegotiationStatus, ParticipantRole } from './types';

export const STATUS_LABEL: Record<NegotiationStatus, string> = {
  open: 'открыт',
  waiting: 'в ожидании',
  waiting_platform: 'ждёт платформу',
  in_progress: 'в работе',
  resolved: 'решён',
  closed: 'закрыт',
};

/** Статусы для меню в шапке чата (в порядке списка). */
export const STATUS_MENU: Array<{ id: NegotiationStatus; label: string; hint: string }> = [
  { id: 'open', label: 'Открыть чат', hint: 'по умолчанию всегда открыт' },
  { id: 'waiting', label: 'Ожидание', hint: 'ждём ответа' },
  { id: 'in_progress', label: 'В работе', hint: 'обсуждение идёт' },
  { id: 'resolved', label: 'Вопрос решён', hint: 'итог зафиксирован' },
  { id: 'closed', label: 'Закрыть чат', hint: 'отправка будет недоступна' },
];

export const DISPUTE_LABEL: Record<string, string> = {
  standard_chat: 'переписка',
  pre_contract: 'преддоговорный',
  commercial_dispute: 'коммерческий спор',
  technical_warranty: 'гарантия и техника',
  delivery_logistics: 'логистика',
  gov_program_audit: 'госпрограмма',
  medical_consult: 'медконсультация',
  platform_support: 'поддержка платформы',
  internal_staff: 'внутренний',
};

export const ROLE_LABEL: Record<ParticipantRole, string> = {
  initiator: 'инициатор',
  counterparty: 'контрагент',
  staff: 'сотрудник',
  bank: 'банк',
  platform: 'платформа',
  observer: 'наблюдатель',
};

export const DEAL_TYPE_LABEL: Record<string, string> = {
  sale: 'продажа',
  installment: 'рассрочка',
  b2b_credit: 'кредит B2B',
  b2c_credit: 'кредит B2C',
  rental: 'аренда',
  leasing: 'лизинг',
  factoring: 'факторинг',
  raas: 'RaaS',
  trade_in: 'trade-in',
  refurbishment: 'восстановление',
  subscription: 'подписка',
  sharing: 'шеринг',
  gov_program: 'госпрограмма',
  promo: 'промо',
};

export const DEAL_STATUS_LABEL: Record<string, string> = {
  draft: 'черновик',
  calculated: 'рассчитана',
  negotiation: 'переговоры',
  approved: 'согласована',
  pending: 'в ожидании',
  active: 'активна',
  completed: 'завершена',
  default: 'просрочена',
};

export const CLEARANCE_LABEL: Record<number, string> = {
  1: 'руководство',
  2: 'менеджеры',
  3: 'все сотрудники',
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status as NegotiationStatus] ?? status;
}

export function disputeLabel(type: string): string {
  return DISPUTE_LABEL[type] ?? type;
}

export function roleLabel(role: string): string {
  return ROLE_LABEL[role as ParticipantRole] ?? role;
}
