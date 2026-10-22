// desk/config.ts — значения по умолчанию из .env.
//
// VITE_* переменные встраиваются в сборку; DESK_API_PROXY читает только
// vite.config.ts и в браузер не попадает.

import type { DeskMode, ThemeMode } from './types';

const env = import.meta.env;

function guessSiteUrl(): string {
  const fromEnv = (env.VITE_DESK_SITE_URL as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  if (typeof window === 'undefined') return 'http://localhost:3000';

  // В dev-режиме приложение живёт на :5174, сайт — на :3000 того же хоста.
  // На телефоне в локальной сети это будет http://192.168.x.x:3000.
  if (window.location.port === '5174') {
    return `${window.location.protocol}//${window.location.hostname}:3000`;
  }

  // Превью-стенд вида 5174-<sandbox>.e2b.app: соседний порт — тот же хост
  // с префиксом 3000-. Пригодится, чтобы ссылка «Войти» вела на живой сайт.
  if (/(^|\.)e2b\.app$/.test(window.location.hostname) && window.location.hostname.startsWith('5174-')) {
    return `${window.location.protocol}//3000-${window.location.hostname.slice('5174-'.length)}`;
  }

  return window.location.origin;
}

export const DEFAULTS = {
  mode: (env.VITE_DESK_MODE === 'site' ? 'site' : 'demo') as DeskMode,
  apiBase: ((env.VITE_DESK_API_BASE as string | undefined) ?? '').trim().replace(/\/+$/, ''),
  siteUrl: guessSiteUrl(),
  theme: 'system' as ThemeMode,
};

export const STORAGE = {
  settings: 'simonix.desk.settings.v1',
  seen: 'simonix.desk.seen.v1',
  local: 'simonix.desk.local.v1',
};
