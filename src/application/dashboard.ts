// application/dashboard — один кабинет для всех (§1/§12): маршрут /dashboard,
// состав — dashboard_layouts.blocks; без строки → дефолтный пресет по company_type.

import { getContainer } from '@/infrastructure/container';
import { DomainError } from '@/shared/errors';
import type { BlockPlacement, Viewer } from '@/domain';

/**
 * Универсальный ключ страницы на этапе скелета: в схеме (009) page CHECK ещё
 * знает два контура (client_main/vendor_main) — «один кабинет» сводится этапом
 * кабинета, в схему не лезем. Все пользователи читают client_main.
 */
export const UNIFIED_PAGE = 'client_main' as const;

export type DashboardComposition = {
  page: typeof UNIFIED_PAGE;
  blocks: BlockPlacement[];
  isDefault: boolean;
};

export async function getDashboardLayout(viewer: Viewer): Promise<DashboardComposition> {
  const { deps } = getContainer();
  const row = await deps.layouts.get(viewer.userId, UNIFIED_PAGE);
  if (row && Array.isArray(row.blocks)) {
    return { page: UNIFIED_PAGE, blocks: row.blocks, isDefault: false };
  }
  return { page: UNIFIED_PAGE, blocks: defaultPreset(viewer), isDefault: true };
}

/** Дефолтный состав по company_type (до первого собственного лейаута). */
export function defaultPreset(viewer: Viewer): BlockPlacement[] {
  const types = viewer.companyType;
  const isVendor = types.includes('vendor') || types.includes('dealer');
  const isClient = types.includes('client') || types.includes('service') || viewer.type === 'individual';

  const blocks: BlockPlacement[] = [];
  if (isVendor) {
    blocks.push(
      { key: 'vendor-product-list', span: 12 },
      { key: 'orders-list', span: 12, props: { side: 'seller' } },
    );
  }
  if (isClient || blocks.length === 0) {
    blocks.push(
      { key: 'folders-list', span: 6 },
      { key: 'orders-list', span: 6, props: { side: 'buyer' } },
      { key: 'asset-list', span: 12 },
      { key: 'negotiation-list', span: 12 },
    );
  }
  return blocks;
}

/** PUT /api/v1/dashboard/layout: валидация ключей — по реестру (shared, не импорты блоков). */
export async function saveDashboardLayout(viewer: Viewer, blocks: BlockPlacement[]): Promise<void> {
  const { deps } = getContainer();
  const known = await getKnownBlockKeys();
  for (const b of blocks) {
    if (!known.has(b.key)) throw new DomainError(400, `Неизвестный блок: ${b.key}`);
    if (!Number.isInteger(b.span) || b.span < 1 || b.span > 12) {
      throw new DomainError(400, `Некорректный span у блока ${b.key}: ${String(b.span)}`);
    }
  }
  await deps.layouts.save(viewer.userId, UNIFIED_PAGE, blocks);
}

// --- ключи реестра без импорта компонентов (для валидации на сервере) ---------

let cachedKeys: Set<string> | null = null;

export async function getKnownBlockKeys(): Promise<Set<string>> {
  if (cachedKeys) return cachedKeys;
  const mods = await Promise.all([
    import('@/blocks/tech-equalizer/meta'),
    import('@/blocks/product-grid/meta'),
    import('@/blocks/biz-equalizer/meta'),
    import('@/blocks/solution-grid/meta'),
    import('@/blocks/folders-list/meta'),
    import('@/blocks/orders-list/meta'),
    import('@/blocks/asset-list/meta'),
    import('@/blocks/asset-telemetry/meta'),
    import('@/blocks/team-editor/meta'),
    import('@/blocks/calc-engineering-tab/meta'),
    import('@/blocks/calc-finance-tab/meta'),
    import('@/blocks/calc-analytics-tab/meta'),
    import('@/blocks/negotiation-list/meta'),
    import('@/blocks/chat-block/meta'),
    import('@/blocks/vendor-product-list/meta'),
  ]);
  cachedKeys = new Set(mods.map((m) => m.meta.key));
  return cachedKeys;
}
