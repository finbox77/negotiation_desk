// desk/api.ts — HTTP-клиент основного сайта.
//
// Используемые маршруты (контракт зафиксирован в README приложения):
//   GET  /api/v1/negotiations                  — снимок стола (camelCase DTO);
//   GET  /api/v1/negotiations/:id              — карточка окна и участники;
//   GET  /api/v1/negotiations/:id/messages     — сообщения с учётом допуска;
//   POST /api/v1/negotiations/:id/messages     — отправить сообщение.
//
// Сессия — обычная httpOnly-cookie Simonix. В dev-режиме запросы идут через
// прокси Vite (см. vite.config.ts), поэтому CORS не нужен.

import { statusLabel } from './labels';
import type {
  ApiErrorKind,
  CardContext,
  DeskMessage,
  DeskSnapshot,
  MessageType,
  NegotiationStatus,
  Participant,
  ParticipantRole,
  SendPayload,
  TableCard,
  TableDetail,
  TableSummary,
  Viewer,
} from './types';

const TIMEOUT_MS = 12_000;

export class ApiError extends Error {
  readonly status: number;
  readonly kind: ApiErrorKind;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind =
      status === 401
        ? 'auth'
        : status === 403
          ? 'forbidden'
          : status === 0
            ? 'network'
            : status >= 500
              ? 'server'
              : 'unknown';
  }
}

function apiRoot(base: string): string {
  return `${base.replace(/\/+$/, '')}/api/v1`;
}

