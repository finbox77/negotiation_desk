// components/TableList.tsx — левый рельс: поиск, выборка и окна стола.
//
// Одинарный клик — предпросмотр окна в центре (без закрепления), двойной —
// закрепить в мини-шапке (новые закрепления появляются там слева). Выборка:
// кнопка-дерево перед «Все» открывает независимое окно категорий и статусов
// (ChatsTreeWindow); отмеченные там галочками категории/статусы — это чипсы
// в полосе прокрутки ниже. «Все» не удаляется и показана всегда.

import { useMemo, useState } from 'react';
import { disputeLabel, statusLabel } from '../desk/labels';
import { plural, relativeTime } from '../desk/format';
import type { DeskController } from '../desk/useDesk';
import type { TableSummary } from '../desk/types';
import ChatsTreeWindow from './ChatsTreeWindow';
import { Icon, SignalDot } from './Icons';

export type FilterDef = {
  id: string;
  label: string;
  kind: 'category' | 'status';
  /** Своя категория пользователя (можно удалить). */
  custom?: boolean;
};

const CATEGORY_FILTERS: FilterDef[] = [
  { id: 'fresh', label: 'Новые', kind: 'category' },
  { id: 'clients', label: 'Клиенты', kind: 'category' },
  { id: 'partners', label: 'Партнёры', kind: 'category' },
  { id: 'mine', label: 'Созданные мной', kind: 'category' },
];

const STATUS_FILTERS: FilterDef[] = [
  { id: 'open', label: 'Открытые', kind: 'status' },
  { id: 'waiting', label: 'В ожидании', kind: 'status' },
  { id: 'in_progress', label: 'В работе', kind: 'status' },
  { id: 'resolved', label: 'Решённые', kind: 'status' },
  { id: 'closed', label: 'Закрытые', kind: 'status' },
];

const DEFAULT_VISIBLE: string[] = ['all', 'fresh', 'clients', 'open'];

function matches(table: TableSummary, filter: string, desk: DeskController): boolean {
  if (filter === 'all') return true;
  if (STATUS_FILTERS.some((item) => item.id === filter)) return table.status === filter;
  // Категории (встроенные, свои и ручные привязки) считает useDesk.
  return desk.categoriesOf(table).includes(filter);
}

/** «Название.pdf · PDF» — для подсказки последнего сообщения-файла. */
function fileLabel(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase() : '';
  return ext ? `${name} · ${ext}` : name;
}

