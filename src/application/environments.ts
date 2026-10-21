// application/environments — холст объекта (карта + клетки) для GET /api/v1/environments/:id/canvas.

import { getContainer } from '@/infrastructure/container';
import { errForbidden, errNotFound } from '@/shared/errors';
import { canSeeAnalyticalLayer, canSeeFinancialLayer, canSeeTechnicalLayer } from '@/shared/permissions';
import type { Viewer, WorkspaceCalculation } from '@/domain';

export type EnvironmentCanvas = {
  id: string;
  name: string;
  object_type: string;
  company: string;
  total_area: number;
  current_staff_count: number | null;
  cell_size_m: number;
  map_zones_data: { cell_m: number; cells: Array<Record<string, unknown>> } | null;
  /** Какие слои зрителю разрешено видеть (допуск × permissions, §4/§5). */
  layers: {
    technical: boolean;
    financial: boolean;
    analytical: boolean;
  };
  calculations: WorkspaceCalculation[];
};

export async function getEnvironmentCanvas(viewer: Viewer, environmentId: string): Promise<EnvironmentCanvas> {
  const { deps } = getContainer();
  const env = await deps.environments.findById(environmentId);
  if (!env) throw errNotFound('Объект');
  if (viewer.companyId && env.company !== viewer.companyId) {
    throw errForbidden('Объект принадлежит другой компании');
  }
  const calculations = await deps.environments.listCalculations(environmentId);
  return {
    id: env.id,
    name: env.name,
    object_type: env.object_type,
    company: env.company,
    total_area: env.total_area,
    current_staff_count: env.current_staff_count,
    cell_size_m: env.cell_size_m,
    map_zones_data: env.map_zones_data ? { cell_m: env.map_zones_data.cell_m, cells: env.map_zones_data.cells } : null,
    layers: {
      technical: canSeeTechnicalLayer(viewer),
      financial: canSeeFinancialLayer(viewer),
      analytical: canSeeAnalyticalLayer(viewer),
    },
    calculations,
  };
}
