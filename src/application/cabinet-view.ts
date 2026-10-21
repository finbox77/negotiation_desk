// application/cabinet-view — сборка вида кабинета: какой модуль открыт, какие блоки
// навешены на его сетку, что видит конкретный пользователь и что показать справа.
//
// Кабинет ОДИН на все роли (/dashboard): видимость режется по контуру компании
// (scope), допуску (clearance), точечному праву (permission) и признаку internal
// («Личное» — только внутренние сотрудники платформы). Состав блоков берётся из
// cabinet_layouts пользователя, а если строки нет — из пресета по роли.
// Ключи блоков валидируются по реестру БД (cabinet_blocks), с fallback на
// код-реестр src/blocks/cabinet-registry.ts, если миграция 014 ещё не применена.

import { newRecordCounts } from './records';
import { getContainer } from '@/infrastructure/container';
import { DomainError, errForbidden } from '@/shared/errors';
import { hasPermission, isCleared } from '@/shared/permissions';
import { listVisibleFolders } from '@/application/folders';
import { cabinetBlockFallback, cabinetModuleFallback } from '@/blocks/cabinet-registry';
import { cabinetGroupCounts, cabinetGroups, type CabinetGroup } from '@/application/cabinet-groups';
import { isInternal, roleBucket, type CabinetRoleBucket } from '@/application/cabinet-roles';
import { requireModule014 } from '@/application/module-014';

// Контуры кабинета живут в отдельном модуле (без импортов инфраструктуры) —
// реэкспорт оставлен для существующих импортов `@/application/cabinet-view`.
export { isInternal, roleBucket };
export type { CabinetRoleBucket };
import {
  CABINET_VIEW_MODES,
  type CabinetBlockDef,
  type CabinetBlockPlacement,
  type CabinetLayout,
  type CabinetModule,
  type CabinetNote,
  type CabinetViewMode,
  type FileKind,
  type FolderModule,
  type Viewer,
} from '@/domain';

export type CabinetSearchParams = Record<string, string | string[] | undefined>;

export type RailFolder = {
  id: string;
  name: string;
  folderType: string;
  color: string | null;
  module: FolderModule;
  fileCount: number;
  visible: boolean;
  grantedToMe: boolean;
  owner: boolean;
};

export type CabinetModuleView = CabinetModule & {
  /** Счётчик «горячих» объектов для рельса (null — не считаем). */
  badge: number | null;
  active: boolean;
  href: string;
};

export type CabinetView = {
  viewer: {
    name: string | null;
    role: string | null;
    companyName: string | null;
    companyTypes: string[];
    clearance: number;
    internal: boolean;
    bucket: CabinetRoleBucket;
  };
  modules: CabinetModuleView[];
  module: CabinetModule;
  /** Блоки центрального окна (уже с валидными ключами и span). */
  centerBlocks: CabinetBlockPlacement[];
  /** Блоки правой панели (характеристики выбранного объекта). */
  rightBlocks: CabinetBlockPlacement[];
  defs: Record<string, CabinetBlockDef>;
  isDefaultLayout: boolean;
  viewMode: CabinetViewMode;
  /** Выбранный объект (?i=) — карточка, сделка, тикет, файл, компания. */
  focusId: string | null;
  /** Папка Хранилища (?f=) или id среза сущностей (см. groups). */
  folderId: string | null;
  /** Папки сущностей модуля: срезы коллекций (сделки по статусу, компании по роли…). */
  groups: CabinetGroup[];
  /** Открытая группа (?f=), если она относится к модулю. */
  activeGroup: string | null;
  /** Фильтр типа файлов Хранилища (?k=). */
  kind: FileKind | null;
  folders: RailFolder[];
  counts: Record<string, number>;
  canCreateCard: boolean;
  canConstruct: boolean;
  canInternal: boolean;
};

// ---------------------------------------------------------------------------
// Роли и видимость
// ---------------------------------------------------------------------------

function scopeMatches(scope: CabinetModule['scope'], bucket: CabinetRoleBucket): boolean {
  if (scope === 'all') return true;
  if (bucket === 'internal') return true; // внутренние видят все контуры
  if (scope === 'client') return bucket === 'client' || bucket === 'service';
  return scope === bucket;
}

export function isModuleVisible(viewer: Viewer, bucket: CabinetRoleBucket, m: CabinetModule): boolean {
  if (m.internal && !isInternal(viewer)) return false;
  if (!scopeMatches(m.scope, bucket)) return false;
  if (!isCleared(viewer, m.clearance)) return false;
  if (m.permission && !hasPermission(viewer, m.permission)) return false;
  return true;
}

