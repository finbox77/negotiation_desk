// useDesk — состояние приложения: настройки, снимок стола, открытый стол,
// сообщения и отправка. Один хук на всё приложение: данных мало, а так
// переключение «демо ↔ сайт» не растаскивается по компонентам.

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
  demoMessages,
  demoSend,
  demoSnapshot,
  demoViewer,
  resetDemo,
} from './demo';
import type {
  DemoProfileId,
  DeskMessage,
  DeskMode,
  DeskSignal,
  DeskSnapshot,
  Settings,
  TableCard,
  TableSummary,
  ThemeMode,
  Viewer,
} from './types';

type SeenMap = Record<string, Record<string, string>>;

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

export function useDesk() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [snapshot, setSnapshot] = useState<DeskSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [card, setCard] = useState<TableCard | null>(null);
  const [messages, setMessages] = useState<DeskMessage[]>([]);
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
  /** Какой стол уже загружен: при переключении чистим ленту, при refresh — нет. */
  const loadedTableRef = useRef<string | null>(null);

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

  /* ------------------------------- загрузка ------------------------------- */

  const loadSnapshot = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);

      if (settings.mode === 'demo') {
        const nextViewer = demoViewer(settings.demoProfile);
        const snap = demoSnapshot(nextViewer);
        setSnapshot(snap);
        setAuthRequired(false);
        setSelectedId((prev) =>
          prev && snap.tables.some((t) => t.id === prev) ? prev : null,
        );
        if (!silent) setLoading(false);
        return;
      }

      try {
        const snap = await fetchSnapshot(settings.apiBase);
        setSnapshot(snap);
        setAuthRequired(false);
        setSelectedId((prev) =>
          prev && snap.tables.some((t) => t.id === prev) ? prev : null,
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

  /* ------------------------------- открытие ------------------------------- */

  const select = useCallback((id: string) => setSelectedId(id), []);

  useEffect(() => {
    if (!selectedId) {
      loadedTableRef.current = null;
      setCard(null);
      setMessages([]);
      setChatError(null);
      return;
    }

    if (loadedTableRef.current !== selectedId) {
      loadedTableRef.current = selectedId;
      setCard(null);
      setMessages([]);
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
          setCard(nextCard);
          setMessages(nextMessages);
        } else {
          const [nextCard, nextMessages] = await Promise.all([
            fetchCard(settings.apiBase, selectedId),
            fetchMessages(settings.apiBase, selectedId),
          ]);
          if (cancelled) return;
          setCard(nextCard);
          setMessages(nextMessages);
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
  }, [
    selectedId,
    settings.mode,
    settings.apiBase,
    settings.demoProfile,
    refreshTick,
    markSeen,
  ]);

  /* ------------------------------- действия ------------------------------- */

  const refresh = useCallback(async () => {
    await loadSnapshot(true);
    setRefreshTick((v) => v + 1);
  }, [loadSnapshot]);

  const send = useCallback(
    async (text: string, requiredClearance: number): Promise<boolean> => {
      const trimmed = text.trim();
      if (!selectedId || !trimmed || sending) return false;
      setSending(true);

      try {
        if (settings.mode === 'demo') {
          const demoProfileViewer = demoViewer(settings.demoProfile);
          const message = demoSend(demoProfileViewer, selectedId, {
            text: trimmed,
            requiredClearance,
          });
          setMessages((prev) => [...prev, message]);
          setSnapshot(demoSnapshot(demoProfileViewer));
        } else {
          await postMessage(settings.apiBase, selectedId, {
            text: trimmed,
            requiredClearance,
          });
          const [nextMessages, snap] = await Promise.all([
            fetchMessages(settings.apiBase, selectedId),
            fetchSnapshot(settings.apiBase),
          ]);
          setMessages(nextMessages);
          setSnapshot(snap);
        }
        markSeen(selectedId);
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
    [selectedId, sending, settings.mode, settings.apiBase, settings.demoProfile, markSeen],
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

  const tables = snapshot?.tables ?? [];
  const selectedTable = tables.find((t) => t.id === selectedId) ?? null;
  const totalFresh = tables.reduce((sum, t) => sum + freshOf(t), 0);

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
    freshOf,
    signalOf,
    select,
    refresh,
    send,
    updateSettings,
    resetDemoData,
    clearNotice: () => setNotice(null),
  };
}

export type DeskController = ReturnType<typeof useDesk>;
