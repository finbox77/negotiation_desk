// desk/format.ts — даты, числа и инициалы без внешних библиотек.

const pad = (n: number): string => String(n).padStart(2, '0');

export function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function dateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** «Сегодня», «Вчера» или «12 октября». */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (day === today) return 'Сегодня';
  if (day === today - 24 * 3600 * 1000) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

/** Компактно: «5 мин», «2 ч», «вчера», «12.10». */
export function relativeTime(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return 'только что';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} мин`;
  if (diff < 24 * 3600_000) return `${Math.floor(diff / 3600_000)} ч`;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateKey(iso) === dateKey(yesterday.toISOString())) return 'вчера';
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

export function money(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(value);
}

/** Стабильный цвет аватара по имени: 6 спокойных оттенков. */
const AVATAR_COLORS = [
  '#1f4e8c',
  '#1d6a3c',
  '#7d4e27',
  '#4d5f6b',
  '#6d3f8c',
  '#b45309',
];

export function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
