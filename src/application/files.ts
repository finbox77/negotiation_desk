// application/files — файлы в папках кабинета (миграция 012):
// загрузка с компьютера (фото и документы), списки для кабинета и медиатеки
// редактора товара, выдача содержимого, удаление. Видимость файла = видимость
// его папки (владелец / grant / компания, допуск — как у папок, §4).

import { getContainer } from '@/infrastructure/container';
import { DomainError, errForbidden, errNotFound } from '@/shared/errors';
import { listVisibleFolders } from '@/application/folders';
import { isCleared } from '@/shared/permissions';
import { detectFileKind, MEDIA_LIMITS, type Viewer, type WorkspaceFile } from '@/domain';

export type VisibleFile = WorkspaceFile & {
  folderName: string;
  folderColor: string | null;
};

/** Тестовый этап: храним содержимое в БД, поэтому ограничиваем размер файла. */
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 МБ
/** Видео в папки (016): лимит одного файла — как у документа (019: 10 МБ). */
export const MAX_VIDEO_SIZE = MEDIA_LIMITS.video.maxBytes; // 10 МБ

/** Все файлы всех папок, видимых пользователю (для медиатеки редактора). */
export async function listVisibleFiles(viewer: Viewer): Promise<VisibleFile[]> {
  const { deps } = getContainer();
  const folders = await listVisibleFolders(viewer);
  const out: VisibleFile[] = [];
  for (const f of folders) {
    const files = await deps.workspace.listFiles(f.id);
    out.push(...files.map((x) => ({ ...x, folderName: f.name, folderColor: f.color })));
  }
  return out.sort((a, b) => b.created.getTime() - a.created.getTime());
}

/** Папка доступна пользователю: владелец, grant или своя компания. */
async function assertCanUseFolder(viewer: Viewer, folderId: string) {
  const { deps } = getContainer();
  const found = await deps.workspace.findFolder(folderId);
  if (!found) throw errNotFound('Папка');
  const { folder } = found;
  const ok =
    folder.owner_user === viewer.userId ||
    (viewer.companyId !== null && folder.company === viewer.companyId) ||
    found.grants.some((g) => g.user_id === viewer.userId);
  if (!ok) throw errForbidden('Папка вам не доступна');
  return folder;
}

export type IncomingFile = { name: string; mime: string; content: Buffer };

/** Загрузка файлов с компьютера в папку кабинета. */
export async function uploadFiles(
  viewer: Viewer,
  folderId: string,
  incoming: IncomingFile[],
): Promise<WorkspaceFile[]> {
  if (incoming.length === 0) throw new DomainError(400, 'Файлы не переданы');
  await assertCanUseFolder(viewer, folderId);
  const { deps } = getContainer();
  const created: WorkspaceFile[] = [];
  for (const f of incoming) {
    if (!f.name.trim()) throw new DomainError(400, 'Имя файла обязательно');
    const mime = f.mime || 'application/octet-stream';
    // Тип определяем ДО проверки веса: лимит видео равен лимиту документа (10 МБ, 019),
    // ошибка говорит ровно то, что видно пользователю (nginx стенда разрешает 12 МБ —
    // см. deploy/nginx-simonix.conf.example).
    const kind = detectFileKind(mime, f.name);
    const limit = kind === 'video' ? MAX_VIDEO_SIZE : MAX_FILE_SIZE;
    if (f.content.byteLength > limit) {
      throw new DomainError(
        413,
        kind === 'video'
          ? `Видео «${f.name}» больше 10 МБ — ограничение для одного видеофайла`
          : `Файл «${f.name}» больше 10 МБ`,
      );
    }
    const now = new Date();
    const id = await deps.workspace.createFile({
      folder: folderId,
      name: f.name.trim(),
      mime,
      size: f.content.byteLength,
      content: f.content,
      uploadedBy: viewer.userId,
      // Тип файла Хранилища (014, видео — 016): фото / документ / программа / прошивка / видео.
      kind,
    });
    created.push({
      id,
      folder: folderId,
      name: f.name.trim(),
      mime,
      size: f.content.byteLength,
      kind,
      uploaded_by: viewer.userId,
      created: now,
    });
  }
  return created;
}

