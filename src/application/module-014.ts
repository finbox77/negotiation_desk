// application/module-014.ts — устойчивость модулей миграции 014.
//
// Кабинет-конструктор, тендеры, сервис и «Личное» живут в таблицах миграции 014.
// Пока она не применена к PostgreSQL, запросы падают с ошибкой «relation … does not
// exist» — вместо пятисотки модуль должен работать пустым (списки пусты, бейджи 0),
// а попытка записи — отвечать понятным сообщением.
//
// Репозитории памяти этой обвязки не требуют: там коллекции есть всегда.

import { DomainError } from '@/shared/errors';

/** Таблица ещё не создана (миграция 014 не применена)? */
export function isMissingTable(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  if (code === '42P01') return true;
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return /relation .* does not exist/i.test(message) || /таблиц\w* .*не найдена/i.test(message);
}

/** Чтение списка: таблицы нет → пусто + предупреждение в лог сервера. */
export async function optionalList<T>(run: () => Promise<T[]>, what: string): Promise<T[]> {
  try {
    return await run();
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    console.warn(
      `[simonix] ${what}: таблицы нет — примените migrations/014_cabinet_modules.sql (модуль работает пустым)`,
    );
    return [];
  }
}

/** Чтение объекта или запись: таблицы нет → 503 с подсказкой про миграцию. */
export async function requireModule014<T>(run: () => Promise<T>, what: string): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    throw new DomainError(503, `${what}: примените migrations/014_cabinet_modules.sql`);
  }
}
