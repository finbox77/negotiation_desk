// application/products — use-cases карточек и каталога с эквалайзером.

import { getContainer } from '@/infrastructure/container';
import { readWeights, scoreSelection, type Weights } from '@/shared/equalizer-scoring';
import { resolveMetrics, type MetricDef } from '@/shared/tech-metrics';
import { industryPreset } from '@/shared/industry-presets';
import { DomainError, errForbidden, errNotFound } from '@/shared/errors';
import { isMissingTable } from '@/application/module-014';
import { MEDIA_LIMITS } from '@/domain';
import type {
  CatalogFilter,
  ListingIntent,
  Product,
  ProductAddOn,
  ProductEditorDraft,
  ProductFeature,
  ProductPatch,
  ProductRank,
  ProductWithRank,
  Viewer,
} from '@/domain';

export type ProductDetail = {
  product: Product;
  features: ProductFeature[];
  rank: ProductRank | null;
};

/** Проверка гибких дополнительных блоков перед записью в products.addons. */
function validateAddons(addons: ProductAddOn[] | undefined): void {
  if (addons === undefined) return;
  if (!Array.isArray(addons)) throw new DomainError(400, 'Дополнительные блоки должны быть списком');
  const counts = { component: 0, service: 0 };
  const ids = new Set<string>();
  for (const item of addons) {
    if (!item || (item.kind !== 'component' && item.kind !== 'service')) {
      throw new DomainError(400, 'У дополнительного блока указан неизвестный тип');
    }
    counts[item.kind] += 1;
    if (counts[item.kind] > 4) throw new DomainError(400, 'Можно добавить не более четырёх блоков каждого типа');
    if (typeof item.id !== 'string' || item.id.length < 1 || item.id.length > 100 || ids.has(item.id)) {
      throw new DomainError(400, 'Идентификатор дополнительного блока некорректен');
    }
    ids.add(item.id);
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.trim().length > 100) {
      throw new DomainError(400, 'Название дополнительного блока обязательно и ограничено 100 знаками');
    }
    if (!['new', 'used', 'refurbished'].includes(item.state)) {
      throw new DomainError(400, `Состояние блока «${item.name}» указано неверно`);
    }
    if (!Number.isFinite(item.price) || item.price < 0) {
      throw new DomainError(400, `Цена блока «${item.name}» должна быть неотрицательным числом`);
    }
    if (item.characteristics != null && (typeof item.characteristics !== 'string' || item.characteristics.length > 1500)) {
      throw new DomainError(400, `Характеристики блока «${item.name}» ограничены 1500 знаками`);
    }
    if (item.description != null && (typeof item.description !== 'string' || item.description.length > 1500)) {
      throw new DomainError(400, `Описание блока «${item.name}» ограничено 1500 знаками`);
    }
  }
}

function productPhotoRefs(logo: string | null | undefined, images: string[] | null | undefined): string[] {
  return [...new Set([...(logo ? [logo] : []), ...(images ?? []).filter((url): url is string => typeof url === 'string' && url.trim() !== '')])];
}

/** Старые карточки сохраняются, но новые базовые фото соблюдают лимит 8. */
function validateBasePhotoRefs(
  logo: string | null | undefined,
  images: string[] | null | undefined,
  existingRefs: string[] = [],
  mediaBaseCount = 0,
): void {
  const nextRefs = productPhotoRefs(logo, images);
  const existing = new Set(existingRefs);
  if (
    nextRefs.length + mediaBaseCount > MEDIA_LIMITS.photo.maxBase &&
    nextRefs.some((url) => !existing.has(url))
  ) {
    throw new DomainError(400, `В базовой части карточки можно хранить не более ${MEDIA_LIMITS.photo.maxBase} фото`);
  }
}

export async function getProduct(id: string): Promise<ProductDetail | null> {
  const { deps } = getContainer();
  const product = await deps.products.findById(id);
  if (!product) return null;
  const [features, rank] = await Promise.all([
    deps.products.findFeatures(id),
    deps.products.findRank(id),
  ]);
  return { product, features, rank };
}

export type RatedCatalogItem = ProductWithRank & {
  score: number;
  missing: number;
  hasScore: boolean;
};

