// application/media — модуль загрузки медиафайлов карточки робота и компании (миграция 016).
//
// Хранение: в БД (media_assets) — ТОЛЬКО текстовые ссылки на итоговые файлы объектного
// хранилища (infrastructure/storage.ts: S3 при MEDIA_S3_*, иначе локальный .media-store/).
// Бинарники в БД не живут.
//
// Фото: до 8 базовых (main/angle/node/scheme) + до 2 на каждый дополнительный блок:
//   оригинал JPEG/PNG/WebP ≤ 5 МБ, сторона ≤ 5000px → sharp → webp full 2560×1440 (q84),
//   preview 600×450 (q84), thumb 150×150 (q82); slot=scheme и PNG с альфой — q90/effort 9
//   (читаемость мелкого текста и векторов чертежей). Оригинальный файл после обработки с
//   сервера не остаётся: буфер формы обрабатывается в памяти и выбрасывается.
// Видео: 1 ролик на карточку (MP4/WebM ≤ 10 МБ, 019), компании — до 5.
// 3D: 1 модель .glb/.gltf, загрузка в админке строго ≤ 10 МБ (вендоры приносят Low-Poly;
//   30 МБ — только потолок хранилища, не UI-лимит). Раздача — model/gltf-binary + br/gzip.
//
// Права: карточку и её медиа ведёт владелец записи или менеджер компании (products_offer/demand_manage);
// витрину компании — участники своей компании; черновой scope формы создания — тот, кто карточку создаёт.

import { getContainer } from '@/infrastructure/container';
import { DomainError, errForbidden, errNotFound } from '@/shared/errors';
import { hasPermission } from '@/shared/permissions';
import { newId } from '@/shared/ids';
import { listVisibleFiles } from './files';
import { isMissingTable } from '@/application/module-014';
import { canEditProduct } from '@/application/products';
import { inspectPhoto, processPhoto, MAX_PHOTO_SIDE } from '@/infrastructure/images';
import { putObject, deleteObject, keyFromUrl } from '@/infrastructure/storage';
import {
  MEDIA_LIMITS,
  parseMediaOwner,
  type MediaAsset,
  type MediaOwnerType,
  type MediaSlot,
  type MediaType,
  type Viewer,
} from '@/domain';

const MB = 1024 * 1024;

/** Таблица media_assets появляется с миграцией 016 — пишем об этом прямо в ошибке. */
async function require016<T>(run: () => Promise<T>, what: string): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    const message = e instanceof Error ? e.message : String(e);
    if (code === '42703' && /addon_id/i.test(message)) {
      throw new DomainError(503, `${what}: примените migrations/017_product_editor_addons.sql для фото дополнительных блоков`);
    }
    if (!isMissingTable(e)) throw e;
    throw new DomainError(503, `${what}: примените migrations/016_media_video_reads.sql`);
  }
}

export type IncomingMediaFile = { name: string; mime: string; content: Buffer };

// ---------------------------------------------------------------------------
// Права на владельца медиа
// ---------------------------------------------------------------------------

function manageOpts(viewer: Viewer) {
  return {
    productsOfferManage: hasPermission(viewer, 'products_offer_manage'),
    productsDemandManage: hasPermission(viewer, 'products_demand_manage'),
  };
}

async function assertCanManage(viewer: Viewer, ownerType: MediaOwnerType, ownerId: string): Promise<string | null> {
  const { deps } = getContainer();
  const internal = hasPermission(viewer, 'cabinet_internal');
  if (ownerType === 'company') {
    if (viewer.companyId !== ownerId && !internal) {
      throw errForbidden('Видео компании загружают сотрудники своей компании');
    }
    return viewer.companyId;
  }
  if (ownerType === 'product') {
    const product = await deps.products.findById(ownerId);
    if (!product) throw errNotFound('Карточка');
    if (!canEditProduct(viewer, product, manageOpts(viewer))) {
      throw errForbidden('Медиа карточки меняет владелец записи или менеджер компании');
    }
    return product.vendor_company;
  }
  // draft: форма создания карточки; право — любое из manage-прав, владелец scope — автор.
  if (!manageOpts(viewer).productsOfferManage && !manageOpts(viewer).productsDemandManage && !internal) {
    throw errForbidden('Создавать карточки и их медиа могут менеджеры вендора/покупателя');
  }
  if (!/^new-[0-9a-z_-]{6,48}$/i.test(ownerId)) {
    throw new DomainError(400, 'Некорректный scope черновика');
  }
  if (!viewer.companyId && !internal) throw errForbidden('Медиа привязывается к компании');
  return viewer.companyId;
}

