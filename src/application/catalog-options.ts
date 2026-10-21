// application/catalog-options — справочники жёсткой выборки (эквалайзеры, §6.1).

import { getContainer } from '@/infrastructure/container';

export type FilterOption = { slug: string; name: string };

export type EqualizerOptions = {
  categories: FilterOption[];
  industries: FilterOption[];
  environments: FilterOption[];
};

export async function getEqualizerOptions(): Promise<EqualizerOptions> {
  const { deps } = getContainer();
  const [categories, industries, environments] = await Promise.all([
    deps.dictionaries.listCategories(),
    deps.dictionaries.listIndustries(),
    deps.dictionaries.listOperatingConditions(),
  ]);
  const toOpt = (x: { slug: string; name: string }): FilterOption => ({ slug: x.slug, name: x.name });
  return {
    categories: categories.map(toOpt),
    industries: industries.map(toOpt),
    environments: environments.map(toOpt),
  };
}
