// useDesk — состояние приложения: настройки, снимок стола, открытые окна,
// сообщения и отправка. Один хук на всё приложение: данных мало, а так
// переключение «демо ↔ сайт» не растаскивается по компонентам.
//
// Поверх стола работает локальный слой (desk/local.ts): окна-чаты, привязки
// участников, очистка истории и личные переписки. Он же — точка, где позже
// оживёт синхронизация с основным проектом (помечено SYNC в local.ts).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  fetchCard,
  fetchMessages,
  fetchSnapshot,
  postMessage,
} from './api';
import { DEFAULTS, STORAGE } from './config';
import {
  DEMO_PROFILES,
  demoCard,
  demoDirectory,
  demoMessages,
  demoSend,
  demoSnapshot,
  demoViewer,
  resetDemo,
} from './demo';
import { statusLabel } from './labels';
import {
  isLocalWindow,
  loadOverlay,
  makeLocalChat,
  makeLocalMessage,
  newCategoryId,
  saveOverlay,
  type LocalOverlay,
} from './local';
import { exportChatToWord } from './exportWord';
import type {
  DemoProfileId,
  DeskMessage,
  DeskMode,
  DeskSignal,
  DeskSnapshot,
  DeskUser,
  LocalChatKind,
  LocalChatRecord,
  NegotiationStatus,
  Participant,
  ParticipantRole,
  Settings,
  TableCard,
  TableDetail,
  TableSummary,
  ThemeMode,
  Viewer,
} from './types';

type SeenMap = Record<string, Record<string, string>>;

const FRESH_WINDOW_MS = 72 * 3600 * 1000;

function loadSettings(): Settings {
  const initial: Settings = {
    mode: DEFAULTS.mode,
    apiBase: DEFAULTS.apiBase,
    siteUrl: DEFAULTS.siteUrl,
    demoProfile: 'director',
    theme: DEFAULTS.theme,
  };

  try {
    const raw = localStorage.getItem(STORAGE.settings);
    if (!raw) return initial;
    const saved = JSON.parse(raw) as Partial<Settings>;
    if (saved.mode === 'demo' || saved.mode === 'site') initial.mode = saved.mode as DeskMode;
    if (typeof saved.apiBase === 'string') initial.apiBase = saved.apiBase.replace(/\/+$/, '');
    if (typeof saved.siteUrl === 'string' && saved.siteUrl.trim()) initial.siteUrl = saved.siteUrl;
    if (DEMO_PROFILES.some((p) => p.id === saved.demoProfile)) {
      initial.demoProfile = saved.demoProfile as DemoProfileId;
    }
    if (saved.theme === 'light' || saved.theme === 'dark' || saved.theme === 'system') {
      initial.theme = saved.theme as ThemeMode;
    }
  } catch {
    // Битый localStorage не должен ронять приложение — работаем на дефолтах.
  }
  return initial;
}

