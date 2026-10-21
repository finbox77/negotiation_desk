// application/cabinet — данные кабинета (три зоны): папки → роботы → характеристики.
// Папка собирает роботов по полиморфным ссылкам схемы (010): products, environments
// (клетки карты + расчёты), deals, assets. Правила видимости — §4 (допуск × grant).

import { getContainer } from '@/infrastructure/container';
import { listVisibleFolders } from '@/application/folders';
import { listNegotiationsFor } from '@/application/negotiations';
import { canSeeFinancialLayer, canSeeTechnicalLayer } from '@/shared/permissions';
import type { ListingIntent, ProductCondition, ProductRank, Viewer } from '@/domain';

export type CabinetFolder = {
  id: string;
  name: string;
  folderType: string;
  visible: boolean;
  grantedToMe: boolean;
  minClearance: number;
  shared: boolean;
  ownerUserId: string;
  /** Цвет значка (012): gray…black, null = серый по умолчанию. */
  color: string | null;
  /** Порядок в панели (013): перетаскивание мышью. */
  position: number;
  productIds: string[];
};

/** Файл папки кабинета (012) — для списка файлов и просмотрщика фото. */
export type CabinetFile = {
  id: string;
  folderId: string;
  name: string;
  mime: string;
  size: number;
  isImage: boolean;
  createdLabel: string;
};

export type CabinetRobot = {
  id: string;
  title: string;
  price: number;
  intent: ListingIntent;
  condition: ProductCondition;
  published: boolean;
  categoryId: string | null;
  categoryName: string | null;
  hasComplexSolution: boolean;
  solutionSummary: string | null;
  description: string | null;
  specifications: Record<string, number | null> | null;
  rank: Pick<ProductRank, 'price_performance' | 'latency_score' | 'throughput_score' | 'adaptability_score' | 'operating_conditions_score' | 'deployment_speed_score'> | null;
  pdi: number | null;
  maintenanceYear: number | null;
  /** Прицепленные документы (products.docs): ссылки вида /api/v1/files/<id>#<имя>. */
  docs: string[];
  /** TCO 5 лет = price + pdi + 5×maintenance (та же формула, что на витрине КР). */
  tco5y: number | null;
  opexMonth: number | null;
  lifespanYears: number | null;
};

export type CabinetNegotiation = {
  id: string;
  title: string;
  status: string;
  participantCount: number;
  updatedLabel: string;
};

export type CabinetData = {
  companyName: string | null;
  folders: CabinetFolder[];
  files: CabinetFile[];
  robots: CabinetRobot[];
  negotiations: CabinetNegotiation[];
  canFin: boolean;
  canTech: boolean;
  /** Кнопка «Создать карточку» (013): products_offer/demand_manage. */
  canCreateCard: boolean;
};

/** Числовой spec → число или null (JSONB могло прийти строкой и т.п.). */
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function getCabinetData(viewer: Viewer, formatDateTime: (d: Date) => string): Promise<CabinetData> {
  const { deps } = getContainer();

  const [folderRows, negotiations, categories, company] = await Promise.all([
    listVisibleFolders(viewer),
    listNegotiationsFor(viewer),
    deps.dictionaries.listCategories(),
    viewer.companyId ? deps.companies.findById(viewer.companyId) : Promise.resolve(null),
  ]);

  // Собираем product_ids каждой папки по её полиморфным ссылкам + файлы папок (012).
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const folders: CabinetFolder[] = [];
  const files: CabinetFile[] = [];
  const robotIds = new Set<string>();

  for (const f of folderRows) {
    const ids = new Set<string>();
    if (f.products) ids.add(f.products);

    if (f.environments) {
      const env = await deps.environments.findById(f.environments);
      if (env?.map_zones_data) {
        for (const cell of env.map_zones_data.cells) {
          if (cell.product_id) ids.add(cell.product_id);
        }
      }
      if (env) {
        const calcs = await deps.environments.listCalculations(env.id);
        for (const calc of calcs) ids.add(calc.product_id);
      }
    }

    if (f.deals) {
      const deal = await deps.deals.findById(f.deals);
      if (deal?.product) ids.add(deal.product);
    }

    if (f.assets) {
      const asset = await deps.assets.findById(f.assets);
      if (asset?.product) ids.add(asset.product);
    }

    for (const id of ids) robotIds.add(id);
    folders.push({
      id: f.id,
      name: f.name,
      folderType: f.folder_type,
      visible: f.visible,
      grantedToMe: f.grantedToMe,
      minClearance: f.min_clearance_required,
      shared: f.is_shared,
      ownerUserId: f.owner_user,
      color: f.color,
      position: f.position,
      productIds: [...ids],
    });

    const folderFiles = await deps.workspace.listFiles(f.id);
    for (const file of folderFiles) {
      files.push({
        id: file.id,
        folderId: f.id,
        name: file.name,
        mime: file.mime,
        size: file.size,
        isImage: file.mime.startsWith('image/'),
        createdLabel: formatDateTime(file.created),
      });
    }
  }

  const robotRows = await Promise.all(
    [...robotIds].map(async (id): Promise<CabinetRobot | null> => {
      const p = await deps.products.findById(id);
      if (!p) return null;
      const rank = await deps.products.findRank(id);
      const tco5y =
        p.listing_intent === 'offer' && p.price !== null
          ? p.price + (p.pdi_cost_base ?? 0) + 5 * (p.maintenance_cost_year_base ?? 0)
          : null;
      return {
        id: p.id,
        title: p.title,
        price: p.price,
        intent: p.listing_intent,
        condition: p.condition,
        published: p.published,
        categoryId: p.category,
        categoryName: categoryNames.get(p.category) ?? null,
        hasComplexSolution: p.has_complex_solution,
        solutionSummary: p.solution_summary,
        description: p.description,
        specifications: p.specifications,
        rank: rank
          ? {
              price_performance: rank.price_performance,
              latency_score: rank.latency_score,
              throughput_score: rank.throughput_score,
              adaptability_score: rank.adaptability_score,
              operating_conditions_score: rank.operating_conditions_score,
              deployment_speed_score: rank.deployment_speed_score,
            }
          : null,
        pdi: p.pdi_cost_base,
        maintenanceYear: p.maintenance_cost_year_base,
        docs: [...(p.docs ?? [])],
        tco5y,
        opexMonth: num(p.maintenance_cost_year_base) !== null ? Math.round((p.maintenance_cost_year_base ?? 0) / 12) : null,
        lifespanYears: p.lifespan_years,
      } satisfies CabinetRobot;
    }),
  );

  return {
    companyName: company?.company_name ?? null,
    folders,
    files,
    robots: robotRows.filter((r): r is CabinetRobot => r !== null),
    negotiations: negotiations.map((n) => ({
      id: n.id,
      title: n.title,
      status: n.status,
      participantCount: n.participantCount,
      updatedLabel: formatDateTime(n.updated),
    })),
    canFin: canSeeFinancialLayer(viewer) || viewer.permissionNames.includes('fin_deals_view'),
    canTech: canSeeTechnicalLayer(viewer),
    canCreateCard:
      viewer.permissionNames.includes('products_offer_manage') ||
      viewer.permissionNames.includes('products_demand_manage'),
  };
}