export type RatedCatalog = {
  items: RatedCatalogItem[];
  metrics: MetricDef[];
  weights: Weights;
  totalWeight: number;
};

/**
 * Каталог витрины: жёсткая выборка (словари) + веса эквалайзера из URL.
 * Рейтинг считается по min/max текущей выборки (vision §6.2) — общий scorer.
 */
export async function getRatedCatalog(searchParams: Record<string, string | string[] | undefined>): Promise<RatedCatalog> {
  const { deps } = getContainer();

  const str = (key: string): string | null => {
    const v = searchParams[key];
    return typeof v === 'string' && v !== '' ? v : null;
  };

  // ?opt=leasing,raas — мультивыбор вариантов приобретения (карточка должна
  // предлагать хотя бы один из выбранных; пусто/«все» = без фильтра).
  const optRaw = str('opt');
  const purchaseOptionSlugs = optRaw
    ? optRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : null;

  const filter: Partial<CatalogFilter> = {
    categorySlug: str('cat'),
    industrySlug: str('ind'),
    operatingSlug: str('env'),
    purchaseOptionSlugs,
  };

  const [rows, options] = await Promise.all([
    deps.products.findPublished(filter),
    deps.dictionaries.listPurchaseOptions(),
  ]);
  void options; // подписи вариантов подтягивает data.ts блока, если нужны в карточке

  const metrics = resolveMetrics(str('cat'), str('ind'));
  let weights = readWeights(searchParams);
  // Пресет отрасли: если отрасль выбрана, а веса руками не заданы — применяем
  // стандартный усреднённый профиль (shared/industry-presets).
  const preset = industryPreset(str('ind'));
  if (Object.keys(weights).length === 0 && preset) weights = preset;
  const scores = scoreSelection(
    rows.map((r) => ({ id: r.product.id, rank: r.rank, values: r.product.specifications })),
    metrics,
    weights,
  );
  const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0);

  let items: RatedCatalogItem[] = rows.map((r) => {
    const s = scores.get(r.product.id);
    return { ...r, score: s?.score ?? 0, missing: s?.missing ?? 0, hasScore: totalWeight > 0 && (s?.score ?? 0) > 0 };
  });

  if (totalWeight > 0) {
    items = [...items].sort((a, b) => b.score - a.score || a.product.created.getTime() - b.product.created.getTime());
  }

  return { items, metrics, weights, totalWeight };
}

/** Варианты приобретения (подписи) для карточек. */
export async function getPurchaseOptionNames(): Promise<Map<string, string>> {
  const { deps } = getContainer();
  const options = await deps.dictionaries.listPurchaseOptions();
  return new Map(options.map((o) => [o.slug, o.name]));
}

/** Право редактировать карточку: владелец записи ИЛИ менеджер своей компании. */
export function canEditProduct(
  viewer: Viewer,
  product: Product,
  opts: { productsOfferManage: boolean; productsDemandManage: boolean },
): boolean {
  if (product.user_id === viewer.userId) return true;
  if (product.vendor_company && product.vendor_company === viewer.companyId) {
    return product.listing_intent === 'demand' ? opts.productsDemandManage : opts.productsOfferManage;
  }
  return false;
}

/**
 * Фото карточки для проверок публикации: ссылки products (logo/images) + медиа
 * карточки, включая фото дополнительных модулей — их тоже можно продавать отдельно.
 * Возвращает уникальные URL: одни и те же файлы не считаются дважды.
 */
export async function productPhotoUrls(product: Product): Promise<string[]> {
  const { deps } = getContainer();
  const refs = productPhotoRefs(product.logo, product.images);
  let mediaUrls: string[] = [];
  try {
    mediaUrls = (await deps.media.listForOwner('product', product.id))
      .filter((asset) => asset.media_type === 'photo')
      .map((asset) => asset.url);
  } catch (e) {
    if (!isMissingTable(e)) throw e; // без миграции 016 считаем только ссылки карточки
  }
  return [...new Set([...refs, ...mediaUrls])].filter((url) => url.trim() !== '');
}

/**
 * Что мешает публикации карточки (019). Список человекочитаемых пунктов:
 * название, цена/бюджет, категория, описание, подробное описание, комплектация,
 * условия приобретения, технические характеристики и не менее двух фото.
 */