function loadSeen(): SeenMap {
  try {
    const raw = localStorage.getItem(STORAGE.seen);
    const parsed = raw ? (JSON.parse(raw) as SeenMap) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function scopeOf(settings: Settings): string {
  return settings.mode === 'demo'
    ? `demo:${settings.demoProfile}`
    : `site:${settings.apiBase || 'same-origin'}`;
}

/** Сводка локального окна (личный чат / новая тема) в формате TableSummary. */
function localSummaryOf(
  chat: LocalChatRecord,
  overlay: LocalOverlay,
  viewer: Viewer | null,
  userById: Map<string, DeskUser>,
): TableSummary {
  const removed = overlay.removed[chat.id] ?? [];
  const msgs = overlay.messages
    .filter((m) => m.windowKey === chat.id && !removed.includes(m.id))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const now = Date.now();
  const incoming = msgs.filter(
    (m) => m.sender !== viewer?.id && now - Date.parse(m.createdAt) < FRESH_WINDOW_MS,
  );

  let signal: DeskSignal = 'none';
  for (const m of incoming) {
    const author = userById.get(m.sender);
    const isClient =
      author && viewer && author.companyName && author.id !== viewer.id
        ? Boolean(author.companyIsClient) && author.companyName !== viewer.companyName
        : false;
    if (isClient) signal = 'client';
    else if (signal === 'none') signal = 'team';
  }

  const lastRaw = msgs[msgs.length - 1] ?? null;
  const last = lastRaw
    ? {
        id: lastRaw.id,
        author:
          lastRaw.sender === viewer?.id
            ? viewer?.name ?? 'вы'
            : chat.memberNames[lastRaw.sender] ?? userById.get(lastRaw.sender)?.name ?? 'участник',
        text:
          lastRaw.text ??
          (lastRaw.type === 'file' ? 'приложен файл' : 'системное событие'),
        createdAt: lastRaw.createdAt,
        fresh: lastRaw.sender !== viewer?.id && now - Date.parse(lastRaw.createdAt) < FRESH_WINDOW_MS,
        files: lastRaw.files ?? null,
      }
    : null;

  return {
    id: chat.id,
    title: chat.title,
    disputeType: 'standard_chat',
    status: 'open',
    statusLabel: 'открыт',
    dealId: null,
    productId: null,
    environmentId: null,
    participants: chat.participantIds.length,
    messages: msgs.length,
    fresh: incoming.length,
    signal,
    last,
    createdAt: chat.createdAt,
    updatedAt: lastRaw?.createdAt ?? chat.createdAt,
    initiatorUserId: viewer?.id ?? null,
  };
}

/** Сводка локального окна → карточка участников (как у столов). */
function localCardOf(
  chat: LocalChatRecord,
  overlay: LocalOverlay,
  viewer: Viewer | null,
  userById: Map<string, DeskUser>,
): TableCard {
  const removed = overlay.removed[chat.id] ?? [];
  const messageCount = overlay.messages.filter(
    (m) => m.windowKey === chat.id && !removed.includes(m.id),
  ).length;

  const participants: Participant[] = chat.participantIds.map((id) => {
    const user = userById.get(id);
    return {
      userId: id,
      name: chat.memberNames[id] ?? user?.name ?? 'участник',
      role: (id === viewer?.id ? 'initiator' : chat.kind === 'private' ? 'counterparty' : 'staff') as ParticipantRole,
      companyId: null,
      companyName: user?.companyName ?? null,
      isInitiator: id === viewer?.id,
      clearanceLevel: user?.clearanceLevel ?? 3,
      present: user?.present ?? id === viewer?.id,
    };
  });

  const detail: TableDetail = {
    id: chat.id,
    title: chat.title,
    disputeType: 'standard_chat',
    status: 'open',
    dealId: null,
    productId: null,
    environmentId: null,
    initiatorUserId: viewer?.id ?? null,
    initiatorCompanyId: viewer?.companyId ?? null,
    respondentCompanyId: null,
    createdAt: chat.createdAt,
    updatedAt: chat.createdAt,
  };

  return {
    table: detail,
    participants,
    context: { deal: null, product: null, environment: null },
    messageCount,
  };
}

export function useDesk() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [snapshot, setSnapshot] = useState<DeskSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rawCard, setRawCard] = useState<TableCard | null>(null);
  const [rawMessages, setRawMessages] = useState<DeskMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatLoading, setChatLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [seenMap, setSeenMap] = useState<SeenMap>(loadSeen);
  const [refreshTick, setRefreshTick] = useState(0);
  /** Подсветка сообщений выбранного участника в ленте. */
  const [highlightUserId, setHighlightUserId] = useState<string | null>(null);
  /** Участник, выбранный по имени в правой колонке (окна и файлы снизу). */
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  /** Каталог пользователей поверх карточки (сайт: догружаем карточки столов). */
  const [extraUsers, setExtraUsers] = useState<Record<string, DeskUser>>({});
  /** Сообщения всех окон — для поиска по тексту и списка файлов. */
  const [msgIndex, setMsgIndex] = useState<Record<string, DeskMessage[]>>({});
  /** Участники всех окон — для дерева и «окон участника». */
  const [membersIndex, setMembersIndex] = useState<Record<string, string[]>>({});
  const [indexLoading, setIndexLoading] = useState(false);
  /** Локальный слой: окна-чаты, привязки, удалённые сообщения. */
  const [overlay, setOverlay] = useState<LocalOverlay>(() => loadOverlay(scopeOf(settings)));

  /** Какой стол уже загружен: при переключении чистим ленту, при refresh — нет. */
  const loadedTableRef = useRef<string | null>(null);
  const overlayScopeRef = useRef(scopeOf(settings));
  const indexBuiltRef = useRef(false);

  const scope = useMemo(() => scopeOf(settings), [settings]);

  const viewer: Viewer | null =
    snapshot?.viewer ??
    (settings.mode === 'demo' ? demoViewer(settings.demoProfile) : null);

  /* ------------------------------ настройки ------------------------------- */

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE.settings, JSON.stringify(settings));
    } catch {
      // приватный режим браузера — просто не запоминаем
    }
  }, [settings]);

  useEffect(() => {
    // Сменили режим/адрес/профиль — открытый стол относится к другой среде.
    setSelectedId(null);
  }, [settings.mode, settings.apiBase, settings.demoProfile]);

  useEffect(() => {
    if (overlayScopeRef.current === scope) return;
    overlayScopeRef.current = scope;
    setOverlay(loadOverlay(scope));
  }, [scope]);

  useEffect(() => {
    saveOverlay(overlayScopeRef.current, overlay);
  }, [overlay]);

  // Восстанавливаем открытые окна после перезагрузки: активное окно открывается
  // сразу, остальные вкладки остаются в мини-шапке.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    if (overlay.openWindows.length === 0) return;
    restoredRef.current = true;
    const key = overlay.activeWindow ?? overlay.openWindows[0];
    if (key) setSelectedId(key);
  }, [overlay.openWindows, overlay.activeWindow]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved =
        settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };
    apply();
    if (settings.theme !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings.theme]);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  /* ------------------------------ каталог --------------------------------- */

  const userById = useMemo(() => {
    const map = new Map<string, DeskUser>();
    const addUser = (user: DeskUser) => {
      const prev = map.get(user.id);
      if (!prev) {
        map.set(user.id, user);
        return;
      }
      map.set(user.id, {
        ...prev,
        ...user,
        name: user.name && user.name !== 'участник' ? user.name : prev.name,
        companyName: user.companyName ?? prev.companyName,
        // Каталог точнее значений по умолчанию: берём самый закрытый допуск.
        clearanceLevel: Math.min(prev.clearanceLevel, user.clearanceLevel),
        present: prev.present || user.present,
        companyIsClient: user.companyIsClient ?? prev.companyIsClient,
      });
    };

    if (viewer) {
      addUser({
        id: viewer.id,
        name: viewer.name ?? 'вы',
        companyName: viewer.companyName ?? null,
        clearanceLevel: viewer.clearanceLevel,
        present: true,
        companyIsClient: false,
      });
    }
    if (settings.mode === 'demo' && viewer) {
      for (const user of demoDirectory(viewer)) addUser(user);
    }
    for (const p of rawCard?.participants ?? []) {
      addUser({
        id: p.userId,
        name: p.name,
        companyName: p.companyName,
        clearanceLevel: p.clearanceLevel,
        present: p.present,
      });
    }
    for (const chat of Object.values(overlay.chats)) {
      for (const id of chat.participantIds) {
        addUser({
          id,
          name: chat.memberNames[id] ?? 'участник',
          companyName: null,
          clearanceLevel: 3,
          present: id === viewer?.id,
        });
      }
    }
    for (const user of Object.values(extraUsers)) addUser(user);

    return map;
  }, [viewer, settings.mode, rawCard, overlay.chats, extraUsers]);

  const userByIdRef = useRef(userById);
  userByIdRef.current = userById;

  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;

  /** Все участники стола — без дублей, чаты к ним привязаны ссылками. */
  const allUsers = useMemo(() => {
    const list = [...userById.values()];
    list.sort((a, b) => Number(b.present) - Number(a.present) || a.name.localeCompare(b.name, 'ru'));
    return list;
  }, [userById]);

  /* ------------------------------- загрузка ------------------------------- */

  const loadSnapshot = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);

      const keepOrDrop = (prev: string | null, ids: string[], locals: string[]): string | null => {
        if (!prev) return null;
        if (locals.includes(prev)) return prev;
        return ids.includes(prev) ? prev : null;
      };

      if (settings.mode === 'demo') {
        const nextViewer = demoViewer(settings.demoProfile);
        const snap = demoSnapshot(nextViewer);
        setSnapshot(snap);
        setAuthRequired(false);
        const localIds = Object.keys(overlayRef.current.chats);
        setSelectedId((prev) =>
          keepOrDrop(prev, snap.tables.map((t) => t.id), localIds),
        );
        if (!silent) setLoading(false);
        return;
      }

      try {
        const snap = await fetchSnapshot(settings.apiBase);
        setSnapshot(snap);
        setAuthRequired(false);
        const localIds = Object.keys(overlayRef.current.chats);
        setSelectedId((prev) =>
          keepOrDrop(prev, snap.tables.map((t) => t.id), localIds),
        );
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError(0, 'Не удалось загрузить стол');
        setError(err.message);
        setAuthRequired(err.kind === 'auth');
        setSnapshot(null);
        setSelectedId(null);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [settings.mode, settings.apiBase, settings.demoProfile],
  );

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  /* ------------------------------ отметки -------------------------------- */

  const markSeen = useCallback(
    (tableId: string) => {
      setSeenMap((prev) => {
        const next: SeenMap = {
          ...prev,
          [scope]: { ...(prev[scope] ?? {}), [tableId]: new Date().toISOString() },
        };
        try {
          localStorage.setItem(STORAGE.seen, JSON.stringify(next));
        } catch {
          // не критично
        }
        return next;
      });
    },
    [scope],
  );

  const seen = seenMap[scope] ?? {};

  const freshOf = useCallback(
    (table: TableSummary): number => {
      if (!table.last) return 0;
      const seenAt = seen[table.id];
      if (seenAt && Date.parse(seenAt) >= Date.parse(table.last.createdAt)) return 0;
      return table.fresh;
    },
    [seen],
  );

  const signalOf = (table: TableSummary): DeskSignal =>
    freshOf(table) > 0 ? table.signal : 'none';

  /* ------------------------------ категории ------------------------------- */
  // Встроенные категории определяются сами (новые / клиенты / партнёры /
  // созданные мной), свои категории и ручные привязки живут в локальном слое.
  // Чат может входить сразу в несколько категорий.

  const builtinCategoriesOf = useCallback(
    (table: TableSummary): string[] => {
      const result: string[] = [];
      if (freshOf(table) > 0) result.push('fresh');
      const signal = freshOf(table) > 0 ? table.signal : 'none';
      if (signal === 'client') result.push('clients');
      if (signal === 'team') result.push('partners');
      if (table.initiatorUserId != null && table.initiatorUserId === viewer?.id) {
        result.push('mine');
      }
      return result;
    },
    [freshOf, viewer],
  );

  /** Все категории чата: встроенные (автоматом) + отнесённые вручную. */
  const categoriesOf = useCallback(
    (table: TableSummary): string[] => {
      const manual = overlay.chatCategories[table.id] ?? [];
      return [...new Set([...builtinCategoriesOf(table), ...manual])];
    },
    [builtinCategoriesOf, overlay.chatCategories],
  );

  /** Создать свою категорию («виртуальную папку»). Возвращает id или null. */
  const addCustomCategory = useCallback((label: string): string | null => {
    const name = label.trim();
    if (!name) return null;
    const existing = overlayRef.current.customCategories.find(
      (c) => c.label.toLowerCase() === name.toLowerCase(),
    );
    if (existing) return existing.id;
    const category = { id: newCategoryId(), label: name };
    setOverlay((prev) => ({
      ...prev,
      customCategories: [...prev.customCategories, category],
    }));
    setNotice(`Категория «${name}» создана`);
    return category.id;
  }, []);

  /** Удалить свою категорию и все её привязки («Все» и встроенные не удаляются). */
  const removeCustomCategory = useCallback((categoryId: string) => {
    setOverlay((prev) => {
      const chatCategories: Record<string, string[]> = {};
      for (const [chatId, ids] of Object.entries(prev.chatCategories)) {
        chatCategories[chatId] = ids.filter((id) => id !== categoryId);
      }
      return {
        ...prev,
        customCategories: prev.customCategories.filter((c) => c.id !== categoryId),
        chatCategories,
      };
    });
    setNotice('Категория удалена');
  }, []);

  /** Отнести чат к категории вручную (или убрать ручную привязку). */
  const setChatCategory = useCallback((chatId: string, categoryId: string, on: boolean) => {
    setOverlay((prev) => {
      const current = prev.chatCategories[chatId] ?? [];
      const next = on
        ? current.includes(categoryId)
          ? current
          : [...current, categoryId]
        : current.filter((id) => id !== categoryId);
      return { ...prev, chatCategories: { ...prev.chatCategories, [chatId]: next } };
    });
  }, []);

  /* -------------------------------- таблицы -------------------------------- */

  const localSummaries = useMemo(() => {
    return Object.values(overlay.chats).map((chat) =>
      localSummaryOf(chat, overlay, viewer, userById),
    );
  }, [overlay, viewer, userById]);

  const tables = useMemo(() => {
    const deleted = new Set(overlay.deletedWindows);
    const all = [...(snapshot?.tables ?? []), ...localSummaries]
      .filter((t) => !deleted.has(t.id))
      .map((t) => {
        const override = overlay.statusOf[t.id] as NegotiationStatus | undefined;
        return override && override !== t.status
          ? { ...t, status: override, statusLabel: statusLabel(override) }
          : t;
      });
    all.sort(
      (a, b) =>
        b.fresh - a.fresh ||
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
        Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
    return all;
  }, [snapshot, localSummaries, overlay.deletedWindows, overlay.statusOf]);

  const tablesRef = useRef(tables);
  tablesRef.current = tables;

  const selectedTable = tables.find((t) => t.id === selectedId) ?? null;

  /* ------------------------------- окна ----------------------------------- */

  /**
   * Закреплённые окна (вкладки мини-шапки). Новые закрепления появляются
   * слева, более старые сдвигаются направо.
   */
  const windows = useMemo(
    () =>
      overlay.openWindows
        .map((key) => tables.find((t) => t.id === key) ?? null)
        .filter((t): t is TableSummary => t !== null),
    [overlay.openWindows, tables],
  );

  /** Закрепить окно в мини-шапке (новое — слева). */
  const pinWindow = useCallback(
    (key: string) => {
      setOverlay((prev) =>
        prev.openWindows.includes(key)
          ? { ...prev, activeWindow: key }
          : {
              ...prev,
              openWindows: [key, ...prev.openWindows],
              activeWindow: key,
            },
      );
    },
    [],
  );

  /** Открыть и закрепить окно (двойной клик, меню, отправка). */
  const openWindow = useCallback(
    (key: string) => {
      setSelectedId(key);
      markSeen(key);
      pinWindow(key);
    },
    [markSeen, pinWindow],
  );

  /** Предпросмотр окна: показать в центре без закрепления (одинарный клик). */
  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      markSeen(id);
      setOverlay((prev) => ({ ...prev, activeWindow: id }));
    },
    [markSeen],
  );

  const closeWindow = useCallback(
    (key: string) => {
      const open = overlayRef.current.openWindows;
      const idx = open.indexOf(key);
      const rest = open.filter((k) => k !== key);
      const nextActive = rest[Math.min(idx, rest.length - 1)] ?? null;
      setOverlay((prev) => ({
        ...prev,
        openWindows: rest,
        activeWindow: prev.activeWindow === key ? nextActive : prev.activeWindow,
      }));
      // Закрыли вкладку: центральное окно продолжает показывать чат как
      // предпросмотр, либо переключается на соседнюю закреплённую вкладку.
      setSelectedId((prev) => (prev === key ? (nextActive ?? prev) : prev));
    },
    [],
  );

  /* ---------------------------- сообщения --------------------------------- */

  useEffect(() => {
    if (!selectedId) {
      loadedTableRef.current = null;
      setRawCard(null);
      setRawMessages([]);
      setChatError(null);
      return;
    }

    if (isLocalWindow(selectedId)) {
      // Локальное окно: данные синхронные, из локального слоя.
      loadedTableRef.current = selectedId;
      setChatLoading(false);
      setChatError(null);
      markSeen(selectedId);
      return;
    }

    if (loadedTableRef.current !== selectedId) {
      loadedTableRef.current = selectedId;
      setRawCard(null);
      setRawMessages([]);
    }

    let cancelled = false;
    setChatLoading(true);
    setChatError(null);

    void (async () => {
      try {
        if (settings.mode === 'demo') {
          const demoProfileViewer = demoViewer(settings.demoProfile);
          const nextCard = demoCard(demoProfileViewer, selectedId);
          const nextMessages = demoMessages(demoProfileViewer, selectedId);
          if (cancelled) return;
          setRawCard(nextCard);
          setRawMessages(nextMessages);
        } else {
          const [nextCard, nextMessages] = await Promise.all([
            fetchCard(settings.apiBase, selectedId),
            fetchMessages(settings.apiBase, selectedId),
          ]);
          if (cancelled) return;
          setRawCard(nextCard);
          setRawMessages(nextMessages);
        }
        markSeen(selectedId);
      } catch (e) {
        if (cancelled) return;
        const err = e instanceof ApiError ? e : new ApiError(0, 'Не удалось открыть стол');
        setChatError(err.message);
        if (err.kind === 'auth') setAuthRequired(true);
      } finally {
        if (!cancelled) setChatLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId, settings.mode, settings.apiBase, settings.demoProfile, refreshTick, markSeen]);

  /** Сообщения активного окна с учётом очищенной истории. */
  const messages = useMemo(() => {
    if (!selectedId) return [];
    const removed = overlay.removed[selectedId] ?? [];
    const base: DeskMessage[] = isLocalWindow(selectedId)
      ? overlay.messages
          .filter((m) => m.windowKey === selectedId)
          .map((m) => ({
            id: m.id,
            sender: m.sender,
            senderName:
              m.sender === viewer?.id
                ? viewer?.name ?? 'вы'
                : userById.get(m.sender)?.name ?? 'участник',
            type: m.type,
            text: m.text,
            files: m.files,
            requiredClearance: m.requiredClearance,
            createdAt: m.createdAt,
            visibleDocuments: m.files?.length ?? 0,
          }))
      : rawMessages;
    return base
      .filter((m) => !removed.includes(m.id))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }, [selectedId, overlay, rawMessages, viewer, userById]);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  /** Карточка активного окна: столовая (с привязками) или локального чата. */
  const card = useMemo(() => {
    if (!selectedId) return null;
    if (isLocalWindow(selectedId)) {
      const chat = overlay.chats[selectedId];
      return chat ? localCardOf(chat, overlay, viewer, userById) : null;
    }
    if (!rawCard) return null;

    const added = overlay.addedMembers[selectedId] ?? [];
    const removedMembers = overlay.removedMembers[selectedId] ?? [];
    const participants = rawCard.participants
      .filter((p) => !removedMembers.includes(p.userId))
      .concat(
        added
          .filter((id) => !rawCard.participants.some((p) => p.userId === id))
          .map((id) => {
            const user = userById.get(id);
            return {
              userId: id,
              name: user?.name ?? 'участник',
              role: 'observer' as ParticipantRole,
              companyId: null,
              companyName: user?.companyName ?? null,
              isInitiator: false,
              clearanceLevel: user?.clearanceLevel ?? 3,
              present: user?.present ?? false,
            };
          }),
      );

    return {
      ...rawCard,
      participants,
      messageCount: messages.length,
    };
  }, [selectedId, overlay, rawCard, viewer, userById, messages.length]);

  /* --------------------------- индекс сообщений ---------------------------- */

  const loadMessagesIndex = useCallback(async () => {
    setIndexLoading(true);
    try {
      const overlay = overlayRef.current;
      const index: Record<string, DeskMessage[]> = {};
      const members: Record<string, string[]> = {};
      const removedMap = overlay.removed;
      const extra: Record<string, DeskUser> = {};

      const absorbCard = (id: string, tableCard: TableCard | null) => {
        members[id] = tableCard?.participants.map((p) => p.userId) ?? [];
        for (const p of tableCard?.participants ?? []) {
          extra[p.userId] = {
            id: p.userId,
            name: p.name,
            companyName: p.companyName,
            clearanceLevel: p.clearanceLevel,
            present: p.present,
          };
        }
      };

      if (settings.mode === 'demo') {
        const demoProfileViewer = demoViewer(settings.demoProfile);
        for (const t of snapshot?.tables ?? []) {
          const removed = removedMap[t.id] ?? [];
          index[t.id] = demoMessages(demoProfileViewer, t.id).filter((m) => !removed.includes(m.id));
          absorbCard(t.id, demoCard(demoProfileViewer, t.id));
        }
      } else {
        const ids = (snapshot?.tables ?? []).map((t) => t.id);
        const results = await Promise.allSettled(
          ids.map(async (id) => {
            const [msgs, tableCard] = await Promise.all([
              fetchMessages(settings.apiBase, id),
              fetchCard(settings.apiBase, id),
            ]);
            return { id, msgs, tableCard };
          }),
        );
        for (const result of results) {
          if (result.status !== 'fulfilled') continue;
          const { id, msgs, tableCard } = result.value;
          const removed = removedMap[id] ?? [];
          index[id] = msgs.filter((m) => !removed.includes(m.id));
          absorbCard(id, tableCard);
        }
      }

      for (const chat of Object.values(overlay.chats)) {
        const removed = removedMap[chat.id] ?? [];
        members[chat.id] = chat.participantIds;
        index[chat.id] = overlay.messages
          .filter((m) => m.windowKey === chat.id && !removed.includes(m.id))
          .map((m) => ({
            id: m.id,
            sender: m.sender,
            senderName: userByIdRef.current.get(m.sender)?.name ?? 'участник',
            type: m.type,
            text: m.text,
            files: m.files,
            requiredClearance: m.requiredClearance,
            createdAt: m.createdAt,
            visibleDocuments: m.files?.length ?? 0,
          }));
      }

      indexBuiltRef.current = true;
      setMsgIndex(index);
      setMembersIndex(members);
      setExtraUsers((prev) => ({ ...extra, ...prev }));
    } finally {
      setIndexLoading(false);
    }
    // Данные читаем из overlayRef, чтобы не перестраивать индекс при смене вкладок.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mode, settings.apiBase, snapshot, viewer]);

  const ensureMessagesIndex = useCallback(() => {
    if (indexBuiltRef.current) return;
    void loadMessagesIndex();
  }, [loadMessagesIndex]);

  // Индекс обновляется вслед за изменениями данных (не вкладок), если уже строился.
  const overlayDataKey = useMemo(
    () =>
      JSON.stringify([
        overlay.chats,
        overlay.messages,
        overlay.removed,
        overlay.addedMembers,
        overlay.removedMembers,
      ]),
    [overlay],
  );

  useEffect(() => {
    if (indexBuiltRef.current) void loadMessagesIndex();
  }, [overlayDataKey, loadMessagesIndex]);

  /* ------------------------------- действия ------------------------------- */

  const refresh = useCallback(async () => {
    await loadSnapshot(true);
    setRefreshTick((v) => v + 1);
    if (indexBuiltRef.current) void loadMessagesIndex();
  }, [loadSnapshot, loadMessagesIndex]);

  const send = useCallback(
    async (
      text: string,
      requiredClearance: number,
      files?: string[] | null,
    ): Promise<boolean> => {
      const trimmed = text.trim();
      const attachments = files?.length ? files : null;
      if (!selectedId || (!trimmed && !attachments) || sending) return false;
      setSending(true);

      try {
        if (isLocalWindow(selectedId)) {
          const viewerId = viewer?.id ?? 'u-unknown';
          const message = makeLocalMessage({
            windowKey: selectedId,
            sender: viewerId,
            text: trimmed || null,
            files: attachments,
            requiredClearance,
          });
          setOverlay((prev) => ({ ...prev, messages: [...prev.messages, message] }));
        } else if (settings.mode === 'demo') {
          const demoProfileViewer = demoViewer(settings.demoProfile);
          const message = demoSend(demoProfileViewer, selectedId, {
            text: trimmed,
            requiredClearance,
            files: attachments,
          });
          setRawMessages((prev) => [...prev, message]);
          setSnapshot(demoSnapshot(demoProfileViewer));
        } else {
          await postMessage(settings.apiBase, selectedId, {
            text: trimmed,
            requiredClearance,
            files: attachments,
          });
          const [nextMessages, snap] = await Promise.all([
            fetchMessages(settings.apiBase, selectedId),
            fetchSnapshot(settings.apiBase),
          ]);
          setRawMessages(nextMessages);
          setSnapshot(snap);
        }
        markSeen(selectedId);
        pinWindow(selectedId);
        setNotice('Сообщение отправлено');
        return true;
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError(0, 'Не удалось отправить сообщение');
        setChatError(err.message);
        if (err.kind === 'auth') setAuthRequired(true);
        return false;
      } finally {
        setSending(false);
      }
    },
    [selectedId, sending, viewer, settings.mode, settings.apiBase, settings.demoProfile, markSeen, pinWindow],
  );

  /* -------------------- окна-чаты и участники: операции -------------------- */

  const createLocalChat = useCallback(
    (input: {
      kind: LocalChatKind;
      title: string;
      peerId?: string | null;
      participantIds: string[];
    }): string => {
      const participantIds = [...new Set(input.participantIds)];
      const memberNames: Record<string, string> = {};
      for (const id of participantIds) {
        memberNames[id] = userByIdRef.current.get(id)?.name ?? 'участник';
      }
      if (viewer && !participantIds.includes(viewer.id)) {
        participantIds.push(viewer.id);
        memberNames[viewer.id] = viewer.name ?? 'вы';
      }
      const chat = makeLocalChat({ ...input, participantIds, memberNames });
      // Новое окно сразу видно в центре, но в мини-шапке закрепляется только
      // по двойному клику или после отправки сообщения.
      setOverlay((prev) => ({
        ...prev,
        chats: { ...prev.chats, [chat.id]: chat },
        activeWindow: chat.id,
      }));
      setSelectedId(chat.id);
      markSeen(chat.id);
      return chat.id;
    },
    [viewer, markSeen],
  );

  const renameLocalChat = useCallback((key: string, title: string) => {
    setOverlay((prev) => {
      const chat = prev.chats[key];
      if (!chat) return prev;
      return {
        ...prev,
        chats: { ...prev.chats, [key]: { ...chat, title: title.trim() || chat.title } },
      };
    });
  }, []);

  const setLocalChatMembers = useCallback((key: string, memberIds: string[]) => {
    setOverlay((prev) => {
      const chat = prev.chats[key];
      if (!chat) return prev;
      const memberNames = { ...chat.memberNames };
      for (const id of memberIds) {
        if (!memberNames[id]) memberNames[id] = userByIdRef.current.get(id)?.name ?? 'участник';
      }
      return {
        ...prev,
        chats: {
          ...prev.chats,
          [key]: { ...chat, participantIds: [...new Set(memberIds)], memberNames },
        },
      };
    });
  }, []);

  /** Привязать участника к окну (перетаскивание, дерево, меню). */
  const bindParticipant = useCallback(
    (windowKey: string, userId: string) => {
      setOverlay((prev) => {
        if (isLocalWindow(windowKey)) {
          const chat = prev.chats[windowKey];
          if (!chat || chat.participantIds.includes(userId)) return prev;
          const name =
            userByIdRef.current.get(userId)?.name ?? chat.memberNames[userId] ?? 'участник';
          return {
            ...prev,
            chats: {
              ...prev.chats,
              [windowKey]: {
                ...chat,
                participantIds: [...chat.participantIds, userId],
                memberNames: { ...chat.memberNames, [userId]: name },
              },
            },
          };
        }
        const removedMembers = (prev.removedMembers[windowKey] ?? []).filter((id) => id !== userId);
        const added = prev.addedMembers[windowKey] ?? [];
        return {
          ...prev,
          removedMembers: { ...prev.removedMembers, [windowKey]: removedMembers },
          addedMembers: {
            ...prev.addedMembers,
            [windowKey]: added.includes(userId) ? added : [...added, userId],
          },
        };
      });
      setNotice('Участник привязан к окну');
    },
    [],
  );

  /** Убрать участника из окна. */
  const unbindParticipant = useCallback((windowKey: string, userId: string) => {
    setOverlay((prev) => {
      if (isLocalWindow(windowKey)) {
        const chat = prev.chats[windowKey];
        if (!chat) return prev;
        return {
          ...prev,
          chats: {
            ...prev.chats,
            [windowKey]: {
              ...chat,
              participantIds: chat.participantIds.filter((id) => id !== userId),
            },
          },
        };
      }
      const added = (prev.addedMembers[windowKey] ?? []).filter((id) => id !== userId);
      const removedMembers = prev.removedMembers[windowKey] ?? [];
      return {
        ...prev,
        addedMembers: { ...prev.addedMembers, [windowKey]: added },
        removedMembers: {
          ...prev.removedMembers,
          [windowKey]: removedMembers.includes(userId) ? removedMembers : [...removedMembers, userId],
        },
      };
    });
    setNotice('Участник убран из окна');
  }, []);

  /** Очистить историю участника: count последних сообщений, начиная от конца. */
  const clearParticipantMessages = useCallback(
    (userId: string, count: number) => {
      const key = selectedId;
      if (!key || count <= 0) return;
      const targets = messagesRef.current
        .filter((m) => m.sender === userId)
        .slice(-count)
        .map((m) => m.id);
      if (targets.length === 0) return;

      setOverlay((prev) => {
        if (isLocalWindow(key)) {
          return {
            ...prev,
            messages: prev.messages.filter((m) => !targets.includes(m.id)),
          };
        }
        const removed = new Set(prev.removed[key] ?? []);
        for (const id of targets) removed.add(id);
        return { ...prev, removed: { ...prev.removed, [key]: [...removed] } };
      });
      setNotice(`Удалено сообщений: ${targets.length}`);
    },
    [selectedId],
  );

  /** Статус окна из меню «≡» в шапке чата. */
  const setWindowStatus = useCallback((windowKey: string, status: NegotiationStatus) => {
    setOverlay((prev) => ({
      ...prev,
      statusOf: { ...prev.statusOf, [windowKey]: status },
    }));
    setNotice(`Статус: ${statusLabel(status)}`);
  }, []);

  /** Удалить окно (после проверки пароля в диалоге). */
  const deleteWindow = useCallback(
    (windowKey: string) => {
      const local = isLocalWindow(windowKey);
      const open = overlayRef.current.openWindows;
      const idx = open.indexOf(windowKey);
      const rest = open.filter((k) => k !== windowKey);
      const nextActive = rest[Math.min(idx, rest.length - 1)] ?? null;

      setOverlay((prev) => {
        const statusOf = { ...prev.statusOf };
        delete statusOf[windowKey];
        const removed = { ...prev.removed };
        delete removed[windowKey];
        const addedMembers = { ...prev.addedMembers };
        delete addedMembers[windowKey];
        const removedMembers = { ...prev.removedMembers };
        delete removedMembers[windowKey];
        const chats = { ...prev.chats };
        delete chats[windowKey];
        const chatCategories = { ...prev.chatCategories };
        delete chatCategories[windowKey];
        return {
          ...prev,
          chats,
          chatCategories,
          messages: local
            ? prev.messages.filter((m) => m.windowKey !== windowKey)
            : prev.messages,
          removed,
          addedMembers,
          removedMembers,
          statusOf,
          deletedWindows: local
            ? prev.deletedWindows
            : prev.deletedWindows.includes(windowKey)
              ? prev.deletedWindows
              : [...prev.deletedWindows, windowKey],
          openWindows: rest,
          activeWindow: prev.activeWindow === windowKey ? nextActive : prev.activeWindow,
        };
      });
      setSelectedId((prev) => (prev === windowKey ? nextActive : prev));
      setNotice('Чат удалён');
    },
    [],
  );

  /** В закрытом чате отправка недоступна. */
  const canWrite = (selectedTable?.status ?? 'open') !== 'closed';

  /** Собрать активный чат и сохранить его в Word на устройство. */
  const saveChatToWord = useCallback(async (): Promise<void> => {
    const key = selectedId;
    const table = selectedTable;
    if (!key || !table) return;
    const result = await exportChatToWord({
      title: table.title,
      status: table.status,
      participants: card?.participants ?? [],
      messages: messagesRef.current,
    });
    setNotice(result);
  }, [selectedId, selectedTable, card]);

  /** Окна, в которых сидит участник. */
  const windowsOfUser = useCallback(
    (userId: string): TableSummary[] => {
      return tablesRef.current.filter((table) => {
        if (isLocalWindow(table.id)) {
          return overlay.chats[table.id]?.participantIds.includes(userId) ?? false;
        }
        const added = overlay.addedMembers[table.id] ?? [];
        const removedMembers = overlay.removedMembers[table.id] ?? [];
        if (removedMembers.includes(userId)) return false;
        if (added.includes(userId)) return true;
        const known =
          membersIndex[table.id] ??
          (rawCard?.table.id === table.id ? rawCard.participants.map((p) => p.userId) : []);
        return known.includes(userId);
      });
    },
    [overlay, membersIndex, rawCard],
  );

  /** Файлы, которые зритель передал в этом окне (участнику показываем по его окнам). */
  const filesToUser = useCallback(
    (windowKey: string): string[] => {
      const source = windowKey === selectedId ? messages : msgIndex[windowKey] ?? [];
      return source
        .filter((m) => m.sender === viewer?.id && Boolean(m.files?.length))
        .flatMap((m) => m.files ?? []);
    },
    [msgIndex, messages, selectedId, viewer],
  );

  /** Участники окна с учётом ручных привязок. */
  const usersOfWindow = useCallback(
    (windowKey: string): string[] => {
      if (isLocalWindow(windowKey)) {
        return overlay.chats[windowKey]?.participantIds ?? [];
      }
      const added = overlay.addedMembers[windowKey] ?? [];
      const removedMembers = overlay.removedMembers[windowKey] ?? [];
      const base =
        membersIndex[windowKey] ??
        (rawCard?.table.id === windowKey ? rawCard.participants.map((p) => p.userId) : []);
      return [...new Set([...base.filter((id) => !removedMembers.includes(id)), ...added])];
    },
    [overlay, membersIndex, rawCard],
  );

  /** Сообщения участника в окне. */
  const countOf = useCallback(
    (windowKey: string, userId: string): number => {
      const source = windowKey === selectedId ? messages : msgIndex[windowKey] ?? [];
      return source.filter((m) => m.sender === userId).length;
    },
    [msgIndex, messages, selectedId],
  );

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      return {
        ...next,
        apiBase: next.apiBase.trim().replace(/\/+$/, ''),
        siteUrl: (next.siteUrl.trim() || DEFAULTS.siteUrl).replace(/\/+$/, ''),
      };
    });
  }, []);

  const resetDemoData = useCallback(() => {
    resetDemo();
    setSelectedId(null);
    setSnapshot(null);
    setRefreshTick((v) => v + 1);
    void loadSnapshot(true);
    setNotice('Демо-данные восстановлены');
  }, [loadSnapshot]);

  const notify = useCallback((message: string) => setNotice(message), []);

  const totalFresh = tables.reduce((sum, t) => sum + freshOf(t), 0);
  const hasUnread = totalFresh > 0;

  return {
    settings,
    scope,
    viewer,
    snapshot,
    tables,
    selectedId,
    selectedTable,
    card,
    messages,
    loading,
    chatLoading,
    sending,
    error,
    chatError,
    authRequired,
    notice,
    online,
    totalFresh,
    hasUnread,
    freshOf,
    signalOf,
    select,
    refresh,
    send,
    updateSettings,
    resetDemoData,
    notify,
    clearNotice: () => setNotice(null),

    /* окна-чаты */
    windows,
    openWindow,
    closeWindow,
    pinWindow,

    /* статусы и удаление */
    setWindowStatus,
    deleteWindow,
    canWrite,
    saveChatToWord,

    /* участники: каталог, привязки, действия */
    allUsers,
    userById,
    highlightUserId,
    setHighlightUserId,
    selectedUserId,
    setSelectedUserId,
    bindParticipant,
    unbindParticipant,
    clearParticipantMessages,
    windowsOfUser,
    usersOfWindow,
    filesToUser,
    countOf,

    /* категории чатов */
    builtinCategoriesOf,
    categoriesOf,
    addCustomCategory,
    removeCustomCategory,
    setChatCategory,

    /* локальные чаты */
    createLocalChat,
    renameLocalChat,
    setLocalChatMembers,
    overlay,

    /* индекс сообщений (поиск и файлы) */
    msgIndex,
    membersIndex,
    indexLoading,
    loadMessagesIndex,
    ensureMessagesIndex,
  };
}

export type DeskController = ReturnType<typeof useDesk>;
