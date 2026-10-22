// desk/types.ts — контракт приложения «Стол переговоров».
//
// Это зеркало DTO основного сайта (src/application/negotiation-desk.ts и
// src/application/negotiations.ts), но только в camelCase и только то, что
// реально рисует PWA. При выносе в отдельный репозиторий этот файл — точка
// стыковки: меняется вместе с GET /api/v1/negotiations.

export type DeskSignal = 'none' | 'team' | 'client';
export type DeskMode = 'demo' | 'site';
export type ThemeMode = 'system' | 'light' | 'dark';
export type DemoProfileId = 'director' | 'engineer' | 'vendor';

/** Локальное окно, созданное в приложении: личный чат или новая тема. */
export type LocalChatKind = 'private' | 'topic';

export type Settings = {
  mode: DeskMode;
  /** Пусто = запросы идут на тот же origin через прокси Vite. */
  apiBase: string;
  /** Основной сайт: вход, кабинет. */
  siteUrl: string;
  demoProfile: DemoProfileId;
  theme: ThemeMode;
};
export type NegotiationStatus =
  | 'open'
  | 'waiting'
  | 'waiting_platform'
  | 'in_progress'
  | 'resolved'
  | 'closed';
export type MessageType = 'text' | 'file' | 'system' | 'call_started' | 'call_ended';

export type ParticipantRole =
  | 'initiator'
  | 'counterparty'
  | 'staff'
  | 'bank'
  | 'platform'
  | 'observer';

export type Viewer = {
  id: string;
  name: string | null;
  clearanceLevel: number;
  companyId: string | null;
  /** Только демо-режим: подпись профиля и компания. */
  companyName?: string | null;
  roleLabel?: string | null;
};

export type LastMessage = {
  id: string;
  author: string;
  text: string;
  createdAt: string;
  fresh: boolean;
};

export type TableSummary = {
  id: string;
  title: string;
  disputeType: string;
  status: NegotiationStatus;
  statusLabel: string;
  dealId: string | null;
  productId: string | null;
  environmentId: string | null;
  participants: number;
  messages: number;
  fresh: number;
  signal: DeskSignal;
  last: LastMessage | null;
  createdAt: string;
  updatedAt: string;
  /** Кто создал окно — для фильтра «Созданные мной». */
  initiatorUserId?: string | null;
};

export type DeskSnapshot = {
  viewer: Viewer;
  tables: TableSummary[];
  totals: {
    tables: number;
    fresh: number;
    freshFromClients: number;
    signal: DeskSignal;
  };
};

export type TableDetail = {
  id: string;
  title: string;
  disputeType: string;
  status: NegotiationStatus;
  dealId: string | null;
  productId: string | null;
  environmentId: string | null;
  initiatorUserId: string | null;
  initiatorCompanyId: string | null;
  respondentCompanyId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Participant = {
  userId: string;
  name: string;
  role: ParticipantRole;
  companyId: string | null;
  companyName: string | null;
  isInitiator: boolean;
  /** Уровень допуска участника: 1 — руководство, 3 — все сотрудники. */
  clearanceLevel: number;
  /** Присутствие: «в столе» (пишет/на связи) или нет. */
  present: boolean;
};

/** Строка каталога пользователей — для дерева, личных чатов и подписей. */
export type DeskUser = {
  id: string;
  name: string;
  companyName: string | null;
  clearanceLevel: number;
  present: boolean;
  /** Компания-заказчик — для сигнала «клиент» в окнах. */
  companyIsClient?: boolean;
};

export type CardContext = {
  deal: { id: string; dealType: string; status: string; totalAmount: number } | null;
  product: { id: string; title: string } | null;
  environment: { id: string; name: string } | null;
};

export type TableCard = {
  table: TableDetail;
  participants: Participant[];
  context: CardContext;
  messageCount: number;
};

export type DeskMessage = {
  id: string;
  sender: string;
  senderName: string;
  type: MessageType;
  text: string | null;
  files: string[] | null;
  requiredClearance: number;
  createdAt: string;
  visibleDocuments: number;
};

export type SendPayload = {
  text: string;
  requiredClearance: number;
  files?: string[] | null;
};

/** Локальное окно-чат, созданное в приложении (личный чат или новая тема). */
export type LocalChatRecord = {
  id: string;
  kind: LocalChatKind;
  title: string;
  /** Собеседник личного чата. */
  peerId: string | null;
  participantIds: string[];
  /** Снимок имён участников — чтобы чат не зависел от каталога. */
  memberNames: Record<string, string>;
  createdAt: string;
};

/** Сообщение локального окна (пока живёт в браузере). */
export type LocalMessage = {
  id: string;
  windowKey: string;
  sender: string;
  type: MessageType;
  text: string | null;
  files: string[] | null;
  requiredClearance: number;
  createdAt: string;
};

export type ApiErrorKind = 'auth' | 'forbidden' | 'network' | 'server' | 'unknown';
