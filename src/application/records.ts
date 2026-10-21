// Инициализация (019) — автоматическая: карточка попала в правое поле кабинета и
// отметилась просмотренной у этого пользователя. Кнопки «Инициализировать» нет;
// отметка персональная и на счётчики других сотрудников не влияет. Своя папка
// (folder) в счётчик автора не попадает — см. newRecordCounts.
import bcrypt from 'bcryptjs';
import { getContainer } from '@/infrastructure/container';
import { DEMO_RECORDS } from '@/infrastructure/records/demo';
import { isInternal, roleBucket } from './cabinet-roles';
import { listVisibleFolders } from './folders';
import { optionalList } from './module-014';
import { DomainError, errForbidden, errNotFound } from '@/shared/errors';
import type { RecordKind, Viewer } from '@/domain';

export type CabinetRecord = {
  kind: RecordKind;
  id: string;
  title: string;
  creator: string | null;
  draft: boolean;
};
const unique = <T extends { id: string }>(rows: T[]) => [...new Map(rows.map((r) => [r.id, r])).values()];

/** Те же контуры, что у досок. Не считаем скрытые допуском папки/тендеры. */
export async function visibleRecords(v: Viewer, kind: RecordKind): Promise<CabinetRecord[]> {
  return optionalList(() => visibleRecordsInner(v, kind), `карточки:${kind}`);
}

async function visibleRecordsInner(v: Viewer, kind: RecordKind): Promise<CabinetRecord[]> {
  const { deps: d } = getContainer();
  const own = v.companyId;
  switch (kind) {
    case 'product': {
      const [offers, demands, mine] = await Promise.all([
        d.products.findPublished({ intent: 'offer' }),
        d.products.findPublished({ intent: 'demand' }),
        own ? d.products.listForCompany(own, 10000) : Promise.resolve([]),
      ]);
      return unique([...offers.map((r) => r.product), ...demands.map((r) => r.product), ...mine]).map(
        (r) => ({ kind, id: r.id, title: r.title, creator: r.user_id, draft: !r.published }),
      );
    }
    case 'company':
      return (await d.companies.list()).map((r) => ({
        kind,
        id: r.id,
        title: r.company_name,
        creator: r.owner,
        draft: !r.is_published,
      }));
    case 'tender': {
      const rows = unique([
        ...(await d.tenders.listOpen()),
        ...(own ? await d.tenders.listForCustomer(own) : []),
      ]);
      return rows
        .filter((r) => v.clearanceLevel <= r.min_clearance)
        .map((r) => ({
          kind,
          id: r.id,
          title: r.title,
          creator: typeof r.requirements?.author === 'string' ? r.requirements.author : null,
          draft: r.status === 'draft',
        }));
    }
    case 'deal': {
      const bucket = roleBucket(v);
      const side = bucket === 'vendor' || bucket === 'service' ? 'seller' : 'buyer';
      let rows = isInternal(v)
        ? await d.deals.listAll(10000)
        : own
          ? await d.deals.listForCompany(own, side)
          : [];
      if (!rows.length && bucket === 'finance') rows = await d.deals.listAll(10000);
      return rows.map((r) => ({
        kind,
        id: r.id,
        title: `Сделка ${r.id}`,
        creator: r.buyer_user,
        draft: r.status === 'draft',
      }));
    }
    case 'folder':
      return (await listVisibleFolders(v))
        .filter((r) => r.visible && (r.module !== 'personal' || isInternal(v)))
        .map((r) => ({ kind, id: r.id, title: r.name, creator: r.owner_user, draft: false }));
    case 'file': {
      const folders = await visibleRecords(v, 'folder');
      const rows = (await Promise.all(folders.map((f) => d.workspace.listFiles(f.id)))).flat();
      return rows.map((r) => ({ kind, id: r.id, title: r.name, creator: r.uploaded_by, draft: false }));
    }
    case 'ticket': {
      const rows = isInternal(v)
        ? await d.support.listAll()
        : unique([
            ...(own ? await d.support.listForCompany(own) : []),
            ...(await d.support.listAssigned(v.userId)),
          ]);
      return rows
        .filter((r) => v.clearanceLevel <= r.min_clearance)
        .map((r) => ({ kind, id: r.id, title: r.title, creator: r.user_id, draft: false }));
    }
    case 'asset':
      return (own ? await d.assets.listForCompany(own) : []).map((r) => ({
        kind,
        id: r.id,
        title: r.name,
        creator: r.user_id,
        draft: false,
      }));
  }
}
export async function recordDetail(v: Viewer, kind: RecordKind, id: string) {
  const row = (await visibleRecords(v, kind)).find((r) => r.id === id);
  if (!row) throw errNotFound('Карточка');
  const { deps } = getContainer();
  const state = await deps.records.state(kind, id);
  const demo = state?.demo || DEMO_RECORDS[kind].includes(id);
  const policy = v.companyId
    ? (await deps.records.policies(v.companyId)).find((p) => p.level === v.clearanceLevel)
    : undefined;
  return {
    ...row,
    demo,
    initialized: (await deps.records.acknowledged(v.userId, kind)).includes(id),
    canDelete: (row.creator === v.userId || demo) && policy?.enabled !== false,
  };
}
export async function initializeRecord(v: Viewer, kind: RecordKind, id: string) {
  await recordDetail(v, kind, id); // Нельзя пометить чужой недоступный объект по ID.
  await getContainer().deps.records.acknowledge(v.userId, kind, id);
}
export async function newRecordCounts(v: Viewer): Promise<Record<string, number>> {
  const { deps } = getContainer();
  const kinds: RecordKind[] = ['product', 'company', 'tender', 'deal', 'folder', 'file', 'ticket', 'asset'];
  const counts = await Promise.all(
    kinds.map(async (kind) => {
      const [rows, reads] = await Promise.all([
        visibleRecords(v, kind),
        deps.records.acknowledged(v.userId, kind),
      ]);
      const seen = new Set(reads);
      // «Личное» не входит в бейдж Хранилища.
      if (kind === 'folder' || kind === 'file') {
        const folders = new Set(
          (await listVisibleFolders(v)).filter((f) => f.visible && f.module === 'storage').map((f) => f.id),
        );
        // Новые папки: считаем только чужие (свою папку автор не «открывает» заново)
        // и не отмеченные просмотренными у этого сотрудника.
        if (kind === 'folder')
          return rows.filter((r) => folders.has(r.id) && r.creator !== v.userId && !seen.has(r.id)).length;
        const files = new Set(
          (await Promise.all([...folders].map((id) => deps.workspace.listFiles(id)))).flat().map((f) => f.id),
        );
        return rows.filter((r) => files.has(r.id) && !seen.has(r.id)).length;
      }
      return rows.filter((r) => !seen.has(r.id)).length;
    }),
  );
  return {
    catalog: counts[0],
    companies: counts[1],
    tenders: counts[2],
    deals: counts[3],
    // Хранилище (019): счётчик считает ПАПКИ, а не файлы — файл без новой папки
    // ничего не добавляет (см. также подсказку в шапке Хранилища).
    storage: counts[4],
    support: counts[6],
    telemetry: counts[7],
    personal: isInternal(v) ? (await deps.cabinet.listNotes(v.userId)).length : 0,
  };
}