export async function productPublishMissing(product: Product): Promise<string[]> {
  const missing: string[] = [];
  if (!product.title.trim()) missing.push('Название');
  if (!product.category || !product.category.trim()) missing.push('Категория');
  if (product.price === null || product.price <= 0) {
    missing.push(product.listing_intent === 'demand' ? 'Бюджет' : 'Цена');
  }
  if ((product.description ?? '').trim().length < 100) {
    missing.push('Описание (не короче 100 знаков)');
  }
  if (!(product.characteristics ?? '').trim()) missing.push('Подробное описание');
  if (!(product.package_contents ?? '').trim()) missing.push('Комплектация');
  if ((product.purchase_options ?? []).length === 0) missing.push('Условия приобретения (хотя бы один вариант)');
  const specs = Object.values(product.specifications ?? {}).filter(
    (value) => value !== null && value !== undefined && String(value).trim() !== '',
  );
  if (specs.length === 0) missing.push('Технические характеристики');
  const photoCount = (await productPhotoUrls(product)).length;
  if (photoCount < 2) missing.push('Фото (не менее 2 — подойдут и фото дополнительных модулей)');
  return missing;
}

/** Текст ошибки публикации одной строкой — для server action и API. */
export function publishMissingMessage(missing: string[]): string {
  return `Карточка не опубликована — заполните: ${missing.join(', ')}`;
}

/**
 * Публикация и снятие с публикации из кабинета (019): отдельное действие, чтобы
 * не открывать весь редактор. Требования к наполнению проверяются на сервере —
 * обойти кнопку подменой запроса нельзя.
 */
export async function setProductPublished(
  viewer: Viewer,
  id: string,
  publish: boolean,
  opts: { productsOfferManage: boolean; productsDemandManage: boolean },
): Promise<{ missing: string[] }> {
  const { deps } = getContainer();
  const product = await deps.products.findById(id);
  if (!product) throw errNotFound('Карточка');
  if (!canEditProduct(viewer, product, opts)) {
    throw errForbidden('Публиковать карточку может владелец или менеджер компании');
  }
  if (publish && !product.published) {
    const missing = await productPublishMissing(product);
    if (missing.length > 0) return { missing };
  }
  await deps.products.update(id, { published: publish });
  return { missing: [] };
}

/** Сохранение карточки со страницы редактирования (внутренний контур). */
export async function updateProductCard(
  viewer: Viewer,
  id: string,
  patch: ProductPatch,
  opts: { productsOfferManage: boolean; productsDemandManage: boolean },
): Promise<void> {
  const { deps } = getContainer();
  const product = await deps.products.findById(id);
  if (!product) throw errNotFound('Карточка');
  if (!canEditProduct(viewer, product, opts)) {
    throw errForbidden('Редактировать карточку может владелец или менеджер компании');
  }
  if (patch.title !== undefined && !patch.title.trim()) {
    throw new DomainError(400, 'Название обязательно');
  }
  if (patch.price !== undefined && patch.price < 0) {
    throw new DomainError(400, 'Цена не может быть отрицательной');
  }
  if (patch.description !== undefined && patch.description !== null && patch.description.trim().length < 100) {
    throw new DomainError(400, 'Описание: минимум 100 знаков или оставьте пустым (CHECK схемы products)');
  }
  if (patch.solution_summary && patch.solution_summary.trim().length > 400) {
    throw new DomainError(400, 'Краткое описание инфраструктурного решения ограничено 400 знаками');
  }
  if (patch.logo !== undefined || patch.images !== undefined) {
    let mediaBaseCount = 0;
    try {
      mediaBaseCount = (await deps.media.listForOwner('product', id)).filter(
        (asset) => asset.media_type === 'photo' && !asset.addon_id && !['config', 'module'].includes(asset.slot),
      ).length;
    } catch (e) {
      if (!isMissingTable(e)) throw e;
    }
    validateBasePhotoRefs(
      patch.logo !== undefined ? patch.logo : product.logo,
      patch.images !== undefined ? patch.images : product.images,
      productPhotoRefs(product.logo, product.images),
      mediaBaseCount,
    );
  }
  validateAddons(patch.addons);
  // Публикация из редактора подчиняется тем же требованиям, что и кнопка в кабинете.
  if (patch.published === true && !product.published) {
    const missing = await productPublishMissing({ ...product, ...patch } as Product);
    if (missing.length > 0) throw new DomainError(400, publishMissingMessage(missing));
  }
  await deps.products.update(id, patch);
  // Папка карточки в кабинете: создаём при первом сохранении, дальше — идемпотентно.
  await ensureProductFolder(viewer, id, patch.title?.trim() || product.title);
}