/** Право удалить медиа: загрузивший, менеджер компании-владельца или внутренний контур. */
function assertCanRemove(viewer: Viewer, asset: MediaAsset): void {
  const internal = hasPermission(viewer, 'cabinet_internal');
  if (internal || asset.uploaded_by === viewer.userId) return;
  if (viewer.companyId && asset.company === viewer.companyId) {
    const opts = manageOpts(viewer);
    if (opts.productsOfferManage || opts.productsDemandManage) return;
    if (asset.owner_type === 'company') return; // участник компании правит свою витрину
  }
  throw errForbidden('Удаляет медиа загрузивший или менеджер компании');
}

// ---------------------------------------------------------------------------
// Списки (публичная витрина смотрит медиа без управления)
// ---------------------------------------------------------------------------

export type MediaByType = {
  photos: MediaAsset[];
  video: MediaAsset | null;
  model: MediaAsset | null;
};

export async function listMedia(ownerType: MediaOwnerType, ownerId: string): Promise<MediaByType> {
  const { deps } = getContainer();
  let rows: MediaAsset[] = [];
  try {
    rows = await deps.media.listForOwner(ownerType, ownerId);
  } catch (e) {
    if (!isMissingTable(e)) throw e; // без миграции 016 витрина работает без медиа
  }
  const base = { photos: [] as MediaAsset[], video: null as MediaAsset | null, model: null as MediaAsset | null };
  for (const a of rows) {
    if (a.media_type === 'photo') base.photos.push(a);
    else if (a.media_type === 'video' && base.video === null) base.video = a;
    else if (a.media_type === 'model3d' && base.model === null) base.model = a;
  }
  return base;
}

/** Разбор «owner=product:pr…»; бросает 400 на мусоре. */
export function parseOwnerParam(raw: string | null | undefined): { type: MediaOwnerType; id: string } {
  const owner = parseMediaOwner(raw);
  if (!owner) throw new DomainError(400, 'Ожидается owner=product:<id> | company:<id> | draft:<scope>');
  return owner;
}

// ---------------------------------------------------------------------------
// Загрузка
// ---------------------------------------------------------------------------

const extOf = (name: string): string => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');

async function linkedPhotoCount(viewer: Viewer, ownerType: MediaOwnerType, ownerId: string): Promise<number> {
  const { deps } = getContainer();
  let logo: unknown = null;
  let images: unknown = [];
  if (ownerType === 'product') {
    const product = await deps.products.findById(ownerId);
    if (!product) return 0;
    logo = product.logo;
    images = product.images;
  } else if (ownerType === 'draft') {
    try {
      const draft = await deps.products.getEditorDraft(viewer.userId, 'new');
      if (draft?.payload.mediaScope !== ownerId) return 0;
      logo = draft.payload.logo;
      images = draft.payload.images;
    } catch (e) {
      if (!isMissingTable(e)) throw e; // автосохранение ещё не применено — квоту дополняет UI
    }
  }
  const imageUrls = Array.isArray(images)
    ? images.filter((url): url is string => typeof url === 'string' && url.trim() !== '')
    : [];
  return new Set([...imageUrls, ...(typeof logo === 'string' && logo.trim() ? [logo] : [])]).size;
}