/**
 * «Файл открыт» — отметка прочтения для бейджей «N новых» (016).
 * Best-effort: без таблицы reads (миграция не применена) молча ничего не делаем —
 * просмотр файла не должен падать из-за счётчика.
 */
export async function markFileViewed(viewer: Viewer, fileId: string): Promise<void> {
  const { deps } = getContainer();
  try {
    await deps.workspace.markFileRead(viewer.userId, fileId);
  } catch {
    /* workspace_file_reads недоступна — пропускаем */
  }
}

/** Выбор файла в Explorer уже показывает его свойства справа — считаем это просмотром. */
export async function markFileSelected(viewer: Viewer, fileId: string): Promise<void> {
  const { deps } = getContainer();
  const folders = await listVisibleFolders(viewer);
  for (const folder of folders) {
    if (!isCleared(viewer, folder.min_clearance_required)) continue;
    if (!(await deps.workspace.listFiles(folder.id)).some((file) => file.id === fileId)) continue;
    await markFileViewed(viewer, fileId);
    return;
  }
  throw errNotFound('Файл');
}

/** Открытие папки фиксируется отдельно от непрочитанных файлов внутри неё. */
export async function markFolderViewed(viewer: Viewer, folderId: string): Promise<void> {
  const { deps } = getContainer();
  const folder = await assertCanUseFolder(viewer, folderId);
  if (!isCleared(viewer, folder.min_clearance_required)) throw errForbidden('Недостаточный допуск к папке');
  try {
    await deps.workspace.markFolderRead(viewer.userId, folderId);
  } catch {
    /* workspace_folder_reads недоступна до миграции 017 — не мешаем открыть папку */
  }
}

/** Короткое имя для серверных действий, уравновешенное markFileSelected. */
export const markFolder = markFolderViewed;

/** Бейджи папок используют те же персональные отметки, что рельс (018). */
export async function unreadCounts(viewer: Viewer, folderIds: string[]): Promise<Record<string, number>> {
  const { deps } = getContainer();
  const seen = new Set(await deps.records.acknowledged(viewer.userId, 'file'));
  const allowed = new Set((await listVisibleFolders(viewer)).filter(f => f.visible).map(f => f.id));
  return Object.fromEntries(await Promise.all(folderIds.filter(id => allowed.has(id)).map(async id =>
    [id, (await deps.workspace.listFiles(id)).filter(f => !seen.has(f.id)).length])));
}
export async function unreadFolderCounts(viewer: Viewer, folderIds: string[]): Promise<Record<string, number>> {
  const { deps } = getContainer();
  const seen = new Set(await deps.records.acknowledged(viewer.userId, 'folder'));
  const allowed = new Map(
    (await listVisibleFolders(viewer)).filter(f => f.visible).map(f => [f.id, f] as const),
  );
  return Object.fromEntries(folderIds.filter(id => allowed.has(id)).map(id => {
    // Свою папку автор «новой» не видит — счётчик появляется у тех, кто её ещё не открывал.
    const own = allowed.get(id)?.owner_user === viewer.userId;
    return [id, own || seen.has(id) ? 0 : 1];
  }));
}

/** Содержимое файла (отдаёт /api/v1/files/:id). */
export async function getFileContent(id: string) {
  const { deps } = getContainer();
  const found = await deps.workspace.findFileContent(id);
  if (!found) throw errNotFound('Файл');
  return found;
}

/** Удаление файла: право на папку + загрузивший или владелец папки. */
export async function deleteFile(viewer: Viewer, id: string, password?: string): Promise<void> {
  const { deleteRecord } = await import('./records');
  await deleteRecord(viewer, 'file', id, password);
}

/** Человекочитаемый размер файла. */
export function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
