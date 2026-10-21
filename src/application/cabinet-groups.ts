// application/cabinet-groups — «папки сущностей» кабинета: боковые группировки модулей.
//
// Кабинет строится по логике конструктора: слева рельс модулей, рядом — папки
// сущностей выбранного модуля (группы по статусу/роли), в центре сетка блоков,
// справа — инспектор выбранного объекта. Группа — это НЕ запись в БД: это срез
// одной коллекции (сделки по статусу, компании по роли, заявки по SLA), поэтому
// она описана в коде и переиспользуется блоком через ?f=<group>.
//
// Хранилище и «Личное» живут иначе: у них папки настоящие (workspace_folders),
// их отдаёт getCabinetView — здесь групп для них нет.

import { getContainer } from '@/infrastructure/container';
import { isInternal } from '@/application/cabinet-roles';
import { listTenders } from '@/application/tenders';
import { listTickets } from '@/application/support';
import type { Viewer } from '@/domain';

export type CabinetGroup = {
  /** Стабильный id: попадает в URL (?f=) и в фильтр блока. */
  id: string;
  label: string;
  hint?: string;
  /** Сколько объектов в срезе (считается только для открытого модуля). */
  count?: number | null;
};

const g = (id: string, label: string, hint?: string): CabinetGroup => ({ id, label, hint, count: null });

/** Группы сущностей модуля (без «Хранилища» и «Личного» — там папки из БД). */
export const CABINET_GROUPS: Record<string, CabinetGroup[]> = {
  companies: [
    g('all', 'Все юрлица', 'единая база клиентов и партнёров'),
    g('client', 'Клиенты'),
    g('vendor', 'Поставщики'),
    g('service', 'Сервисные партнёры'),
    g('finance', 'Финансовые партнёры'),
  ],
  tenders: [
    g('all', 'Все тендеры'),
    g('open', 'Приём заявок', 'open'),
    g('scoring', 'Скоринг', 'идёт оценка заявок'),
    g('mine', 'Мои', 'тендеры моей компании и мои заявки'),
    g('done', 'Завершённые', 'awarded / closed'),
  ],
  deals: [
    g('all', 'Все договоры'),
    g('active', 'В работе', 'действующие контракты и графики'),
    g('pending', 'Ожидают решения', 'draft / negotiation / pending'),
    g('closed', 'Завершённые', 'completed / cancelled'),
  ],
  support: [
    g('all', 'Все заявки'),
    g('new', 'Новые'),
    g('in_progress', 'В работе'),
    g('overdue', 'Просрочен SLA'),
    g('critical', 'Критичные'),
  ],
  telemetry: [
    g('all', 'Весь парк'),
    g('active', 'В работе'),
    g('maintenance', 'Обслуживание'),
    g('alarm', 'С событиями', 'в логах есть ошибки и аварии'),
  ],
  catalog: [
    g('all', 'Все карточки', 'рынок и мои'),
    g('mine', 'Мои карточки'),
    g('draft', 'Черновик', 'неопубликованные карточки моей компании'),
    g('kr', 'Участники программ', 'роботы в составе инфраструктурных решений вендоров'),
    g('demand', 'Потребности', 'база для тендеров'),
  ],
  'ai-disputes': [
    g('all', 'Все споры'),
    g('open', 'Открытые'),
    g('waiting', 'Ждут платформу', 'нужен арбитр'),
    g('resolved', 'Решённые'),
  ],
  staff: [
    g('all', 'Вся команда'),
    g('c1', 'Допуск 1', 'видят всё'),
    g('c2', 'Допуск 2', 'расширенный'),
    g('c3', 'Допуск 3', 'базовый'),
  ],
};

/** Группы модуля: пусто — значит боковая колонка не нужна (Хранилище, Дашборд…). */
export function cabinetGroups(moduleKey: string): CabinetGroup[] {
  const rows = CABINET_GROUPS[moduleKey] ?? [];
  return rows.map((x) => ({ ...x }));
}

export function isCabinetGroup(moduleKey: string, id: string | null): boolean {
  if (!id) return false;
  return (CABINET_GROUPS[moduleKey] ?? []).some((x) => x.id === id);
}

/**
 * Счётчики срезов открытого модуля. Считаются один раз на страницу кабинета
 * (одна лишняя выборка на модуль — плата за живые бейджи в папках сущностей).
 * Если миграция 014 ещё не применена, репозитории вернут пусто — бейджи просто
 * не появятся, кабинет продолжит работать.
 */
export async function cabinetGroupCounts(viewer: Viewer, moduleKey: string): Promise<Record<string, number>> {
  const { deps } = getContainer();
  const out: Record<string, number> = {};
  try {
    if (moduleKey === 'companies') {
      const companies = await deps.companies.list();
      for (const c of companies) for (const t of c.company_type) out[t] = (out[t] ?? 0) + 1;
      out.all = companies.length;
    } else if (moduleKey === 'tenders') {
      const rows = await listTenders(viewer, 'all');
      out.all = rows.length;
      out.open = rows.filter((r) => r.status === 'open').length;
      out.scoring = rows.filter((r) => r.status === 'scoring').length;
      out.mine = rows.filter((r) => r.isMine).length;
      out.done = rows.filter((r) => r.status === 'awarded' || r.status === 'closed').length;
    } else if (moduleKey === 'deals') {
      const deals = isInternal(viewer)
        ? await deps.deals.listAll(200)
        : viewer.companyId
          ? await deps.deals.listForCompany(viewer.companyId, 'buyer')
          : [];
      out.all = deals.length;
      out.active = deals.filter((d) => d.status === 'active').length;
      out.pending = deals.filter((d) => d.status === 'draft' || d.status === 'negotiation' || d.status === 'pending').length;
      out.closed = deals.filter((d) => d.status === 'completed').length;
    } else if (moduleKey === 'support') {
      const rows = await listTickets(viewer, 'all');
      out.all = rows.length;
      out.new = rows.filter((r) => r.status === 'new').length;
      out.in_progress = rows.filter((r) => r.status === 'in_progress').length;
      out.overdue = rows.filter((r) => r.slaOverdue).length;
      out.critical = rows.filter((r) => r.priority === 'critical').length;
    } else if (moduleKey === 'telemetry') {
      const assets = viewer.companyId ? await deps.assets.listForCompany(viewer.companyId) : [];
      out.all = assets.length;
      out.active = assets.filter((a) => a.status === 'active').length;
      out.maintenance = assets.filter((a) => a.status === 'maintenance').length;
      out.alarm = viewer.companyId ? await deps.telemetry.countCritical(viewer.companyId) : 0;
    } else if (moduleKey === 'catalog') {
      const [offers, demands] = await Promise.all([
        deps.products.findPublished({ intent: 'offer' }),
        deps.products.findPublished({ intent: 'demand' }),
      ]);
      const mine = viewer.companyId ? await deps.products.listForCompany(viewer.companyId, 200) : [];
      out.all = new Set([...offers.map((o) => o.product.id), ...demands.map((d) => d.product.id), ...mine.map((m) => m.id)]).size;
      out.mine = mine.length;
      // Черновики — мои НЕопубликованные карточки (016): только что созданная карточка
      // видна здесь с красной плашкой «Черновик», на витрину рынка она не выходит.
      out.draft = mine.filter((m) => !m.published).length;
      out.kr = offers.filter((o) => o.product.has_complex_solution).length;
      out.demand = demands.length;
    }
  } catch {
    return {};
  }
  return out;
}