async function withinQuota(
  viewer: Viewer,
  ownerType: MediaOwnerType,
  ownerId: string,
  type: MediaType,
  slot: MediaSlot,
  addonId: string | null,
): Promise<void> {
  const { deps } = getContainer();
  const current = await deps.media.listForOwner(ownerType, ownerId).catch(() => [] as MediaAsset[]);
  if (type === 'video') {
    const limit = ownerType === 'company' ? MEDIA_LIMITS.video.maxPerCompany : MEDIA_LIMITS.video.maxPerProduct;
    if (current.filter((a) => a.media_type === 'video').length >= limit) {
      throw new DomainError(409, `Видео уже загружено (максимум ${limit} на ${ownerType === 'company' ? 'витрину' : 'карточку'}). Сначала удалите прежнее.`);
    }
    return;
  }
  if (type === 'model3d') {
    if (current.some((a) => a.media_type === 'model3d')) {
      throw new DomainError(409, '3D-модель на карточку одна. Сначала удалите прежнюю.');
    }
    return;
  }
  // Фото: отдельная квота базовой карточки и до двух фото на каждый add-on.
  const linkedPhotos = await linkedPhotoCount(viewer, ownerType, ownerId);
  const photos = current.filter((a) => a.media_type === 'photo');
  if (photos.length + linkedPhotos >= MEDIA_LIMITS.photo.maxPerProduct) {
    throw new DomainError(409, `Достигнут общий лимит ${MEDIA_LIMITS.photo.maxPerProduct} фото для карточки.`);
  }
  if (slot === 'addon') {
    if (!addonId) throw new DomainError(400, 'Для фото дополнительного блока укажите addon_id.');
    const addonPhotos = photos.filter((p) => p.addon_id === addonId);
    if (addonPhotos.length >= MEDIA_LIMITS.photo.maxPerAddon) {
      throw new DomainError(409, `На этот дополнительный блок можно загрузить до ${MEDIA_LIMITS.photo.maxPerAddon} фото.`);
    }
    return;
  }
  if (addonId) throw new DomainError(400, 'addon_id допустим только для фото дополнительного блока.');
  if (slot === 'config' && photos.filter((p) => p.slot === 'config' && !p.addon_id).length >= MEDIA_LIMITS.photo.maxConfig) {
    throw new DomainError(409, `Для конфигурации — до ${MEDIA_LIMITS.photo.maxConfig} фото.`);
  }
  if (slot === 'module' && photos.filter((p) => p.slot === 'module' && !p.addon_id).length >= MEDIA_LIMITS.photo.maxModule) {
    throw new DomainError(409, `Для модулей — до ${MEDIA_LIMITS.photo.maxModule} фото.`);
  }
  const baseCount = linkedPhotos + photos.filter((p) => !p.addon_id && !['config', 'module'].includes(p.slot)).length;
  if (slot !== 'config' && slot !== 'module' && baseCount >= MEDIA_LIMITS.photo.maxBase) {
    throw new DomainError(409, `Базовая карточка — до ${MEDIA_LIMITS.photo.maxBase} фото. Дополнительные фото загружайте в соответствующий блок.`);
  }
}

