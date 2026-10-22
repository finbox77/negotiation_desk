// desk/local.ts — локальный слой поверх стола: окна-чаты, привязки участников,
// очистка истории и сообщения, написанные в приложении.
//
// Живёт в localStorage и работает одинаково в демо и в режиме «сайт»: то, что
// пользователь сделал в приложении (создал тему, написал в личный чат, привязал
// участника к окну, удалил сообщения), не теряется при перезагрузке. Когда
// появится связь с основным проектом, этот слой станет источником для
// синхронизации с API — контракт точек стыковки помечен комментариями SYNC.

import type {
  ChatCategory,
  LocalChatKind,
  LocalChatRecord,
  LocalMessage,
  MessageType,
} from './types';
import { STORAGE } from './config';

export type LocalOverlay = {
  /** Созданные в приложении окна: ключ `lc-*` → чат. */
  chats: Record<string, LocalChatRecord>;
  /** Сообщения личных чатов и новых тем. */
  messages: LocalMessage[];
  /** Очищенные сообщения: окно → последние удалённые id (учтены при показе). */
  removed: Record<string, string[]>;
  /** Добавленные к окну участники (для столов из базы/демо). */
  addedMembers: Record<string, string[]>;
  /** Убранные из окна участники. */
  removedMembers: Record<string, string[]>;
  /** Удалённые окна (для столов из базы/демо: прячем, удалять на сервере позже). */
  deletedWindows: string[];
  /** Выбранный вручную статус окна (меню «≡» в шапке чата). */
  statusOf: Record<string, string>;
  /** Открытые в мини-шапке окна (порядок вкладок: новые слева). */
  openWindows: string[];
  /** Активное окно. */
  activeWindow: string | null;
  /** Свои категории чатов («виртуальные папки») из дерева категорий. */
  customCategories: ChatCategory[];
  /** Ручное отнесение чата к категориям: чат → id категорий. */
  chatCategories: Record<string, string[]>;
};

const EMPTY: LocalOverlay = {
  chats: {},
  messages: [],
  removed: {},
  addedMembers: {},
  removedMembers: {},
  deletedWindows: [],
  statusOf: {},
  openWindows: [],
  activeWindow: null,
  customCategories: [],
  chatCategories: {},
};

export function loadOverlay(scope: string): LocalOverlay {
  try {
    const raw = localStorage.getItem(STORAGE.local);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Record<string, LocalOverlay>;
    const saved = parsed?.[scope];
    if (!saved || typeof saved !== 'object') return { ...EMPTY };
    return {
      chats: saved.chats ?? {},
      messages: Array.isArray(saved.messages) ? saved.messages : [],
      removed: saved.removed ?? {},
      addedMembers: saved.addedMembers ?? {},
      removedMembers: saved.removedMembers ?? {},
      deletedWindows: Array.isArray(saved.deletedWindows) ? saved.deletedWindows : [],
      statusOf: saved.statusOf ?? {},
      openWindows: Array.isArray(saved.openWindows) ? saved.openWindows : [],
      activeWindow: typeof saved.activeWindow === 'string' ? saved.activeWindow : null,
      customCategories: Array.isArray(saved.customCategories) ? saved.customCategories : [],
      chatCategories: saved.chatCategories ?? {},
    };
  } catch {
    // Битые данные не должны ронять приложение.
    return { ...EMPTY };
  }
}

export function saveOverlay(scope: string, overlay: LocalOverlay): void {
  try {
    const raw = localStorage.getItem(STORAGE.local);
    const all = raw ? (JSON.parse(raw) as Record<string, LocalOverlay>) : {};
    all[scope] = overlay;
    localStorage.setItem(STORAGE.local, JSON.stringify(all));
  } catch {
    // приватный режим — работаем без сохранения
  }
}

export function newLocalChatId(): string {
  return `lc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function newMessageId(): string {
  return `lm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function newCategoryId(): string {
  return `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function makeLocalChat(input: {
  kind: LocalChatKind;
  title: string;
  peerId?: string | null;
  participantIds: string[];
  memberNames: Record<string, string>;
}): LocalChatRecord {
  return {
    id: newLocalChatId(),
    kind: input.kind,
    title: input.title.trim() || (input.kind === 'private' ? 'Личный чат' : 'Новая тема'),
    peerId: input.peerId ?? null,
    participantIds: [...new Set(input.participantIds)],
    memberNames: { ...input.memberNames },
    createdAt: new Date().toISOString(),
  };
}

export function isLocalWindow(key: string | null | undefined): boolean {
  return typeof key === 'string' && key.startsWith('lc-');
}

export function makeLocalMessage(input: {
  windowKey: string;
  sender: string;
  type?: MessageType;
  text: string | null;
  files?: string[] | null;
  requiredClearance: number;
}): LocalMessage {
  return {
    id: newMessageId(),
    windowKey: input.windowKey,
    sender: input.sender,
    type: input.type ?? (input.files?.length ? 'file' : 'text'),
    text: input.text,
    files: input.files ?? null,
    requiredClearance: input.requiredClearance,
    createdAt: new Date().toISOString(),
  };
}