export function isBlockVisible(viewer: Viewer, bucket: CabinetRoleBucket, d: CabinetBlockDef): boolean {
  if (d.scope === 'internal' && !isInternal(viewer)) return false;
  if (!scopeMatches(d.scope, bucket)) return false;
  if (!isCleared(viewer, d.clearance)) return false;
  if (d.permission && !hasPermission(viewer, d.permission)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Пресеты модулей по ролям (до первого собственного лейаута)
// ---------------------------------------------------------------------------

type PresetMap = Partial<Record<CabinetRoleBucket | 'default', CabinetBlockPlacement[]>>;

const p = (key: string, span: number, props?: Record<string, unknown>): CabinetBlockPlacement =>
  props ? { key, span, props } : { key, span };

export const CABINET_PRESETS: Record<string, PresetMap> = {
  dashboard: {
    default: [p('kpi-role', 12), p('deals-pipeline', 6), p('tickets-sla', 6), p('negotiation-list', 6), p('telemetry-pulse', 6)],
    vendor: [p('kpi-role', 12), p('tenders-pulse', 6), p('deals-pipeline', 6), p('tickets-sla', 6), p('negotiation-list', 6)],
    service: [p('kpi-role', 12), p('tickets-sla', 8), p('telemetry-pulse', 4), p('asset-list', 12)],
    finance: [p('kpi-role', 12), p('deals-pipeline', 8), p('biz-equalizer', 4), p('orders-list', 12)],
    internal: [p('kpi-role', 12), p('deals-pipeline', 6), p('tickets-sla', 6), p('tenders-pulse', 6), p('telemetry-pulse', 6)],
  },
  storage: {
    default: [p('storage-explorer', 12), p('file-inspector', 12)],
  },
  catalog: {
    default: [p('cabinet-catalog', 12), p('product-inspector', 12), p('solution-grid', 12)],
    vendor: [p('cabinet-catalog', 12), p('product-inspector', 12), p('vendor-product-list', 12)],
    internal: [p('cabinet-catalog', 12), p('product-inspector', 12), p('vendor-product-list', 12), p('solution-grid', 12)],
  },
  companies: {
    default: [p('companies-board', 12), p('company-inspector', 12)],
  },
  tenders: {
    default: [p('tenders-board', 12), p('tender-inspector', 12)],
  },
  deals: {
    default: [p('deals-board', 12), p('deal-inspector', 12), p('orders-list', 12)],
  },
  support: {
    default: [p('tickets-board', 12), p('ticket-inspector', 12), p('asset-telemetry', 12)],
  },
  telemetry: {
    default: [p('telemetry-board', 12), p('device-inspector', 12), p('asset-list', 6), p('asset-telemetry', 6)],
  },
  personal: {
    default: [p('personal-notes', 12), p('team-editor', 12)],
  },
  'ai-disputes': {
    default: [p('ai-disputes', 12)],
  },
  staff: {
    default: [p('staff-board', 12)],
  },
  settings: {
    default: [p('settings-board', 12)],
  },
};

/** Пресет модуля для роли: точное совпадение контура → default → пусто. */
export function modulePreset(moduleKey: string, bucket: CabinetRoleBucket): CabinetBlockPlacement[] {
  const map = CABINET_PRESETS[moduleKey];
  if (!map) return [];
  return map[bucket] ?? map.default ?? [];
}

// ---------------------------------------------------------------------------
// Сборка вида
// ---------------------------------------------------------------------------

const str = (v: string | string[] | undefined): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

/**
 * Строки БД дополняются код-реестром: разделы и блоки, добавленные в коде позже
 * миграции 014 (или позже того, как memory-сид уже собрался), всё равно попадают
 * в рельс. Строка из БД всегда главнее одноимённой записи реестра.
 */
function mergeWithRegistry<T extends { key: string }>(rows: T[], fallback: T[]): T[] {
  if (rows.length === 0) return fallback;
  const known = new Set(rows.map((r) => r.key));
  return [...rows, ...fallback.filter((f) => !known.has(f.key))];
}

async function loadModules(): Promise<CabinetModule[]> {
  const { deps } = getContainer();
  const rows = await deps.cabinet.listModules().catch(() => []);
  const modules = mergeWithRegistry(rows, cabinetModuleFallback()).map(m => m.key === 'staff' ? {...m, sort_order: 15} : m);
  return [...modules].sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
}

async function loadBlockDefs(): Promise<CabinetBlockDef[]> {
  const { deps } = getContainer();
  const rows = await deps.cabinet.listBlockDefs().catch(() => []);
  return mergeWithRegistry(rows, cabinetBlockFallback());
}

/** Валидация навешенных блоков: ключ — из модуля и виден, span — 1..12. */
function sanitize(
  placements: CabinetBlockPlacement[],
  defs: CabinetBlockDef[],
  viewer: Viewer,
  bucket: CabinetRoleBucket,
): CabinetBlockPlacement[] {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const out: CabinetBlockPlacement[] = [];
  for (const raw of placements) {
    const def = byKey.get(raw.key);
    if (!def || !isBlockVisible(viewer, bucket, def)) continue;
    const span = Number.isInteger(raw.span) && raw.span >= 1 && raw.span <= 12 ? raw.span : def.default_span;
    out.push({ key: raw.key, span, ...(raw.props ? { props: raw.props } : {}) });
  }
  // Структурные блоки (configurable = false) вернуть, если их сняли.
  for (const def of defs) {
    if (def.configurable || !isBlockVisible(viewer, bucket, def)) continue;
    if (!out.some((x) => x.key === def.key)) out.push({ key: def.key, span: def.default_span });
  }
  return out;
}

export async function getCabinetView(viewer: Viewer, sp: CabinetSearchParams): Promise<CabinetView> {
  const { deps } = getContainer();
  const bucket = roleBucket(viewer);
  const internal = isInternal(viewer);

  const [allModules, allDefs, foldersRaw, counts, company] = await Promise.all([
    loadModules(),
    loadBlockDefs(),
    listVisibleFolders(viewer),
    newRecordCounts(viewer),
    viewer.companyId ? deps.companies.findById(viewer.companyId) : Promise.resolve(null),
  ]);

  const moduleCountValues = counts;

  const modules = allModules.filter((m) => isModuleVisible(viewer, bucket, m));
  const requested = str(sp.m);
  const active = modules.find((m) => m.key === requested) ?? modules[0];
  if (!active) throw new DomainError(500, 'Нет доступных модулей кабинета');

  const moduleDefs = allDefs
    .filter((d) => d.module === active.key)
    .sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
  const defs = Object.fromEntries(allDefs.map((d) => [d.key, d]));

  const layout = await deps.cabinet.getLayout(viewer.userId, active.key).catch(() => null);
  const rawPlacements = layout?.blocks?.length ? layout.blocks : modulePreset(active.key, bucket);
  const placements = sanitize(rawPlacements, moduleDefs, viewer, bucket);

  const centerBlocks = placements.filter((x) => defs[x.key]?.zone !== 'right');
  const rightBlocks = placements.filter((x) => defs[x.key]?.zone === 'right');

  // Режим по умолчанию — «Таблица»: в рабочем кабинете плотный список важнее плитки.
  const viewParam = str(sp.v);
  const viewMode: CabinetViewMode =
    viewParam && (CABINET_VIEW_MODES as readonly string[]).includes(viewParam)
      ? (viewParam as CabinetViewMode)
      : layout?.view_mode ?? 'table';

  const groups = cabinetGroups(active.key);
  const requestedFolder = str(sp.f);
  const groupIds = new Set(groups.map((x) => x.id));
  const activeGroup = requestedFolder && groupIds.has(requestedFolder) ? requestedFolder : groups[0]?.id ?? null;
  const groupCounts = groups.length > 0 ? await cabinetGroupCounts(viewer, active.key) : {};
  const groupsWithCounts: CabinetGroup[] = groups.map((x) => ({ ...x, count: groupCounts[x.id] ?? 0 }));
  const activeFolderRaw = requestedFolder && !groupIds.has(requestedFolder) ? requestedFolder : null;

  const folderModule: FolderModule = active.internal ? 'personal' : 'storage';
  const folderRows = active.storage || active.internal || active.key === 'personal'
    ? foldersRaw.filter((f) => (f.module ?? 'storage') === folderModule)
    : [];
  const folders: RailFolder[] = await Promise.all(
    folderRows.map(async (f) => {
      const files = await deps.workspace.listFiles(f.id);
      return {
        id: f.id,
        name: f.name,
        folderType: f.folder_type,
        color: f.color,
        module: f.module ?? folderModule,
        fileCount: files.length,
        visible: f.visible,
        grantedToMe: f.grantedToMe,
        owner: f.owner_user === viewer.userId,
      } satisfies RailFolder;
    }),
  );

  return {
    viewer: {
      name: viewer.name,
      role: viewer.role,
      companyName: company?.company_name ?? null,
      companyTypes: [...viewer.companyType],
      clearance: viewer.clearanceLevel,
      internal,
      bucket,
    },
    modules: modules.map((m) => ({
      ...m,
      active: m.key === active.key,
      href: `/dashboard?m=${m.key}`,
      badge: moduleCountValues[m.key] && moduleCountValues[m.key] > 0 ? moduleCountValues[m.key] : null,
    })),
    module: active,
    centerBlocks,
    rightBlocks,
    defs,
    isDefaultLayout: !(layout && layout.blocks.length > 0),
    viewMode,
    focusId: str(sp.i),
    folderId: groups.length > 0 ? activeGroup : activeFolderRaw,
    groups: groupsWithCounts,
    activeGroup,
    kind: (str(sp.k) as FileKind | null) ?? null,
    folders,
    counts: moduleCountValues,
    canCreateCard:
      hasPermission(viewer, 'products_offer_manage') || hasPermission(viewer, 'products_demand_manage'),
    canConstruct: true,
    canInternal: internal,
  };
}

/** Лейаут модуля для пользователя (конструктор кабинета). */
export async function getCabinetLayout(viewer: Viewer, moduleKey: string): Promise<CabinetLayout | null> {
  const { deps } = getContainer();
  const bucket = roleBucket(viewer);
  const modules = await loadModules();
  const module = modules.find((m) => m.key === moduleKey && isModuleVisible(viewer, bucket, m));
  if (!module) throw errForbidden('Модуль недоступен');
  return deps.cabinet.getLayout(viewer.userId, moduleKey).catch(() => null);
}

// ---------------------------------------------------------------------------
// Сохранение лейаута (конструктор кабинета)
// ---------------------------------------------------------------------------

export async function saveCabinetLayout(
  viewer: Viewer,
  moduleKey: string,
  blocks: CabinetBlockPlacement[],
  viewMode: CabinetViewMode,
): Promise<void> {
  const { deps } = getContainer();
  const bucket = roleBucket(viewer);
  const allModules = await loadModules();
  const module = allModules.find((m) => m.key === moduleKey && isModuleVisible(viewer, bucket, m));
  if (!module) throw errForbidden('Модуль недоступен');

  const allDefs = await loadBlockDefs();
  const moduleDefs = allDefs.filter((d) => d.module === moduleKey);
  const known = new Set(moduleDefs.map((d) => d.key));
  for (const b of blocks) {
    if (!known.has(b.key)) throw new DomainError(400, `Блок «${b.key}» не относится к модулю «${moduleKey}»`);
    if (!Number.isInteger(b.span) || b.span < 1 || b.span > 12) {
      throw new DomainError(400, `Некорректный span у блока ${b.key}: ${String(b.span)}`);
    }
  }
  const mode = (CABINET_VIEW_MODES as readonly string[]).includes(viewMode) ? viewMode : 'table';
  // Лейаут ложится в cabinet_layouts (014): пока таблицы нет — понятная 503, а не падение.
  await requireModule014(
    () => deps.cabinet.saveLayout(viewer.userId, moduleKey, sanitize(blocks, moduleDefs, viewer, bucket), mode),
    'Сохранение раскладки',
  );
}

// ---------------------------------------------------------------------------
// Личные заметки (модуль «Личное»): только внутренние сотрудники
// ---------------------------------------------------------------------------

function assertInternal(viewer: Viewer): void {
  if (!isInternal(viewer)) throw errForbidden('Раздел «Личное» доступен только внутренним сотрудникам');
}

export async function listCabinetNotes(viewer: Viewer): Promise<CabinetNote[]> {
  assertInternal(viewer);
  const { deps } = getContainer();
  return deps.cabinet.listNotes(viewer.userId, 'personal');
}

export async function createCabinetNote(viewer: Viewer, text: string, title: string | null): Promise<string> {
  assertInternal(viewer);
  if (!text.trim()) throw new DomainError(400, 'Текст заметки обязателен');
  const { deps } = getContainer();
  return requireModule014(
    () => deps.cabinet.createNote({ module: 'personal', title, text: text.trim() }, viewer.userId),
    'Новая заметка',
  );
}

export async function updateCabinetNote(
  viewer: Viewer,
  id: string,
  patch: { title?: string | null; text?: string; pinned?: boolean },
): Promise<void> {
  assertInternal(viewer);
  const { deps } = getContainer();
  const notes = await deps.cabinet.listNotes(viewer.userId, 'personal');
  if (!notes.some((n) => n.id === id)) throw errForbidden('Заметка другого сотрудника');
  await requireModule014(() => deps.cabinet.updateNote(id, viewer.userId, patch), 'Правка заметки');
}

export async function deleteCabinetNote(viewer: Viewer, id: string): Promise<void> {
  assertInternal(viewer);
  const { deps } = getContainer();
  const notes = await deps.cabinet.listNotes(viewer.userId, 'personal');
  if (!notes.some((n) => n.id === id)) throw errForbidden('Заметка другого сотрудника');
  await requireModule014(() => deps.cabinet.deleteNote(id, viewer.userId), 'Удаление заметки');
}