/** Проверки исходника по типу медиа; возвращает «чистый» вход. */
function validateFile(type: MediaType, file: IncomingMediaFile): void {
  const ext = extOf(file.name);
  if (type === 'photo') {
    if (file.content.byteLength > MEDIA_LIMITS.photo.maxBytes) {
      throw new DomainError(413, `Фото «${file.name}»: максимум ${MEDIA_LIMITS.photo.maxBytes / MB} МБ.`);
    }
    const okMime = (MEDIA_LIMITS.photo.mimeAllowed as readonly string[]).includes(file.mime);
    const okExt = (MEDIA_LIMITS.photo.extAllowed as readonly string[]).includes(ext);
    if (!okMime && !okExt) {
      throw new DomainError(400, `Фото «${file.name}»: разрешены JPEG, PNG и WebP.`);
    }
    return;
  }
  if (type === 'video') {
    if (file.content.byteLength > MEDIA_LIMITS.video.maxBytes) {
      throw new DomainError(413, `Видео «${file.name}»: ограничение для одного файла — ${MEDIA_LIMITS.video.maxBytes / MB} МБ.`);
    }
    const okMime = (MEDIA_LIMITS.video.mimeAllowed as readonly string[]).includes(file.mime);
    const okExt = (MEDIA_LIMITS.video.extAllowed as readonly string[]).includes(ext);
    if (!okMime && !okExt) {
      throw new DomainError(400, `Видео «${file.name}»: разрешены MP4 и WebM.`);
    }
    return;
  }
  // model3d
  if (file.content.byteLength > MEDIA_LIMITS.model3d.maxBytes) {
    throw new DomainError(413, `3D-модель «${file.name}»: загрузка в админке строго до ${MEDIA_LIMITS.model3d.maxBytes / MB} МБ — приносите оптимизированный Low-Poly.`);
  }
  if (!['glb', 'gltf'].includes(ext)) {
    throw new DomainError(400, `3D-модель «${file.name}»: формат строго .glb или .gltf.`);
  }
  // Лёгкая проверка содержимого: glb — магический заголовок «glTF», gltf — JSON с asset.
  if (ext === 'glb') {
    const magic = file.content.subarray(0, 4).toString('latin1');
    if (magic !== 'glTF') throw new DomainError(400, 'Файл .glb не похож на бинарный glTF (нет заголовка glTF).');
  } else {
    const head = file.content.subarray(0, 4096).toString('utf8').trimStart();
    if (!head.startsWith('{') || !head.includes('"asset"')) {
      throw new DomainError(400, 'Файл .gltf не похож на JSON glTF 2.0.');
    }
  }
}

const variantExt = (url: string): string => extOf(url.split('#')[0].split('?')[0]);

/**
 * Загрузка медиафайла(ов). Фото проходят webp-пайплайн (оригинал в хранилище НЕ кладётся);
 * видео и 3D сохраняются как есть. Возвращает созданные строки media_assets.
 */