export default function TableList({
  desk,
  onSelect,
  onOpen,
  onNewTopic,
}: {
  desk: DeskController;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onNewTopic: () => void;
}) {
  const [query, setQuery] = useState('');
  const [visibleFilters, setVisibleFilters] = useState<string[]>(DEFAULT_VISIBLE);
  const [filter, setFilter] = useState<string>('all');
  const [treeOpen, setTreeOpen] = useState(false);

  // Все фильтры полосы: «Все», категории (встроенные + свои), затем статусы.
  const filterDefs: FilterDef[] = useMemo(
    () => [
      { id: 'all', label: 'Все', kind: 'category' },
      ...CATEGORY_FILTERS,
      ...desk.overlay.customCategories.map((cat): FilterDef => ({
        id: cat.id,
        label: cat.label,
        kind: 'category',
        custom: true,
      })),
      ...STATUS_FILTERS,
    ],
    [desk.overlay.customCategories],
  );

  // «Все» всегда в полосе; удалённые категории из неё выпадают сами.
  const shownFilters: string[] = useMemo(() => {
    const known = new Set(filterDefs.map((item) => item.id));
    return ['all', ...visibleFilters.filter((id) => id !== 'all' && known.has(id))];
  }, [visibleFilters, filterDefs]);

  const activeFilter: string = shownFilters.includes(filter) ? filter : 'all';

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return desk.tables.filter((table) => {
      if (!matches(table, activeFilter, desk)) return false;
      if (!needle) return true;
      return (
        table.title.toLowerCase().includes(needle) ||
        table.last?.text.toLowerCase().includes(needle) ||
        table.last?.author.toLowerCase().includes(needle)
      );
    });
  }, [desk, activeFilter, query]);

  const freshTotal = desk.tables.reduce((sum, t) => sum + desk.freshOf(t), 0);

  const toggleChip = (id: string) => {
    if (id === 'all') return; // «Все» неудаляема
    setVisibleFilters((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id],
    );
  };

  const ensureChip = (id: string) => {
    setVisibleFilters((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  const deleteCategory = (id: string) => {
    desk.removeCustomCategory(id);
    setVisibleFilters((prev) => prev.filter((f) => f !== id));
    if (filter === id) setFilter('all');
  };

  return (
    <section className="panel table-panel" aria-label="Столы переговоров">
      <div className="table-panel__head">
        <div className="table-panel__title">
          {/* Подписи пока нет — только число чатов. */}
          <span className="counter">{desk.tables.length}</span>
          {freshTotal > 0 && (
            <span className="counter counter--accent">
              +{freshTotal} {plural(freshTotal, 'новое', 'новых', 'новых')}
            </span>
          )}
          <button
            type="button"
            className="icon-btn table-panel__new"
            onClick={onNewTopic}
            title="Новая тема — создать чат и добавить людей"
            aria-label="Новая тема"
          >
            <Icon name="plus" size={16} />
          </button>
        </div>

        <label className="search">
          <Icon name="search" size={16} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по столам и сообщениям"
            aria-label="Поиск по столам"
          />
          {query && (
            <button
              type="button"
              className="search__clear"
              onClick={() => setQuery('')}
              aria-label="Очистить поиск"
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </label>

        <div className="filters" role="tablist" aria-label="Выборка столов">
          <button
            type="button"
            className={`filter filter--menu ${treeOpen ? 'is-active' : ''}`}
            onClick={() => setTreeOpen(true)}
            title="Дерево: чаты, категории и статусы"
            aria-label="Дерево чатов, категорий и статусов"
          >
            <Icon name="tree" size={15} />
          </button>

          {filterDefs
            .filter((item) => shownFilters.includes(item.id))
            .map((item) => (
              <span key={item.id} className={`filter-chip ${activeFilter === item.id ? 'is-active' : ''}`}>
                <button
                  type="button"
                  className="filter-chip__label"
                  role="tab"
                  aria-selected={activeFilter === item.id}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                </button>
                {item.id !== 'all' && (
                  <button
                    type="button"
                    className="filter-chip__close"
                    onClick={() => toggleChip(item.id)}
                    aria-label={`Убрать «${item.label}» из выборки`}
                    title="Убрать из выборки"
                  >
                    <Icon name="close" size={11} />
                  </button>
                )}
              </span>
            ))}
        </div>
      </div>

      <div className="table-list">
        {desk.loading && desk.tables.length === 0 && (
          <div className="list-skeleton" aria-label="Загрузка столов">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="list-skeleton__row">
                <span className="list-skeleton__dot" />
                <span className="list-skeleton__lines">
                  <span style={{ width: `${78 - index * 9}%` }} />
                  <span style={{ width: `${52 + index * 6}%` }} />
                </span>
              </div>
            ))}
          </div>
        )}

        {!desk.loading && visible.length === 0 && (
          <div className="table-list__empty">
            <Icon name="search" size={26} />
            <p>
              {desk.tables.length === 0
                ? 'Столов пока нет. Они появляются из сделок, тендеров и сервисных заявок.'
                : 'Ничего не нашлось. Попробуйте другой запрос или фильтр.'}
            </p>
          </div>
        )}

        {visible.map((table) => {
          const fresh = desk.freshOf(table);
          const signal = desk.signalOf(table);
          const active = table.id === desk.selectedId;
          const pinned = desk.overlay.openWindows.includes(table.id);

          // Последнее сообщение: одна строка с многоточием; полный текст —
          // в подсказке при наведении. Если отправлен файл — его название и тип.
          const lastFiles = table.last?.files ?? [];
          const fileStub = !table.last?.text || table.last.text === 'приложен файл';
          const previewText = table.last
            ? lastFiles.length > 0 && fileStub
              ? lastFiles.join(', ')
              : table.last.text
            : '';
          const previewTitle = table.last
            ? lastFiles.length > 0
              ? `${table.last.author}: ${fileStub ? '' : `${table.last.text} — `}${lastFiles.map(fileLabel).join(', ')}`
              : `${table.last.author}: ${table.last.text}`
            : undefined;

          return (
            <button
              key={table.id}
              type="button"
              className={`table-row ${active ? 'is-active' : ''}`}
              onClick={() => onSelect(table.id)}
              onDoubleClick={() => onOpen(table.id)}
              title="Одинарный клик — посмотреть, двойной — закрепить вверху"
              aria-current={active ? 'true' : undefined}
            >
              <span className="table-row__signal">
                <SignalDot signal={signal} size={11} />
              </span>

              <span className="table-row__body">
                <span className="table-row__top">
                  <span className="table-row__title" title={table.title}>
                    {table.title}
                  </span>
                  {pinned && (
                    <span className="table-row__pin" title="Закреплено вверху">
                      <Icon name="pin" size={11} />
                    </span>
                  )}
                  {table.last && (
                    <time className="table-row__time" dateTime={table.last.createdAt}>
                      {relativeTime(table.last.createdAt)}
                    </time>
                  )}
                </span>

                <span className="table-row__meta">
                  <span className={`status status--${table.status}`}>
                    {statusLabel(table.status)}
                  </span>
                  {desk.overlay.chats[table.id] && (
                    <span className="role-chip">
                      {desk.overlay.chats[table.id].kind === 'private' ? 'личный' : 'тема'}
                    </span>
                  )}
                  <span>{disputeLabel(table.disputeType)}</span>
                  <span className="dot-sep">·</span>
                  <span>{table.participants} уч.</span>
                </span>

                <span className="table-row__preview" title={previewTitle}>
                  {table.last ? (
                    <>
                      <b>{table.last.author}:</b> {previewText}
                    </>
                  ) : (
                    'сообщений пока нет'
                  )}
                </span>
              </span>

              {fresh > 0 && <span className="unread">+{fresh}</span>}
            </button>
          );
        })}
      </div>

      <footer className="table-panel__foot">
        <span className="legend">
          <SignalDot signal="none" /> нет новых
          <SignalDot signal="team" /> свои и партнёры
          <SignalDot signal="client" /> клиенты
        </span>
      </footer>

      {treeOpen && (
        <ChatsTreeWindow
          desk={desk}
          categories={filterDefs.filter((item) => item.kind === 'category')}
          statuses={STATUS_FILTERS}
          shownFilters={shownFilters}
          onToggleFilter={toggleChip}
          onEnsureFilter={ensureChip}
          onDeleteCategory={deleteCategory}
          onClose={() => setTreeOpen(false)}
        />
      )}
    </section>
  );
}
