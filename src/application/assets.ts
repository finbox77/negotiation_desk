// application/assets — регистрация актива (пример use-case записи) и карточка
// устройства для правой панели «Телеметрии и мониторинга» (014).

import { getContainer } from '@/infrastructure/container';
import { errForbidden } from '@/shared/errors';
import { hasPermission, isCleared } from '@/shared/permissions';
import { isInternal } from '@/application/cabinet-roles';
import { optionalList } from '@/application/module-014';
import type { Asset, NewAsset, Product, SupportTicket, TelemetryLog, Viewer } from '@/domain';

export type RegisterAssetInput = Omit<NewAsset, 'company'> & { company?: string | null };

/**
 * POST /api/v1/assets/register.
 * Правило: актив вешается на компанию актора (company из тела — только та же компания).
 */
export async function registerAsset(actor: Viewer, input: RegisterAssetInput): Promise<string> {
  if (!hasPermission(actor, 'assets_manage') && actor.type !== 'company_owner') {
    throw errForbidden('Нет права assets_manage (или роли владельца компании)');
  }
  const company = input.company ?? actor.companyId;
  if (input.company && actor.companyId && input.company !== actor.companyId) {
    throw errForbidden('Актив можно зарегистрировать только в свою компанию');
  }
  const { deps } = getContainer();
  return deps.assets.register({ ...input, company }, actor);
}

// ---------------------------------------------------------------------------
// Карточка устройства (правая панель модуля «Телеметрия и мониторинг»)
// ---------------------------------------------------------------------------

export type DeviceDetail = {
  asset: Asset;
  product: Product | null;
  companyName: string | null;
  /** Лента событий актива (append-only telemetry_logs), свежие сверху. */
  logs: TelemetryLog[];
  alarms: number;
  /** Дней до конца гарантии; null — гарантия не заведена. Отрицательное — истекла. */
  warrantyLeftDays: number | null;
  /** Заявки сервиса по этому устройству (таблица 014; нет её — список пуст). */
  tickets: SupportTicket[];
  /** Технический слой (идентификатор, ТТХ, логи) закрыт допуском/правом. */
  canSeeTechnical: boolean;
  canSeeSupport: boolean;
};

/**
 * Доступ к устройству: внутренние сотрудники видят весь парк, внешние — только
 * активы своей компании (§4: видимость = владелец + допуск).
 */
export async function getDeviceDetail(viewer: Viewer, assetId: string): Promise<DeviceDetail | null> {
  const { deps } = getContainer();
  const asset = await deps.assets.findById(assetId);
  if (!asset) return null;
  const internal = isInternal(viewer);
  if (!internal && (viewer.companyId === null || asset.company !== viewer.companyId)) {
    throw errForbidden('Устройство другой компании');
  }

  const [product, company, logs] = await Promise.all([
    asset.product ? deps.products.findById(asset.product) : Promise.resolve(null),
    asset.company ? deps.companies.findById(asset.company) : Promise.resolve(null),
    deps.telemetry.listByAsset(asset.id, 12),
  ]);

  const tickets = asset.company
    ? await optionalList(() => deps.support.listForCompany(asset.company as string), 'заявки по устройству')
    : [];

  const end = asset.warranty_end_at ? asset.warranty_end_at.getTime() : null;
  return {
    asset,
    product,
    companyName: company?.company_name ?? null,
    logs,
    alarms: logs.filter((l) => l.log_type !== 'status').length,
    warrantyLeftDays: end === null ? null : Math.ceil((end - Date.now()) / (24 * 3600 * 1000)),
    tickets: tickets.filter((t) => t.asset === asset.id),
    canSeeTechnical:
      internal || hasPermission(viewer, 'maps_technical_view') || isCleared(viewer, 3),
    canSeeSupport: internal || hasPermission(viewer, 'maps_technical_view') || isCleared(viewer, 3),
  };
}