export async function uploadMedia(
  viewer: Viewer,
  input: {
    ownerType: MediaOwnerType;
    ownerId: string;
    mediaType: MediaType;
    slot?: MediaSlot | null;
    addonId?: string | null;
    files: IncomingMediaFile[];
  },
): Promise<MediaAsset[]> {
  if (input.files.length === 0) throw new DomainError(400, 'Файлы не переданы');
  const addonId = input.addonId?.trim() || null;
  if (addonId && !/^[a-z0-9_-]{1,100}$/i.test(addonId)) {
    throw new DomainError(400, 'Некорректный идентификатор дополнительного блока');
  }
  if (addonId && (input.mediaType !== 'photo' || input.slot !== 'addon')) {
    throw new DomainError(400, 'Фото дополнительного блока должно иметь слот addon');
  }
  if (input.slot === 'addon' && !addonId) {
    throw new DomainError(400, 'Для фото дополнительного блока укажите addon_id');
  }
  const company = await assertCanManage(viewer, input.ownerType, input.ownerId);
  if (input.ownerType === 'company' && input.mediaType !== 'video') {
    throw new DomainError(400, 'Компания загружает на витрину видео; фото и 3D живут в карточках товаров.');
  }
  const { deps } = getContainer();

  const created: MediaAsset[] = [];
  for (const file of input.files) {
    if (!file.name.trim()) throw new DomainError(400, 'Имя файла обязательно');
    validateFile(input.mediaType, file);
    await withinQuota(viewer, input.ownerType, input.ownerId, input.mediaType, input.slot ?? 'other', addonId);

    const id = await require016(
      async () => {
        // 1. Резервируем id, строим ключи и кладём объекты в хранилище.
        const assetId = newId('md');
        // id резеривируется ДО записи объектов: ключи в хранилище = media/<assetId>/…
        let row: Omit<MediaAsset, 'id' | 'created' | 'updated'> & { id: string };

        if (input.mediaType === 'photo') {
          const meta = await inspectPhoto(file.content);
          if (meta && Math.max(meta.width, meta.height) > MAX_PHOTO_SIDE) {
            throw new DomainError(400, `Фото «${file.name}»: сторона ${Math.max(meta.width, meta.height)}px превышает ${MAX_PHOTO_SIDE}px.`);
          }
          if (meta && !(MEDIA_LIMITS.photo.mimeAllowed as readonly string[]).includes(meta.mime)) {
            throw new DomainError(400, `Фото «${file.name}»: по содержимому это ${meta.mime}, а нужны JPEG/PNG/WebP.`);
          }
          const crisp = input.slot === 'scheme' || Boolean(meta?.hasAlpha && meta?.mime === 'image/png');
          const variants = await processPhoto(file.content, { crisp });
          const width = meta?.width ?? null;
          const height = meta?.height ?? null;
          if (variants) {
            const [full, preview, thumb] = await Promise.all([
              putObject(`media/${assetId}/full.webp`, variants.full, 'image/webp'),
              putObject(`media/${assetId}/preview.webp`, variants.preview, 'image/webp'),
              putObject(`media/${assetId}/thumb.webp`, variants.thumb, 'image/webp'),
            ]);
            row = {
              id: assetId,
              company,
              owner_type: input.ownerType,
              owner_id: input.ownerId,
              media_type: 'photo',
              slot: input.slot ?? 'other',
              addon_id: addonId,
              url: full.url,
              full_url: full.url,
              preview_url: preview.url,
              thumb_url: thumb.url,
              mime: 'image/webp',
              original_name: file.name.trim(),
              size: variants.full.byteLength,
              width,
              height,
              processed: true,
              uploaded_by: viewer.userId,
              sort_order: created.length,
            };
          } else {
            // Хранилище без sharp (demo-режим без нативного модуля): сохраняем оригинал.
            const stored = await putObject(
              `media/${assetId}/original.${variantExt(file.name) || 'bin'}`,
              file.content,
              file.mime || 'application/octet-stream',
            );
            row = {
              id: assetId,
              company,
              owner_type: input.ownerType,
              owner_id: input.ownerId,
              media_type: 'photo',
              slot: input.slot ?? 'other',
              addon_id: addonId,
              url: stored.url,
              full_url: stored.url,
              preview_url: stored.url,
              thumb_url: stored.url,
              mime: file.mime || meta?.mime || 'application/octet-stream',
              original_name: file.name.trim(),
              size: file.content.byteLength,
              width,
              height,
              processed: false,
              uploaded_by: viewer.userId,
              sort_order: created.length,
            };
          }
        } else {
          const ext = variantExt(file.name) || (input.mediaType === 'video' ? 'mp4' : 'glb');
          const mime =
            file.mime ||
            (input.mediaType === 'video'
              ? ext === 'webm'
                ? 'video/webm'
                : 'video/mp4'
              : ext === 'gltf'
                ? 'model/gltf+json'
                : 'model/gltf-binary');
          const stored = await putObject(`media/${assetId}/source.${ext}`, file.content, mime);
          row = {
            id: assetId,
            company,
            owner_type: input.ownerType,
            owner_id: input.ownerId,
            media_type: input.mediaType,
            slot: 'default',
            url: stored.url,
            full_url: null,
            preview_url: null,
            thumb_url: null,
            mime,
            original_name: file.name.trim(),
            size: file.content.byteLength,
            width: null,
            height: null,
            processed: false,
            uploaded_by: viewer.userId,
            sort_order: created.length,
          };
        }

        // 2. Первый снимок базового товара автоматически становится главным.
        if (input.mediaType === 'photo' && !input.slot) {
          const existing = await deps.media.listForOwner(input.ownerType, input.ownerId).catch(() => [] as MediaAsset[]);
          if (existing.filter((a) => a.media_type === 'photo').length === 0) row.slot = 'main';
        }

        return deps.media.create(row);
      },
      'Загрузка медиа',
    );

    const saved = await deps.media.findById(id);
    if (saved) created.push(saved);
    // Оригинальный буфер больше не нужен — на сервере он не записывался.
  }
  return created;
}

