// application/tenders — тендеры в кабинете: что видит контур, детали и заявки.
// Видимость: вендор видит открытые тендеры рынка и свои заявки; заказчик — свои
// тендеры и заявки по ним; внутренний сотрудник платформы — всё.
// База тендера — карточка-потребность products.listing_intent = 'demand'.

import { getContainer } from '@/infrastructure/container';
import { DomainError, errForbidden, errNotFound } from '@/shared/errors';
import { isInternal, roleBucket } from '@/application/cabinet-view';
import { optionalList, requireModule014 } from '@/application/module-014';
import type { Tender, TenderBid, TenderKind, Viewer } from '@/domain';

export type TenderRow = Tender & {
  /** Моя заявка по этому тендеру (вендор) — если есть. */
  myBid: TenderBid | null;
  bidCount: number;
  isMine: boolean;
};

export type TenderScope = 'market' | 'mine' | 'all';

export async function listTenders(viewer: Viewer, scope: TenderScope = 'all'): Promise<TenderRow[]> {
  // Таблиц 014 может ещё не быть в PostgreSQL — модуль молча пустой.
  return optionalList(() => listTendersInner(viewer, scope), 'тендеры');
}

async function listTendersInner(viewer: Viewer, scope: TenderScope): Promise<TenderRow[]> {
  const { deps } = getContainer();
  const bucket = roleBucket(viewer);
  const internal = isInternal(viewer);
  const own = viewer.companyId;

  const rows: Tender[] = [];
  if (own && (scope === 'mine' || scope === 'all')) rows.push(...(await deps.tenders.listForCustomer(own)));
  if (scope === 'market' || scope === 'all') {
    const open = await deps.tenders.listOpen();
    for (const t of open) if (!rows.some((r) => r.id === t.id)) rows.push(t);
  }
  if ((internal || bucket === 'vendor') && scope === 'mine' && own) {
    // заявки вендора: показываем тендеры, куда он подался, даже если они закрыты
    const bids = await deps.tenders.listBidsForVendor(own);
    for (const bid of bids) {
      const t = rows.find((r) => r.id === bid.tender) ?? (await deps.tenders.findById(bid.tender));
      if (t && !rows.some((r) => r.id === t.id)) rows.push(t);
    }
  }

  const myBids = own ? await deps.tenders.listBidsForVendor(own) : [];
  const out: TenderRow[] = [];
  for (const t of rows) {
    const bids = await deps.tenders.listBids(t.id);
    out.push({
      ...t,
      myBid: myBids.find((b) => b.tender === t.id) ?? null,
      bidCount: bids.length,
      isMine: own !== null && t.customer_company === own,
    });
  }
  return out.sort((a, b) => b.created.getTime() - a.created.getTime());
}

export type TenderDetail = {
  tender: Tender;
  bids: TenderBid[];
  /** Названия компаний-заявителей: id → имя. */
  vendorNames: Record<string, string>;
  customerName: string | null;
  productTitle: string | null;
  myBid: TenderBid | null;
  canBid: boolean;
};

export async function getTenderDetail(viewer: Viewer, id: string): Promise<TenderDetail | null> {
  return requireModule014(() => getTenderDetailInner(viewer, id), 'Карточка тендера');
}

async function getTenderDetailInner(viewer: Viewer, id: string): Promise<TenderDetail | null> {
  const { deps } = getContainer();
  const tender = await deps.tenders.findById(id);
  if (!tender) return null;
  const [bids, customer, product, own] = await Promise.all([
    deps.tenders.listBids(id),
    deps.companies.findById(tender.customer_company),
    tender.product ? deps.products.findById(tender.product) : Promise.resolve(null),
    viewer.companyId ? deps.tenders.listBidsForVendor(viewer.companyId) : Promise.resolve([]),
  ]);
  const vendorNames: Record<string, string> = {};
  for (const bid of bids) {
    if (!vendorNames[bid.vendor_company]) {
      const c = await deps.companies.findById(bid.vendor_company);
      vendorNames[bid.vendor_company] = c?.company_name ?? bid.vendor_company;
    }
  }
  const bucket = roleBucket(viewer);
  return {
    tender,
    bids,
    vendorNames,
    customerName: customer?.company_name ?? null,
    productTitle: product?.title ?? null,
    myBid: own.find((b) => b.tender === id) ?? null,
    canBid:
      viewer.companyId !== null &&
      (bucket === 'vendor' || bucket === 'internal') &&
      tender.status === 'open' &&
      !own.some((b) => b.tender === id),
  };
}

/** Заявка вендора на тендер (кнопка «Подать заявку» в карточке тендера). */
export async function submitTenderBid(
  viewer: Viewer,
  tenderId: string,
  input: { amount: number | null; terms: string | null },
): Promise<string> {
  return requireModule014(() => submitTenderBidInner(viewer, tenderId, input), 'Заявка вендора');
}

async function submitTenderBidInner(
  viewer: Viewer,
  tenderId: string,
  input: { amount: number | null; terms: string | null },
): Promise<string> {
  if (!viewer.companyId) throw errForbidden('Заявку подаёт компания-вендор');
  const bucket = roleBucket(viewer);
  if (bucket !== 'vendor' && !isInternal(viewer)) throw errForbidden('Заявки подают вендоры');
  const { deps } = getContainer();
  const tender = await deps.tenders.findById(tenderId);
  if (!tender) throw errNotFound('Тендер');
  if (tender.status !== 'open') throw new DomainError(409, 'Тендер уже не принимает заявки');
  const existing = await deps.tenders.listBidsForVendor(viewer.companyId);
  if (existing.some((b) => b.tender === tenderId)) throw new DomainError(409, 'Заявка уже подана');
  return deps.tenders.createBid(
    { tender: tenderId, vendor_company: viewer.companyId, amount: input.amount, terms: input.terms },
    viewer,
  );
}

// ---------------------------------------------------------------------------
// Создание заявки заказчиком (страница /tenders/new)
// ---------------------------------------------------------------------------

export type NewTenderInput = {
  title: string;
  kind: TenderKind;
  /** true — сразу на площадку (open), false — сохранить черновиком. */
  publish: boolean;
  budget: number | null;
  deadline: Date | null;
  summary: string | null;
  product: string | null;
  minClearance: number;
};

/** Новая заявка на торги: конкурс, запрос или котировка от имени своей компании. */
export async function createTender(viewer: Viewer, input: NewTenderInput): Promise<string> {
  return requireModule014(() => createTenderInner(viewer, input), 'Новая заявка на торги');
}

async function createTenderInner(viewer: Viewer, input: NewTenderInput): Promise<string> {
  if (!viewer.companyId) throw errForbidden('Заявку на торги подаёт компания');
  const title = input.title.trim();
  if (title.length < 4) throw new DomainError(422, 'Название заявки — минимум 4 символа');
  const { deps } = getContainer();
  return deps.tenders.create(
    {
      title,
      customer_company: viewer.companyId,
      product: input.product,
      kind: input.kind,
      status: input.publish ? 'open' : 'draft',
      budget: input.budget,
      deadline: input.deadline,
      summary: input.summary,
      min_clearance: input.minClearance,
    },
    viewer,
  );
}