/** Отметить карточку просмотренной, чтобы убрать её из индекса «нового». */
export async function markProductViewed(viewer: Viewer, productId: string): Promise<void> {
  const { deps } = getContainer();
  const product = await deps.products.findById(productId);
  if (!product) throw errNotFound('Карточка');
  const canSee =
    product.published ||
    product.user_id === viewer.userId ||
    (product.vendor_company !== null && product.vendor_company === viewer.companyId) ||
    viewer.permissionNames.includes('cabinet_internal');
  if (!canSee) throw errNotFound('Карточка');
  try {
    await deps.products.markRead(viewer.userId, productId);
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    // Без миграции 017 карточка открывается как обычно, просто без бейджа.
  }
}

/** Черновик редактора читаем только в пределах сессии своего пользователя. */
export async function getProductEditorDraft(userId: string, draftKey: string): Promise<ProductEditorDraft | null> {
  const { deps } = getContainer();
  try {
    return await deps.products.getEditorDraft(userId, draftKey);
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}

/** Очистить личный черновик после явного сохранения карточки или сброса формы. */
export async function clearProductEditorDraft(userId: string, draftKey: string): Promise<void> {
  const { deps } = getContainer();
  try {
    await deps.products.deleteEditorDraft(userId, draftKey);
  } catch (e) {
    if (isMissingTable(e)) return;
    throw e;
  }
}

/**
 * Автосохранение формы (017): текущие значения остаются черновиком и не меняют
 * опубликованную карточку до явного действия «Сохранить изменения».
 */
export async function saveProductEditorDraft(
  viewer: Viewer,
  productId: string | null,
  payload: Record<string, unknown>,
  opts: { productsOfferManage: boolean; productsDemandManage: boolean },
): Promise<void> {
  const { deps } = getContainer();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new DomainError(400, 'Некорректный черновик карточки');
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    throw new DomainError(400, 'Черновик карточки не удалось прочитать');
  }
  if (Buffer.byteLength(serialized, 'utf8') > 300 * 1024) {
    throw new DomainError(413, 'Черновик карточки превышает допустимый объём');
  }

  if (productId) {
    const product = await deps.products.findById(productId);
    if (!product || !canEditProduct(viewer, product, opts)) {
      throw errForbidden('Нет права сохранять черновик этой карточки');
    }
  } else if (!opts.productsOfferManage && !opts.productsDemandManage) {
    throw errForbidden('Нет права создавать карточки');
  }

  const draftKey = productId ?? 'new';
  try {
    await deps.products.saveEditorDraft({ userId: viewer.userId, draftKey, productId, payload });
  } catch (e) {
    if (isMissingTable(e)) {
      throw new DomainError(503, 'Автосохранение недоступно: примените migrations/017_product_editor_addons.sql');
    }
    throw e;
  }
}

/**
 * Папка карточки в кабинете (013): сохранённая карточка автоматически лежит в
 * своей папке (ссылка workspace_folders.products). Создаём раз, если ещё нет.
 */
async function ensureProductFolder(viewer: Viewer, productId: string, title: string): Promise<void> {
  const { deps } = getContainer();
  const folders = await deps.workspace.listFoldersForUser(viewer.userId, viewer.companyId);
  if (folders.some((f) => f.products === productId)) return;
  await deps.workspace.createFolder({
    name: title,
    folder_type: 'general',
    minClearanceRequired: viewer.clearanceLevel,
    color: 'gray',
    company: viewer.companyId,
    ownerUserId: viewer.userId,
    products: productId,
  });
}

/**
 * Создание карточки — кнопка «Создать карточку» в кабинете (013).
 * Оффер создаёт менеджер вендора (products_offer_manage), потребность —
 * покупатель (products_demand_manage). Черновик по умолчанию: published = false.
 */