// ---------------------------------------------------------------------------
// Правки / удаление / перепривязка черновика
// ---------------------------------------------------------------------------

/** Назначить слот фото (кнопка «сделать главным» = slot main; остальные main → angle). */
export async function setMediaSlot(viewer: Viewer, id: string, slot: MediaSlot): Promise<void> {
  const { deps } = getContainer();
  const asset = await deps.media.findById(id);
  if (!asset) throw errNotFound('Медиа');
  if (slot === 'addon' && !asset.addon_id) throw new DomainError(400, 'Фото дополнительного блока должно быть привязано к addon_id');
  await assertCanManage(viewer, asset.owner_type, asset.owner_id);
  await require016(
    async () => {
      if (asset.media_type === 'photo' && slot === 'main') {
        for (const other of await deps.media.listForOwner(asset.owner_type, asset.owner_id)) {
          if (other.media_type === 'photo' && other.slot === 'main' && other.id !== id) {
            await deps.media.update(other.id, { slot: 'angle' });
          }
        }
      }
      await deps.media.update(id, { slot });
    },
    'Правка медиа',
  );
}

/**
 * «Прикрепить файл из Хранилища» — единое правило площадки: фото дополнительных
 * блоков, видео и 3D-модели карточек берутся из папок кабинета, а не грузятся
 * повторно из формы. Строка media_assets при этом ссылается на файл кабинета
 * (url = /api/v1/files/<id>), бинарники не дублируются, а удаление такой строки
 * (deleteMedia) файл в папке НЕ трогает — keyFromUrl её не находит.
 */
export async function importMediaFromStorage(
  viewer: Viewer,
  input: {
    ownerType: MediaOwnerType;
    ownerId: string;
    mediaType: MediaType;
    slot?: MediaSlot | null;
    addonId?: string | null;
    fileId: string;
  },
): Promise<MediaAsset> {
  const addonId = input.addonId?.trim() || null;
  if (addonId && !/^[a-z0-9_-]{1,100}$/i.test(addonId)) {
    throw new DomainError(400, 'Некорректный идентификатор дополнительного блока');
  }
  if (input.mediaType === 'photo' && (input.slot !== 'addon' || !addonId)) {
    throw new DomainError(400, 'Из Хранилища добавляются фото дополнительных блоков (slot=addon + addon_id)');
  }
  if (addonId && input.mediaType !== 'photo') {
    throw new DomainError(400, 'addon_id допустим только для фото дополнительного блока');
  }

  // Файл должен быть виден пользователю в его папках (своя компания/grants/допуск).
  const files = await listVisibleFiles(viewer);
  const file = files.find((f) => f.id === input.fileId);
  if (!file) throw errNotFound('Файл в Хранилище');

  const ext = extOf(file.name);
  if (input.mediaType === 'photo') {
    const okMime = file.mime.startsWith('image/');
    const okExt = (MEDIA_LIMITS.photo.extAllowed as readonly string[]).includes(ext);
    if (!okMime && !okExt) throw new DomainError(400, `«${file.name}»: нужен JPEG, PNG или WebP`);
    if (file.size > MEDIA_LIMITS.photo.maxBytes) {
      throw new DomainError(413, `Фото «${file.name}»: максимум ${MEDIA_LIMITS.photo.maxBytes / MB} МБ`);
    }
  } else if (input.mediaType === 'video') {
    const okMime = (MEDIA_LIMITS.video.mimeAllowed as readonly string[]).includes(file.mime);
    const okExt = (MEDIA_LIMITS.video.extAllowed as readonly string[]).includes(ext);
    if (!okMime && !okExt) throw new DomainError(400, `«${file.name}»: разрешены MP4 и WebM`);
    if (file.size > MEDIA_LIMITS.video.maxBytes) {
      throw new DomainError(413, `Видео «${file.name}»: ограничение для одного файла — ${MEDIA_LIMITS.video.maxBytes / MB} МБ`);
    }
  } else {
    if (!(MEDIA_LIMITS.model3d.extAllowed as readonly string[]).includes(ext)) {
      throw new DomainError(400, `«${file.name}»: формат строго .glb или .gltf`);
    }
    if (file.size > MEDIA_LIMITS.model3d.maxBytes) {
      throw new DomainError(413, `3D-модель «${file.name}»: загрузка в админке строго до ${MEDIA_LIMITS.model3d.maxBytes / MB} МБ`);
    }
  }

  const company = await assertCanManage(viewer, input.ownerType, input.ownerId);
  await withinQuota(viewer, input.ownerType, input.ownerId, input.mediaType, input.slot ?? 'other', addonId);

  // Габариты фото — из содержимого (sharp): в подсказке хранилища заявлены размеры,
  // а не количество. Для видео/3D ширина-высота не нужны.
  let width: number | null = null;
  let height: number | null = null;
  if (input.mediaType === 'photo') {
    const content = await getContainer().deps.workspace.findFileContent(file.id).catch(() => null);
    const meta = content ? await inspectPhoto(content.content) : null;
    if (meta && Math.max(meta.width, meta.height) > MAX_PHOTO_SIDE) {
      throw new DomainError(400, `Фото «${file.name}»: сторона ${Math.max(meta.width, meta.height)}px превышает ${MAX_PHOTO_SIDE}px`);
    }
    width = meta?.width ?? null;
    height = meta?.height ?? null;
  }

  const { deps } = getContainer();
  const id = newId('md');
  const url = `/api/v1/files/${file.id}`;
  await require016(
    () =>
      deps.media.create({
        id,
        company,
        owner_type: input.ownerType,
        owner_id: input.ownerId,
        media_type: input.mediaType,
        slot: input.mediaType === 'photo' ? 'addon' : 'default',
        addon_id: addonId,
        url,
        full_url: url,
        preview_url: url,
        thumb_url: url,
        mime: file.mime,
        original_name: file.name,
        size: file.size,
        width,
        height,
        processed: false,
        uploaded_by: viewer.userId,
        sort_order: 0,
      }),
    'Прикрепление файла из Хранилища',
  );
  const created = await deps.media.findById(id);
  if (!created) throw new DomainError(500, 'Не удалось прикрепить файл из Хранилища');
  return created;
}

