// application/infrastructure-solutions — «Инфраструктурные решения территорий» (019).
//
// Публичный контур: витрина /solutions показывает опубликованные решения вендоров,
// страница /solutions/[id] — состав решения и переходы на карточки роботов.
// Кабинет/витрина компании: /my-company?s=solutions — свои решения (включая черновики),
// там же создание и правка.
//
// Права на запись: владелец компании или сотрудник с допуском 1 — как у программы
// инфраструктурных решений (company-passport.updateCompanySolutionProgram).
// Если миграция 019 ещё не применена к PostgreSQL, чтение отдаёт пустой список,
// а запись — 503 с подсказкой применить миграцию (таблиц в памяти это не касается).

import { getContainer } from '@/infrastructure/container';
import { DomainError, errForbidden, errNotFound } from '@/shared/errors';
import { isMissingTable } from './module-014';
import {
  SOLUTION_LIMITS,
  type Company,
  type InfrastructureSolution,
  type InfrastructureSolutionPatch,
  type Product,
  type Viewer,
} from '@/domain';

/** Решение вместе с компанией-вендором — карточка витрины. */
export type SolutionWithCompany = {
  solution: InfrastructureSolution;
  company: Company | null;
  /** Сколько карточек роботов входит в состав решения. */
  robotCount: number;
};

/** Страница решения: сама программа, вендор, роботы и другие решения этого вендора. */
export type SolutionPage = {
  solution: InfrastructureSolution;
  company: Company | null;
  /** Карточки роботов, входящие в решение (только доступные на витрине). */
  products: Product[];
  /** Другие решения того же вендора — ссылка «Другие инфраструктурные решения территорий». */
  others: SolutionWithCompany[];
  /** Может ли смотрящий редактировать это решение. */
  canEdit: boolean;
};

async function optionalSolutions<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    console.warn('[simonix] инфраструктурные решения: примените migrations/019_infrastructure_solutions.sql');
    return fallback;
  }
}

/** Запись без миграции 019 невозможна — говорим, какой файл применить. */
async function require019<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    throw new DomainError(503, 'Инфраструктурные решения: примените migrations/019_infrastructure_solutions.sql');
  }
}

function withCompany(
  solution: InfrastructureSolution,
  byId: Map<string, Company>,
): SolutionWithCompany {
  return {
    solution,
    company: byId.get(solution.company) ?? null,
    robotCount: solution.product_ids.length,
  };
}

async function companyIndex(): Promise<Map<string, Company>> {
  const { deps } = getContainer();
  const rows = await deps.companies.list().catch(() => [] as Company[]);
  return new Map(rows.map((c) => [c.id, c]));
}

/**
 * Опубликованные решения всех вендоров — витрина /solutions.
 * Порядок: свежие обновления выше (репозиторий уже сортирует), компании-невидимки
 * (удалённые/скрытые) в карточках остаются без названия, но не ломают список.
 */
export async function listPublicSolutions(): Promise<SolutionWithCompany[]> {
  const { deps } = getContainer();
  const [rows, byId] = await Promise.all([
    optionalSolutions(() => deps.infrastructure.list(), [] as InfrastructureSolution[]),
    companyIndex(),
  ]);
  return rows.filter((s) => s.published).map((s) => withCompany(s, byId));
}

/**
 * Опубликованные решения конкретной компании — блок «Инфраструктурные решения
 * территорий» на публичной странице компании (/companies/[id]#infrastructure-solutions).
 */
export async function listPublishedSolutionsForCompany(companyId: string): Promise<SolutionWithCompany[]> {
  const { deps } = getContainer();
  const [rows, byId] = await Promise.all([
    optionalSolutions(() => deps.infrastructure.listForCompany(companyId), [] as InfrastructureSolution[]),
    companyIndex(),
  ]);
  return rows.filter((s) => s.published).map((s) => withCompany(s, byId));
}

/** Свои решения компании (включая черновики) — раздел «Моя компания» → «Решения». */
export async function listCompanySolutions(viewer: Viewer): Promise<InfrastructureSolution[]> {
  if (!viewer.companyId) return [];
  const { deps } = getContainer();
  return optionalSolutions(
    () => deps.infrastructure.listForCompany(viewer.companyId as string),
    [] as InfrastructureSolution[],
  );
}

/** Решения, в состав которых входит робот — упоминание на карточке товара. */
export async function listSolutionsForProduct(productId: string): Promise<InfrastructureSolution[]> {
  const { deps } = getContainer();
  return optionalSolutions(
    () => deps.infrastructure.listForProduct(productId),
    [] as InfrastructureSolution[],
  );
}

/** Право вести решения компании: владелец или допуск 1 (как у рекламного паспорта). */
export function canManageSolutions(viewer: Viewer): boolean {
  return Boolean(viewer.companyId) && (viewer.type === 'company_owner' || viewer.clearanceLevel === 1);
}

