// application/cabinet-roles — контуры кабинета: под кого собирается вид.
//
// Кабинет ОДИН на все роли: различаются не страницы, а состав блоков и глубина
// данных. Контур (bucket) выбирает пресет модуля, признак internal открывает
// «Личное» — внутреннюю зону платформы.
//
// Отдельный модуль без импортов инфраструктуры: его читают и сборка вида
// (cabinet-view), и срезы сущностей (cabinet-groups), и сервисы (tenders/support).

import { hasPermission } from '@/shared/permissions';
import type { Viewer } from '@/domain';

/** Контур пользователя: под него подбираются пресеты модулей. */
export type CabinetRoleBucket = 'client' | 'vendor' | 'service' | 'finance' | 'internal';

/** Контур пользователя: internal > vendor > finance > client > service. */
export function roleBucket(viewer: Viewer): CabinetRoleBucket {
  if (isInternal(viewer)) return 'internal';
  const t = viewer.companyType;
  if (t.includes('vendor') || t.includes('dealer')) return 'vendor';
  if (t.includes('financial')) return 'finance';
  if (t.includes('client')) return 'client';
  if (t.includes('service')) return 'service';
  return 'client';
}

/**
 * Внутренний сотрудник платформы: админ или сотрудник БЕЗ компании-арендатора
 * с правом cabinet_internal. Компания важна: у клиентских ролей (например,
 * директора) право cabinet_internal есть как «всё для своей компании», но
 * внутренняя зона «Личное» им не открывается — они внешние пользователи.
 */
export function isInternal(viewer: Viewer): boolean {
  if (viewer.type === 'admin') return true;
  return hasPermission(viewer, 'cabinet_internal') && viewer.companyId === null;
}
