// application/lists — короткие use-cases для блоков-заглушек кабинета.

import { getContainer } from '@/infrastructure/container';
import type {
  Asset,
  FinancialDeal,
  Order,
  Task,
  TelemetryLog,
  User,
  Viewer,
  WorkspaceCalculation,
} from '@/domain';

export async function listOrders(viewer: Viewer, side: 'buyer' | 'seller'): Promise<Order[]> {
  if (!viewer.companyId) return [];
  const { deps } = getContainer();
  return deps.orders.listForCompany(viewer.companyId, side);
}

export async function listDeals(viewer: Viewer, side: 'buyer' | 'seller'): Promise<FinancialDeal[]> {
  if (!viewer.companyId) return [];
  const { deps } = getContainer();
  return deps.deals.listForCompany(viewer.companyId, side);
}

export async function listAssets(viewer: Viewer): Promise<Asset[]> {
  if (!viewer.companyId) return [];
  const { deps } = getContainer();
  return deps.assets.listForCompany(viewer.companyId);
}

export async function listCompanyProducts(viewer: Viewer): Promise<string[]> {
  if (!viewer.companyId) return [];
  const { deps } = getContainer();
  // Карточки компании — через каталог с владельцем (vendor_company = моя);
  // в схеме прямой SELECT нет, поэтому используем findPublished по офферам и
  // отфильтруем на уровне применения (для demand — отдельная query этапа тендера).
  const rows = await deps.products.findPublished({});
  return rows.filter((r) => r.product.vendor_company === viewer.companyId).map((r) => r.product.id);
}

export async function listTelemetry(assetId: string, limit?: number): Promise<TelemetryLog[]> {
  const { deps } = getContainer();
  return deps.telemetry.listByAsset(assetId, limit);
}

export async function listStaff(viewer: Viewer): Promise<Array<User & { roleName: string | null }>> {
  if (!viewer.companyId) return [];
  const { deps } = getContainer();
  const staff = await deps.users.listCompanyStaff(viewer.companyId);
  return Promise.all(
    staff.map(async (u) => ({ ...u, roleName: await deps.roles.roleNameById(u.role) })),
  );
}

export async function listTasks(viewer: Viewer): Promise<Task[]> {
  if (!viewer.companyId) return [];
  const { deps } = getContainer();
  return deps.workspace.listTasks(viewer.companyId);
}

export async function listCalculationsForCompany(viewer: Viewer): Promise<WorkspaceCalculation[]> {
  if (!viewer.companyId) return [];
  const { deps } = getContainer();
  const envs = await deps.environments.listForCompany(viewer.companyId);
  const all = await Promise.all(envs.map((e) => deps.environments.listCalculations(e.id)));
  return all.flat();
}
