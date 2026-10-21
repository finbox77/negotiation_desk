// application/companies — компании контура (страница «Компании», профили, своя компания).
// company_type TEXT[] — зеркало контуров: одна компания может быть client + service.

import { getContainer } from '@/infrastructure/container';
import type { Company, GovProgram, ProductWithRank, User } from '@/domain';

export type CompanyCard = Company & {
  offers: number; // карточек-офферов (products, listing_intent = offer)
  demands: number; // карточек-потребностей (demand — обратный скелет §3.1)
};

export async function listCompanyCards(): Promise<CompanyCard[]> {
  const { deps } = getContainer();
  const [companies, offers, demands] = await Promise.all([
    deps.companies.list(),
    deps.products.findPublished({ intent: 'offer' }),
    deps.products.findPublished({ intent: 'demand' }),
  ]);

  return companies.map((c) => ({
    ...c,
    offers: offers.filter((p) => p.product.vendor_company === c.id).length,
    demands: demands.filter((p) => p.product.vendor_company === c.id).length,
  }));
}

export type CompanyProfile = {
  company: Company;
  /** Опубликованные карточки-офферы компании. */
  offers: ProductWithRank[];
  /** Публичные потребности компании (обратный скелет §3.1). */
  demands: ProductWithRank[];
  /** Активные программы/промо (лизинг, субсидии) — демо-привязка к профилю. */
  programs: GovProgram[];
  /** Сотрудники (видны на своей странице «Моя компания»). */
  staff?: Array<User & { clearanceLevel: number; typeName: string | null }>;
};

/** Публичный профиль компании: карточки + промо (например лизинговые программы). */
export async function getCompanyProfile(id: string): Promise<CompanyProfile | null> {
  const { deps } = getContainer();
  const company = await deps.companies.findById(id);
  if (!company) return null;

  const [offers, demands, programs] = await Promise.all([
    deps.products.findPublished({ intent: 'offer' }),
    deps.products.findPublished({ intent: 'demand' }),
    deps.dictionaries.listActiveGovPrograms(),
  ]);

  return {
    company,
    offers: offers.filter((p) => p.product.vendor_company === id),
    demands: demands.filter((p) => p.product.vendor_company === id),
    programs,
  };
}

/** Профиль «Моя компания»: то же + сотрудники (внутренний контур). */
export async function getMyCompanyProfile(viewerCompanyId: string): Promise<CompanyProfile | null> {
  const { deps } = getContainer();
  const profile = await getCompanyProfile(viewerCompanyId);
  if (!profile) return null;

  const staff = await deps.users.listCompanyStaff(viewerCompanyId);

  return {
    ...profile,
    staff: staff.map((u) => ({
      ...u,
      clearanceLevel: u.clearance_level,
      typeName: u.type ?? null,
    })),
  };
}

export const COMPANY_TYPE_LABEL: Record<string, string> = {
  client: 'клиент',
  vendor: 'вендор',
  dealer: 'дилер',
  service: 'сервис',
  financial: 'финансы',
  logistics: 'логистика',
};

/** Услуги и направления компании — производные от company_type (текст этапа скелета). */
export const COMPANY_TYPE_SERVICES: Record<string, { title: string; text: string }> = {
  vendor: {
    title: 'Поставка и интеграция роботов',
    text: 'Карточки роботизированных систем, предпродажная подготовка, шеф-монтаж и ввод в эксплуатацию.',
  },
  dealer: {
    title: 'Каналы продаж и трейд-ин',
    text: 'Продажа через дилерскую сеть, выкуп и обмен парка, склад и логистика резервов.',
  },
  service: {
    title: 'Сервис и поддержка',
    text: 'PDI, гарантийное и постгарантийное обслуживание, регламентные работы, телеметрия и запчасти.',
  },
  client: {
    title: 'Заказчик роботизации',
    text: 'Публикует потребности, ведёт парк активов и расчёты площадей, участвует в переговорах.',
  },
  financial: {
    title: 'Финансирование сделок',
    text: 'Лизинг, рассрочка, факторинг и кредитные продукты для сделок платформы.',
  },
  logistics: {
    title: 'Доставка и монтаж',
    text: 'Перевозка, складирование и монтаж оборудования на площадке заказчика.',
  },
};