export async function createProductCard(
  viewer: Viewer,
  patch: ProductPatch,
  opts: { productsOfferManage: boolean; productsDemandManage: boolean },
  mediaScope?: string,
): Promise<string> {
  const intent: ListingIntent = opts.productsOfferManage ? 'offer' : 'demand';
  if (intent === 'offer' && !opts.productsOfferManage) {
    throw errForbidden('Создавать оффер может менеджер вендора (products_offer_manage)');
  }
  if (intent === 'demand' && !opts.productsDemandManage) {
    throw errForbidden('Создавать потребность может менеджер покупателя (products_demand_manage)');
  }
  if (patch.title === undefined || !patch.title.trim()) {
    throw new DomainError(400, 'Название карточки обязательно');
  }
  if ((patch.price ?? 0) < 0) {
    throw new DomainError(400, 'Цена не может быть отрицательной');
  }
  if (!patch.purchase_options || patch.purchase_options.length === 0) {
    throw new DomainError(400, 'Выберите хотя бы один вариант приобретения');
  }
  if (patch.description !== undefined && patch.description !== null && patch.description.trim().length < 100) {
    throw new DomainError(400, 'Описание: минимум 100 знаков или оставьте пустым (CHECK схемы products)');
  }
  if (patch.solution_summary && patch.solution_summary.trim().length > 400) {
    throw new DomainError(400, 'Краткое описание инфраструктурного решения ограничено 400 знаками');
  }
  const { deps } = getContainer();
  let mediaBaseCount = 0;
  if (mediaScope) {
    if (!/^new-[0-9a-z_-]{6,48}$/i.test(mediaScope)) throw new DomainError(400, 'Некорректная область чернового медиа');
    try {
      mediaBaseCount = (await deps.media.listForOwner('draft', mediaScope)).filter(
        (asset) => asset.media_type === 'photo' && !asset.addon_id && !['config', 'module'].includes(asset.slot),
      ).length;
    } catch (e) {
      if (!isMissingTable(e)) throw e;
    }
  }
  validateBasePhotoRefs(patch.logo, patch.images, [], mediaBaseCount);
  validateAddons(patch.addons);
  const categories = await deps.dictionaries.listCategories();
  const category = patch.category && categories.some((c) => c.id === patch.category)
    ? patch.category
    : categories[0]?.id;
  if (!category) throw new DomainError(400, 'Справочник категорий пуст');

  const id = await deps.products.create({
    title: patch.title.trim(),
    price: patch.price ?? 0,
    vendor_company: viewer.companyId,
    user_id: viewer.userId,
    condition: patch.condition ?? 'new',
    purchase_options: patch.purchase_options,
    published: patch.published ?? false,
    category,
    listing_intent: intent,
    description: patch.description?.trim() || null,
    characteristics: patch.characteristics?.trim() || null,
    package_contents: patch.package_contents?.trim() || null,
    logo: patch.logo ?? null,
    images: patch.images ?? null,
    docs: patch.docs ?? null,
    pdi_cost_base: patch.pdi_cost_base ?? null,
    maintenance_cost_year_base: patch.maintenance_cost_year_base ?? null,
    lifespan_years: patch.lifespan_years ?? null,
    specifications: patch.specifications ?? null,
    has_complex_solution: patch.has_complex_solution ?? false,
    solution_summary: patch.solution_summary?.trim() || null,
    addons: patch.addons ?? [],
    rental_terms: patch.rental_terms?.trim() || null,
    raas_terms: patch.raas_terms?.trim() || null,
    leasing_terms: patch.leasing_terms?.trim() || null,
    credit_terms: patch.credit_terms?.trim() || null,
    installment_terms: patch.installment_terms?.trim() || null,
    factoring_terms: patch.factoring_terms?.trim() || null,
    subscription_terms: patch.subscription_terms?.trim() || null,
    sharing_terms: patch.sharing_terms?.trim() || null,
    gov_program_terms: patch.gov_program_terms?.trim() || null,
    promo_terms: patch.promo_terms?.trim() || null,
  });

  // Сохранённая карточка сразу лежит в своей папке кабинета (013).
  await ensureProductFolder(viewer, id, patch.title.trim());
  return id;
}