/** Ссылка на решение для блока «Инфраструктурное решение территорий» в редакторе карточки. */
export type SolutionRef = {
  id: string;
  title: string;
  published: boolean;
  /** Входит ли карточка товара в состав решения. */
  includes: boolean;
};

/**
 * Решения компании для блока в редакторе карточки: свои — включая черновики,
 * чужие (карточка чужой компании) — только опубликованные.
 */
export async function listEditorSolutionRefs(
  productId: string,
  companyId: string | null,
  viewer: Viewer | null,
): Promise<SolutionRef[]> {
  if (!companyId) return [];
  const { deps } = getContainer();
  const rows = await optionalSolutions(
    () => deps.infrastructure.listForCompany(companyId),
    [] as InfrastructureSolution[],
  );
  const canManage = Boolean(viewer && viewer.companyId === companyId && canManageSolutions(viewer));
  return rows
    .filter((solution) => solution.published || canManage)
    .sort((a, b) => Number(b.published) - Number(a.published) || a.title.localeCompare(b.title, 'ru'))
    .map((solution) => ({
      id: solution.id,
      title: solution.title,
      published: solution.published,
      includes: solution.product_ids.includes(productId),
    }));
}

async function ownCompany(viewer: Viewer) {
  const { deps } = getContainer();
  if (!viewer.companyId) throw errForbidden('К учётной записи не привязана компания');
  const company = await deps.companies.findById(viewer.companyId);
  if (!company) throw errNotFound('Компания');
  if (company.owner !== viewer.userId && viewer.clearanceLevel !== 1) {
    throw errForbidden('Решения компании ведёт владелец или директор компании');
  }
  return company;
}

/**
 * Публичная страница решения.
 * Черновик видит только компания-владелец (владелец/директор), для остальных — 404.
 */
export async function getSolutionPage(id: string, viewer: Viewer | null): Promise<SolutionPage | null> {
  const { deps } = getContainer();
  const solution = await optionalSolutions(() => deps.infrastructure.findById(id), null as InfrastructureSolution | null);
  if (!solution) return null;

  const canEdit =
    Boolean(viewer && viewer.companyId === solution.company) &&
    Boolean(viewer && canManageSolutions(viewer));
  if (!solution.published && !canEdit) return null;

  const byId = await companyIndex();
  const products: Product[] = [];
  for (const productId of solution.product_ids) {
    const product = await deps.products.findById(productId).catch(() => null);
    // На публичной странице — только опубликованные офферы; владелец видит и черновики.
    if (!product) continue;
    if (!product.published && !canEdit) continue;
    products.push(product);
  }
  const others = (
    await optionalSolutions(
      () => deps.infrastructure.listForCompany(solution.company),
      [] as InfrastructureSolution[],
    )
  )
    .filter((s) => s.id !== solution.id && (s.published || canEdit))
    .map((s) => withCompany(s, byId));

  return { solution, company: byId.get(solution.company) ?? null, products, others, canEdit };
}

/**
 * Данные формы решения: компания смотрящего, само решение (null — создание)
 * и карточки роботов компании, из которых собирается состав.
 */
export async function getSolutionEditorContext(viewer: Viewer, id: string | null) {
  const company = await ownCompany(viewer);
  const { deps } = getContainer();
  // Доступные роботы: офферы компании (решения собираются только из своих карточек).
  const offers = await deps.products.listForCompany(company.id, 200).catch(() => [] as Product[]);
  if (!id || id === 'new') return { company, solution: null, offers };
  const solution = await optionalSolutions(
    () => deps.infrastructure.findById(id),
    null as InfrastructureSolution | null,
  );
  if (!solution || solution.company !== company.id) throw errNotFound('Инфраструктурное решение');
  return { company, solution, offers };
}

export type SolutionInput = {
  title: unknown;
  summary?: unknown;
  description?: unknown;
  implementation_term?: unknown;
  area?: unknown;
  base_price_from?: unknown;
  robot_types?: unknown;
  product_ids?: unknown;
  published?: unknown;
};

function text(value: unknown, label: string, limit: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new DomainError(400, `${label}: ожидается текст`);
  const trimmed = value.trim();
  if (trimmed.length > limit) throw new DomainError(400, `${label}: максимум ${limit} символов`);
  return trimmed || null;
}

function stringList(value: unknown, label: string, limit: number, itemLimit: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new DomainError(400, `${label}: ожидается список`);
  if (value.length > limit) throw new DomainError(400, `${label}: не больше ${limit} значений`);
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') throw new DomainError(400, `${label}: значения должны быть текстом`);
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (trimmed.length > itemLimit) throw new DomainError(400, `${label}: запись длиннее ${itemLimit} символов`);
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

function priceFrom(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.,-]/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new DomainError(400, 'Цена базового предложения: укажите неотрицательное число');
  if (n > 1e12) throw new DomainError(400, 'Цена базового предложения: слишком большое число');
  return Math.round(n);
}

