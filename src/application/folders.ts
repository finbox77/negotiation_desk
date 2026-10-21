// application/folders — папки кабинета: видимость = владелец/grant И допуск (§4).

import { getContainer } from '@/infrastructure/container';
import { isInternal as isInternalCabinet } from '@/application/cabinet-roles';
import { DomainError, errForbidden, errNotFound } from '@/shared/errors';
import { hasPermission, isCleared } from '@/shared/permissions';
import type { FolderColor, FolderGrant, FolderModule, FolderType, Viewer, WorkspaceFolder } from '@/domain';

export type VisibleFolder = WorkspaceFolder & {
  min_clearance_required: number;
  grantedToMe: boolean;
  visible: boolean;
};

export async function listVisibleFolders(viewer: Viewer): Promise<VisibleFolder[]> {
  const { deps } = getContainer();
  const folders = await deps.workspace.listFoldersForUser(viewer.userId, viewer.companyId);
  return folders.map((f) => ({
    ...f,
    grantedToMe: f.owner_user !== viewer.userId,
    visible: isCleared(viewer, f.min_clearance_required),
  }));
}

export async function getFolderDetail(viewer: Viewer, id: string) {
  const { deps } = getContainer();
  const found = await deps.workspace.findFolder(id);
  if (!found) throw errNotFound('Папка');
  const owner = found.folder.owner_user === viewer.userId;
  if (!owner && !hasPermission(viewer, 'folders_share') && viewer.type !== 'company_owner') {
    // чужие папки видит, если есть grant (проверка в data-слое блока/клиенте)
  }
  const grants: Array<FolderGrant & { userName: string | null }> = await Promise.all(
    found.grants.map(async (g) => {
      const u = await deps.users.findById(g.user_id);
      return { ...g, userName: u?.name ?? null };
    }),
  );
  return { ...found, grants, isOwner: owner };
}

export type CreateFolderInput = {
  name: string;
  folder_type: FolderType;
  min_clearance_required?: number;
  /** Цвет значка (012). Не задан — серый по умолчанию. */
  color?: FolderColor | null;
  /** Модуль кабинета (014): storage (по умолчанию) или personal. */
  module?: FolderModule;
};

export async function createFolder(viewer: Viewer, input: CreateFolderInput): Promise<string> {
  if (!input.name.trim()) throw new DomainError(400, 'Название папки обязательно');
  const clearance = input.min_clearance_required ?? 3;
  if (clearance < viewer.clearanceLevel) {
    throw errForbidden('Нельзя создать папку с допуском выше своего');
  }
  // Личный контур (014): папки модуля «Личное» — только внутренним сотрудникам.
  const module: FolderModule = input.module === 'personal' ? 'personal' : 'storage';
  if (module === 'personal' && !isInternalCabinet(viewer)) {
    throw errForbidden('Личные папки доступны только внутренним сотрудникам');
  }
  const { deps } = getContainer();
  return deps.workspace.createFolder({
    name: input.name.trim(),
    folder_type: input.folder_type,
    minClearanceRequired: clearance,
    color: input.color ?? 'gray',
    company: viewer.companyId,
    ownerUserId: viewer.userId,
    module,
  });
}

/** Порядок папок панели (013): ids уже в новом порядке, position = индекс. */
export async function reorderFolders(viewer: Viewer, ids: string[]): Promise<void> {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const { deps } = getContainer();
  const visible = new Set((await deps.workspace.listFoldersForUser(viewer.userId, viewer.companyId)).map((f) => f.id));
  const mine = ids.filter((id) => visible.has(id));
  if (mine.length === 0) return;
  await deps.workspace.reorderFolders(mine);
}

export async function shareFolder(viewer: Viewer, folderId: string, userId: string): Promise<void> {
  const { deps } = getContainer();
  const found = await deps.workspace.findFolder(folderId);
  if (!found) throw errNotFound('Папка');
  if (found.folder.owner_user !== viewer.userId) {
    throw errForbidden('Шарить папку может только владелец');
  }
  const target = await deps.users.findById(userId);
  if (!target) throw errNotFound('Пользователь');
  await deps.workspace.grantAccess(folderId, userId, viewer.userId);
}