export async function deleteMedia(viewer: Viewer, id: string): Promise<void> {
  const { deps } = getContainer();
  const asset = await deps.media.findById(id);
  if (!asset) throw errNotFound('Медиа');
  assertCanRemove(viewer, asset);
  const removed = await require016(() => deps.media.delete(id), 'Удаление медиа');
  if (!removed) return;
  // Чистим объекты хранилища (webp-варианты или оригинал).
  for (const url of [removed.url, removed.full_url, removed.preview_url, removed.thumb_url]) {
    const key = keyFromUrl(url);
    if (key) await deleteObject(key);
  }
}

/**
 * Форма создания: медиа грузится на scope «new-<uuid>», после создания карточки
 * строки переезжают на products.id. Вызывается из server action createProduct.
 */
export async function reassignDraftMedia(viewer: Viewer, scopeToken: string, productId: string): Promise<number> {
  if (!scopeToken || !/^new-[0-9a-z_-]{6,48}$/i.test(scopeToken)) return 0;
  const { deps } = getContainer();
  try {
    return await deps.media.reassignOwner({
      fromType: 'draft',
      fromId: scopeToken,
      toType: 'product',
      toId: productId,
      company: viewer.companyId,
      actorId: viewer.userId,
    });
  } catch (e) {
    if (isMissingTable(e)) return 0;
    throw e;
  }
}

/** Медиа для страницы компании (витрина /companies/[id] и /my-company). */
export async function listCompanyVideos(companyId: string): Promise<MediaAsset[]> {
  const { deps } = getContainer();
  const rows = await deps.media.listForOwner('company', companyId).catch(() => [] as MediaAsset[]);
  return rows.filter((a) => a.media_type === 'video');
}