export async function deleteRecord(v: Viewer, kind: RecordKind, id: string, password: unknown) {
  const row = await recordDetail(v, kind, id);
  if (!row.canDelete)
    throw errForbidden('Можно удалять только свои карточки, если это разрешено для вашего уровня доступа');
  const { deps } = getContainer();
  if (!row.draft) {
    if (!(await deps.records.allowPasswordAttempt(v.userId)))
      throw new DomainError(429, 'Слишком много проверок пароля. Повторите через 10 минут');
    const policy = v.companyId
      ? (await deps.records.policies(v.companyId)).find((p) => p.level === v.clearanceLevel)
      : undefined;
    const user = await deps.users.findById(v.userId);
    const hash = policy?.passwordHash ?? user?.password_hash;
    // Не записываем пароль ни в журнал, ни в данные карточки.
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (
      typeof password !== 'string' ||
      password.length > 200 ||
      !hash ||
      !(await bcrypt.compare(password, hash))
    ) {
      throw errForbidden('Неверный пароль удаления');
    }
  }
  // Намеренно ПОСЛЕ пароля: демо воспроизводит полный сценарий подтверждения.
  if (row.demo) throw new DomainError(409, 'Тестовые карточки удалить нельзя');
  if (kind === 'folder') {
    // Не скрываем чужие файлы каскадом и не ломаем ссылки из карточек.
    if ((await deps.workspace.listFiles(id)).length)
      throw new DomainError(409, 'Сначала удалите или перенесите файлы из папки');
  }
  await deps.records.register(kind, id, row.creator, false);
  await deps.records.softDelete(kind, id, v.userId);
}

export function canManageDeletePolicies(v: Viewer) {
  return Boolean(
    v.companyId &&
    v.clearanceLevel === 1 &&
    (v.type === 'company_owner' || v.type === 'admin' || v.permissionNames.includes('staff_manage')),
  );
}
export async function saveDeletePolicy(
  v: Viewer,
  input: { level: unknown; enabled: unknown; password?: unknown; reset?: unknown; currentPassword?: unknown },
) {
  if (!canManageDeletePolicies(v) || !v.companyId)
    throw errForbidden('Настройки удаления доступны руководителю компании с допуском 1');
  if (
    typeof input.level !== 'number' ||
    ![1, 2, 3].includes(input.level) ||
    typeof input.enabled !== 'boolean'
  )
    throw new DomainError(400, 'Некорректный уровень доступа');
  if (!(await getContainer().deps.records.allowPasswordAttempt(v.userId)))
    throw new DomainError(429, 'Слишком много проверок пароля. Повторите через 10 минут');
  const user = await getContainer().deps.users.findById(v.userId);
  if (
    !user ||
    typeof input.currentPassword !== 'string' ||
    input.currentPassword.length > 200 ||
    !(await bcrypt.compare(input.currentPassword, user.password_hash))
  )
    throw errForbidden('Подтвердите настройки своим паролем входа');
  const { deps } = getContainer();
  const level = Number(input.level);
  const existing = (await deps.records.policies(v.companyId)).find((p) => p.level === level);
  let passwordHash = input.reset === true ? null : (existing?.passwordHash ?? null);
  if (input.password !== undefined && input.password !== '') {
    if (
      typeof input.password !== 'string' ||
      input.password.length < 8 ||
      Buffer.byteLength(input.password, 'utf8') > 72
    )
      throw new DomainError(400, 'Пароль: от 8 символов, не более 72 байт');
    passwordHash = await bcrypt.hash(input.password, 12);
  }
  await deps.records.savePolicy(v.companyId, { level, enabled: input.enabled, passwordHash }, v.userId);
}
