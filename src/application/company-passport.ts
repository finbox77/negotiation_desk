// application/company-passport — «Моя компания» как рекламный паспорт.
//
// Страница /my-company — витрина для рынка: чем компания полезна, что продаёт,
// в каких торгах участвует, чего добилась, какие новости и акции. Компания сама
// решает, публиковать паспорт или держать скрытым (companies.is_published, 015).
//
// Внутренние вещи (сотрудники, допуски, нагрузка) здесь НЕ показываются —
// они живут в кабинете, раздел «Сотрудники».

import { getContainer } from '@/infrastructure/container';
import { DomainError, errForbidden, errNotFound } from '@/shared/errors';
import { optionalList } from '@/application/module-014';
import type { Company, CompanyPromo, CompanySolutionProgram, ProductWithRank, Viewer } from '@/domain';

export type PassportTender = {
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  budget: number | null;
  deadline: Date | null;
  /** Наш лот (мы заказчик) или наша заявка (мы поставщик). */
  role: 'customer' | 'bidder';
  amount: number | null;
};

export type CompanyPassport = {
  company: Company;
  promo: CompanyPromo;
  /** Карточки-офферы компании. */
  offers: ProductWithRank[];
  /** Карточки-потребности компании. */
  demands: ProductWithRank[];
  /** Офферы, участвующие в инфраструктурных решениях вендоров (has_complex_solution). */
  solutions: ProductWithRank[];
  tenders: PassportTender[];
  stats: {
    offers: number;
    solutions: number;
    tenders: number;
    achievements: number;
    news: number;
    promos: number;
    videos: number;
    /** Заполненность паспорта в процентах — подсказка «что ещё добавить». */
    completeness: number;
  };
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'черновик',
  open: 'приём заявок',
  scoring: 'оценка',
  awarded: 'победитель определён',
  closed: 'закрыт',
  cancelled: 'отменён',
};

const EMPTY_PROMO: CompanyPromo = {
  headline: null,
  about: null,
  achievements: [],
  news: [],
  videos: [],
  promos: [],
};

export async function getCompanyPassport(companyId: string): Promise<CompanyPassport | null> {
  const { deps } = getContainer();
  const company = await deps.companies.findById(companyId);
  if (!company) return null;

  const [offersAll, demandsAll] = await Promise.all([
    deps.products.findPublished({ intent: 'offer' }),
    deps.products.findPublished({ intent: 'demand' }),
  ]);

  const offers = offersAll.filter((p) => p.product.vendor_company === companyId);
  const demands = demandsAll.filter((p) => p.product.vendor_company === companyId);
  const solutions = offers.filter((p) => p.product.has_complex_solution);

  const tenders = await optionalList(() => loadTenders(companyId), 'тендеры компании');

  const promo: CompanyPromo = { ...EMPTY_PROMO, ...(company.promo ?? {}) };
  const achievements = promo.achievements?.length ?? 0;
  const news = promo.news?.length ?? 0;
  const promos = promo.promos?.length ?? 0;
  const videos = promo.videos?.length ?? 0;

  // Заполненность: восемь равных долей — по одной за каждый заполненный раздел.
  const filled = [
    Boolean(promo.headline),
    Boolean(promo.about ?? company.description),
    offers.length > 0,
    solutions.length > 0,
    tenders.length > 0,
    achievements > 0,
    news > 0 || videos > 0,
    promos > 0,
  ].filter(Boolean).length;

  return {
    company,
    promo,
    offers,
    demands,
    solutions,
    tenders,
    stats: {
      offers: offers.length,
      solutions: solutions.length,
      tenders: tenders.length,
      achievements,
      news,
      promos,
      videos,
      completeness: Math.round((filled / 8) * 100),
    },
  };
}

async function loadTenders(companyId: string): Promise<PassportTender[]> {
  const { deps } = getContainer();
  const [own, bids] = await Promise.all([
    deps.tenders.listForCustomer(companyId),
    deps.tenders.listBidsForVendor(companyId),
  ]);

  const rows: PassportTender[] = own.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    statusLabel: STATUS_LABEL[t.status] ?? t.status,
    budget: t.budget,
    deadline: t.deadline,
    role: 'customer' as const,
    amount: null,
  }));

  for (const bid of bids) {
    if (rows.some((r) => r.id === bid.tender)) continue;
    const t = await deps.tenders.findById(bid.tender);
    if (!t) continue;
    rows.push({
      id: t.id,
      title: t.title,
      status: t.status,
      statusLabel: STATUS_LABEL[t.status] ?? t.status,
      budget: t.budget,
      deadline: t.deadline,
      role: 'bidder',
      amount: bid.amount,
    });
  }

  return rows;
}

/** Опубликовать или скрыть витрину. Право — у владельца компании и её директора. */
export async function setCompanyPublished(viewer: Viewer, published: boolean): Promise<void> {
  const { deps } = getContainer();
  if (!viewer.companyId) throw errForbidden('К учётной записи не привязана компания');
  const company = await deps.companies.findById(viewer.companyId);
  if (!company) throw errNotFound('Компания');
  const isOwner = company.owner === viewer.userId;
  const isDirector = viewer.clearanceLevel === 1;
  if (!isOwner && !isDirector) throw errForbidden('Публикацию витрины включает владелец или директор компании');
  await deps.companies.setPublished(company.id, published);
}

/** Условия программы инфраструктурных решений территорий — часть companies.promo JSONB. */
export async function updateCompanySolutionProgram(viewer: Viewer, input: CompanySolutionProgram): Promise<void> {
  const { deps } = getContainer();
  if (!viewer.companyId) throw errForbidden('К учётной записи не привязана компания');
  const company = await deps.companies.findById(viewer.companyId);
  if (!company) throw errNotFound('Компания');
  if (company.owner !== viewer.userId && viewer.clearanceLevel !== 1) {
    throw errForbidden('Программу компании изменяет владелец или директор');
  }
  const text = (value: unknown, label: string, limit: number): string | null => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw new DomainError(400, `${label}: ожидается текст`);
    const trimmed = value.trim();
    if (trimmed.length > limit) throw new DomainError(400, `${label}: максимум ${limit} символов`);
    return trimmed || null;
  };
  const list = (value: unknown, label: string): string[] => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 20 || value.some((x) => typeof x !== 'string')) {
      throw new DomainError(400, `${label}: укажите не более 20 строк`);
    }
    return value.map((x) => x.trim()).filter(Boolean).map((x) => {
      if (x.length > 300) throw new DomainError(400, `${label}: запись не должна превышать 300 символов`);
      return x;
    });
  };
  const solutionProgram: CompanySolutionProgram = {
    description: text(input?.description, 'Описание программы', 5000),
    conditions: text(input?.conditions, 'Условия вендора', 5000),
    discount: text(input?.discount, 'Условия снижения стоимости', 2000),
    banks: list(input?.banks, 'Банковские программы'),
    examples: list(input?.examples, 'Примеры проектов'),
  };
  await deps.companies.updatePromo(company.id, {
    ...(company.promo ?? {}),
    solutionProgram,
  });
}