async function assertProductsBelongToCompany(companyId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { deps } = getContainer();
  const offers = await deps.products.listForCompany(companyId, 10000).catch(() => [] as Product[]);
  const allowed = new Set(offers.map((p) => p.id));
  const stray = ids.filter((id) => !allowed.has(id));
  if (stray.length > 0) {
    throw new DomainError(400, 'В состав решения можно включать только карточки своей компании');
  }
}

/** Создание решения: название обязательно, остальное — по желанию. */
export async function createSolution(viewer: Viewer, input: SolutionInput): Promise<InfrastructureSolution> {
  const company = await ownCompany(viewer);
  const title = text(input.title, 'Название решения', SOLUTION_LIMITS.title);
  if (!title) throw new DomainError(400, 'Название решения обязательно');
  const productIds = stringList(input.product_ids, 'Состав решения', SOLUTION_LIMITS.products, 40);
  await assertProductsBelongToCompany(company.id, productIds);
  const { deps } = getContainer();
  return require019(() =>
    deps.infrastructure.create({
      company: company.id,
      title,
      summary: text(input.summary, 'Краткое описание', SOLUTION_LIMITS.summary),
      description: text(input.description, 'Описание решения', SOLUTION_LIMITS.description),
      implementation_term: text(input.implementation_term, 'Срок реализации', SOLUTION_LIMITS.implementationTerm),
      area: text(input.area, 'Площадь', SOLUTION_LIMITS.area),
      base_price_from: priceFrom(input.base_price_from),
      robot_types: stringList(input.robot_types, 'Типы роботов', SOLUTION_LIMITS.robotTypes, SOLUTION_LIMITS.robotTypeLength),
      product_ids: productIds,
      published: input.published === undefined ? true : input.published === true,
    }),
  );
}

/** Полная замена полей решения (форма присылает весь набор). */
export async function updateSolution(
  viewer: Viewer,
  id: string,
  input: SolutionInput,
): Promise<InfrastructureSolution> {
  const company = await ownCompany(viewer);
  const { deps } = getContainer();
  const existing = await optionalSolutions(
    () => deps.infrastructure.findById(id),
    null as InfrastructureSolution | null,
  );
  if (!existing || existing.company !== company.id) throw errNotFound('Инфраструктурное решение');
  const title = text(input.title, 'Название решения', SOLUTION_LIMITS.title);
  if (!title) throw new DomainError(400, 'Название решения обязательно');
  const productIds = stringList(input.product_ids, 'Состав решения', SOLUTION_LIMITS.products, 40);
  await assertProductsBelongToCompany(company.id, productIds);

  const patch: InfrastructureSolutionPatch = {
    title,
    summary: text(input.summary, 'Краткое описание', SOLUTION_LIMITS.summary),
    description: text(input.description, 'Описание решения', SOLUTION_LIMITS.description),
    implementation_term: text(input.implementation_term, 'Срок реализации', SOLUTION_LIMITS.implementationTerm),
    area: text(input.area, 'Площадь', SOLUTION_LIMITS.area),
    base_price_from: priceFrom(input.base_price_from),
    robot_types: stringList(input.robot_types, 'Типы роботов', SOLUTION_LIMITS.robotTypes, SOLUTION_LIMITS.robotTypeLength),
    product_ids: productIds,
    published: input.published === undefined ? existing.published : input.published === true,
  };
  return require019(() => deps.infrastructure.update(id, patch));
}

/** Удаление решения. Ссылки из карточек товаров не трогаем — состав пересоберут заново. */
export async function deleteSolution(viewer: Viewer, id: string): Promise<void> {
  const company = await ownCompany(viewer);
  const { deps } = getContainer();
  const existing = await optionalSolutions(
    () => deps.infrastructure.findById(id),
    null as InfrastructureSolution | null,
  );
  if (!existing || existing.company !== company.id) throw errNotFound('Инфраструктурное решение');
  await require019(() => deps.infrastructure.remove(id));
}

/**
 * Добавить робота в решение (или убрать) без полной формы — используется ссылкой
 * «робот участвует в программе» из редактора карточки товара.
 */
export async function toggleSolutionProduct(
  viewer: Viewer,
  id: string,
  productId: string,
  include: boolean,
): Promise<InfrastructureSolution> {
  const company = await ownCompany(viewer);
  const { deps } = getContainer();
  const existing = await optionalSolutions(
    () => deps.infrastructure.findById(id),
    null as InfrastructureSolution | null,
  );
  if (!existing || existing.company !== company.id) throw errNotFound('Инфраструктурное решение');
  await assertProductsBelongToCompany(company.id, [productId]);
  const next = include
    ? [...new Set([...existing.product_ids, productId])]
    : existing.product_ids.filter((x) => x !== productId);
  if (next.length > SOLUTION_LIMITS.products) {
    throw new DomainError(400, `В решении не больше ${SOLUTION_LIMITS.products} карточек роботов`);
  }
  return require019(() => deps.infrastructure.update(id, { product_ids: next }));
}
