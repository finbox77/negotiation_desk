// application/arena — «Арена торгов»: витрина всех конкурсов платформы + аналитика.
// Это отдельная страница (/arena), а не раздел кабинета: в кабинете «Тендеры»
// отвечают на «что с моими конкурсами», арена — на «что происходит на рынке».
// Источник — tenders и tender_bids (014), те же строки, что и в кабинете.

import { getContainer } from '@/infrastructure/container';
import { listTenders } from '@/application/tenders';
import type { Viewer } from '@/domain';

export type ArenaRow = {
  id: string;
  title: string;
  summary: string | null;
  customer: string | null;
  kind: string;
  kindLabel: string;
  status: string;
  statusLabel: string;
  budget: number | null;
  deadline: Date | null;
  /** Сколько времени осталось до дедлайна. */
  leftLabel: string;
  /** Дедлайн уже прошёл. */
  expired: boolean;
  bids: number;
  /** Наша ставка, если подана. */
  myAmount: number | null;
  myStatus: string | null;
  /** Лучшая (минимальная) ставка конкурса. */
  bestAmount: number | null;
  /** Наша позиция среди ставок. */
  position: number | null;
  mine: boolean;
};

export type ArenaData = {
  rows: ArenaRow[];
  /** Аналитика по всей выборке, независимо от среза. */
  stats: {
    total: number;
    live: number;
    budget: number;
    avgBudget: number;
    bids: number;
    avgBids: number;
    myBids: number;
    won: number;
    /** Разбивка по типу конкурса. */
    kinds: Array<{ id: string; label: string; count: number }>;
  };
};

export type ArenaScope = 'all' | 'live' | 'mine' | 'done';

const STATUS_LABEL: Record<string, string> = {
  draft: 'черновик',
  open: 'приём заявок',
  scoring: 'оценка',
  awarded: 'победитель определён',
  closed: 'закрыт',
  cancelled: 'отменён',
};

const KIND_LABEL: Record<string, string> = {
  contest: 'конкурс',
  request: 'запрос',
  quote: 'котировка',
};

const BID_LABEL: Record<string, string> = {
  draft: 'черновик',
  submitted: 'подана',
  shortlisted: 'в шорт-листе',
  won: 'победа',
  lost: 'проиграна',
};

function leftLabel(deadline: Date | null): { label: string; expired: boolean } {
  if (!deadline) return { label: 'без срока', expired: false };
  const days = Math.round((deadline.getTime() - Date.now()) / (24 * 3600 * 1000));
  if (days > 1) return { label: `${days} дн. до конца`, expired: false };
  if (days === 1) return { label: 'остался день', expired: false };
  if (days === 0) return { label: 'заканчивается сегодня', expired: false };
  return { label: `завершён ${Math.abs(days)} дн. назад`, expired: true };
}

export async function getArena(viewer: Viewer, scope: ArenaScope = 'all'): Promise<ArenaData> {
  const { deps } = getContainer();
  const tenders = await listTenders(viewer, 'all');
  const companies = new Map((await deps.companies.list().catch(() => [])).map((c) => [c.id, c.company_name]));

  const rows: ArenaRow[] = [];
  for (const t of tenders) {
    const bids = await deps.tenders.listBids(t.id).catch(() => []);
    const amounts = bids.map((b) => b.amount).filter((x): x is number => typeof x === 'number');
    const sorted = [...amounts].sort((a, b) => a - b);
    const position = t.myBid?.amount != null ? sorted.indexOf(t.myBid.amount) + 1 : 0;
    const left = leftLabel(t.deadline);

    rows.push({
      id: t.id,
      title: t.title,
      summary: t.summary,
      customer: companies.get(t.customer_company) ?? null,
      kind: t.kind,
      kindLabel: KIND_LABEL[t.kind] ?? t.kind,
      status: t.status,
      statusLabel: STATUS_LABEL[t.status] ?? t.status,
      budget: t.budget,
      deadline: t.deadline,
      leftLabel: left.label,
      expired: left.expired,
      bids: bids.length,
      myAmount: t.myBid?.amount ?? null,
      myStatus: t.myBid ? BID_LABEL[t.myBid.status] ?? t.myBid.status : null,
      bestAmount: sorted.length > 0 ? sorted[0] : null,
      position: position > 0 ? position : null,
      mine: t.isMine,
    });
  }

  const live = rows.filter((r) => r.status === 'open' || r.status === 'scoring');
  const budget = rows.reduce((sum, r) => sum + (r.budget ?? 0), 0);
  const bids = rows.reduce((sum, r) => sum + r.bids, 0);
  const kinds = Object.entries(
    rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.kind] = (acc[r.kind] ?? 0) + 1;
      return acc;
    }, {}),
  ).map(([id, count]) => ({ id, label: KIND_LABEL[id] ?? id, count }));

  const filtered =
    scope === 'live'
      ? live
      : scope === 'mine'
        ? rows.filter((r) => r.myAmount !== null || r.mine)
        : scope === 'done'
          ? rows.filter((r) => r.status === 'awarded' || r.status === 'closed' || r.status === 'cancelled')
          : rows;

  return {
    rows: filtered,
    stats: {
      total: rows.length,
      live: live.length,
      budget,
      avgBudget: rows.length > 0 ? Math.round(budget / rows.length) : 0,
      bids,
      avgBids: rows.length > 0 ? Math.round((bids / rows.length) * 10) / 10 : 0,
      myBids: rows.filter((r) => r.myAmount !== null).length,
      won: rows.filter((r) => r.myStatus === 'победа').length,
      kinds: kinds.sort((a, b) => b.count - a.count),
    },
  };
}