async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${apiRoot(base)}${path}`, {
      ...init,
      credentials: 'include',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    });

    const raw = await response.text();
    let data: unknown = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      const body = data as { error?: string; message?: string } | null;
      const fallback =
        response.status === 401
          ? 'Нужен вход на сайте'
          : `Сайт ответил ошибкой ${response.status}`;
      throw new ApiError(response.status, body?.error ?? body?.message ?? fallback);
    }

    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(0, 'Сайт не ответил за 12 секунд');
    }
    throw new ApiError(0, 'Нет связи с сайтом — проверьте адрес и запущен ли сервер');
  } finally {
    window.clearTimeout(timer);
  }
}

/* ------------------------------ нормализация ------------------------------ */

function asRecord(value: unknown): Record<string, unknown> {
  return (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeTable(raw: unknown): TableSummary {
  const r = asRecord(raw);
  const status = str(r.status, 'open') as NegotiationStatus;
  const lastRaw = r.last ? asRecord(r.last) : null;

  return {
    id: str(r.id),
    title: str(r.title, 'Без названия'),
    disputeType: str(r.disputeType, 'standard_chat'),
    status,
    statusLabel: str(r.statusLabel, statusLabel(status)),
    dealId: nullableStr(r.dealId),
    productId: nullableStr(r.productId),
    environmentId: nullableStr(r.environmentId),
    participants: num(r.participants),
    messages: num(r.messages),
    fresh: num(r.fresh),
    signal: r.signal === 'client' || r.signal === 'team' ? r.signal : 'none',
    last: lastRaw
      ? {
          id: str(lastRaw.id),
          author: str(lastRaw.author, 'участник'),
          text: str(lastRaw.text, 'сообщение'),
          createdAt: str(lastRaw.createdAt),
          fresh: Boolean(lastRaw.fresh),
        }
      : null,
    createdAt: str(r.createdAt),
    updatedAt: str(r.updatedAt),
    initiatorUserId: nullableStr(r.initiatorUserId ?? r.initiator_user),
  };
}

function normalizeViewer(raw: unknown): Viewer {
  const r = asRecord(raw);
  return {
    id: str(r.id),
    name: nullableStr(r.name),
    clearanceLevel: num(r.clearanceLevel, 3),
    companyId: nullableStr(r.companyId),
  };
}

function normalizeSnapshot(raw: unknown): DeskSnapshot {
  const r = asRecord(raw);
  const totals = asRecord(r.totals);
  const tables = Array.isArray(r.tables) ? r.tables.map(normalizeTable) : [];
  return {
    viewer: normalizeViewer(r.viewer),
    tables,
    totals: {
      tables: num(totals.tables, tables.length),
      fresh: num(totals.fresh),
      freshFromClients: num(totals.freshFromClients),
      signal: totals.signal === 'client' || totals.signal === 'team' ? totals.signal : 'none',
    },
  };
}

function normalizeTableDetail(raw: unknown): TableDetail {
  const r = asRecord(raw);
  return {
    id: str(r.id),
    title: str(r.title, 'Без названия'),
    disputeType: str(r.dispute_type, str(r.disputeType, 'standard_chat')),
    status: str(r.status, 'open') as NegotiationStatus,
    dealId: nullableStr(r.deal ?? r.dealId),
    productId: nullableStr(r.product ?? r.productId),
    environmentId: nullableStr(r.environment ?? r.environmentId),
    initiatorUserId: nullableStr(r.initiator_user ?? r.initiatorUserId),
    initiatorCompanyId: nullableStr(r.initiator_company ?? r.initiatorCompanyId),
    respondentCompanyId: nullableStr(r.respondent_company ?? r.respondentCompanyId),
    createdAt: str(r.created ?? r.createdAt),
    updatedAt: str(r.updated ?? r.updatedAt),
  };
}

function normalizeParticipant(raw: unknown): Participant {
  const r = asRecord(raw);
  return {
    userId: str(r.userId),
    name: str(r.name, 'участник'),
    role: str(r.role, 'observer') as ParticipantRole,
    companyId: nullableStr(r.companyId),
    companyName: nullableStr(r.companyName),
    isInitiator: Boolean(r.isInitiator),
    clearanceLevel: num(r.clearanceLevel ?? r.clearance_level, 3),
    present: Boolean(r.present),
  };
}

function normalizeContext(raw: unknown): CardContext {
  const r = asRecord(raw);
  const deal = r.deal ? asRecord(r.deal) : null;
  const product = r.product ? asRecord(r.product) : null;
  const environment = r.environment ? asRecord(r.environment) : null;
  return {
    deal: deal
      ? {
          id: str(deal.id),
          dealType: str(deal.dealType),
          status: str(deal.status),
          totalAmount: num(deal.totalAmount),
        }
      : null,
    product: product ? { id: str(product.id), title: str(product.title) } : null,
    environment: environment
      ? { id: str(environment.id), name: str(environment.name) }
      : null,
  };
}

function normalizeCard(raw: unknown): TableCard {
  const r = asRecord(raw);
  return {
    table: normalizeTableDetail(r.table),
    participants: Array.isArray(r.participants)
      ? r.participants.map(normalizeParticipant)
      : [],
    context: normalizeContext(r.context),
    messageCount: num(r.messageCount),
  };
}

function normalizeMessage(raw: unknown): DeskMessage {
  const r = asRecord(raw);
  const type = str(r.message_type ?? r.type, 'text') as MessageType;
  return {
    id: str(r.id),
    sender: str(r.sender),
    senderName: str(r.senderName, 'участник'),
    type,
    text: nullableStr(r.text),
    files: Array.isArray(r.files) ? r.files.map((f) => String(f)) : null,
    requiredClearance: num(r.required_clearance ?? r.requiredClearance, 3),
    createdAt: str(r.created ?? r.createdAt),
    visibleDocuments: num(r.visibleDocuments),
  };
}

/* -------------------------------- запросы --------------------------------- */

export async function fetchSnapshot(base: string): Promise<DeskSnapshot> {
  return normalizeSnapshot(await request<unknown>(base, '/negotiations'));
}

export async function fetchCard(base: string, id: string): Promise<TableCard> {
  return normalizeCard(await request<unknown>(base, `/negotiations/${encodeURIComponent(id)}`));
}

export async function fetchMessages(base: string, id: string): Promise<DeskMessage[]> {
  const data = await request<unknown>(base, `/negotiations/${encodeURIComponent(id)}/messages`);
  const r = asRecord(data);
  return Array.isArray(r.messages) ? r.messages.map(normalizeMessage) : [];
}

export async function postMessage(
  base: string,
  id: string,
  payload: SendPayload,
): Promise<string> {
  const data = await request<unknown>(base, `/negotiations/${encodeURIComponent(id)}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      text: payload.text,
      files: payload.files ?? null,
      required_clearance: payload.requiredClearance,
    }),
  });
  return str(asRecord(data).id);
}
