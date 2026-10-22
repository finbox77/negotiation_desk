// components/TableList.tsx — левый рельс: поиск, выборка и окна стола.
//
// Одинарный клик — предпросмотр окна в центре (без закрепления), двойной —
// закрепить в мини-шапке (новые закрепления появляются там слева). Выборка
// фильтров: «≡» перед «Все» — список всех фильтров, чипсы прокручиваются и
// убираются крестиками.

import { useMemo, useState } from 'react';
import { disputeLabel, statusLabel } from '../desk/labels';
import { plural, relativeTime } from '../desk/format';
import type { DeskController } from '../desk/useDesk';
import type { TableSummary } from '../desk/types';
import { Icon, SignalDot } from './Icons';

type Filter =
  | 'all'
  | 'fresh'
  | 'mine'
  | 'clients'
  | 'partners'
  | 'open'
  | 'waiting'
  | 'in_progress'
  | 'resolved'
  | 'closed';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'fresh', label: 'Новые' },
  { id: 'mine', label: 'Созданные мной' },
  { id: 'clients', label: 'Клиенты' },
  { id: 'partners', label: 'Партнёры' },
  { id: 'open', label: 'Открытые' },
  { id: 'waiting', label: 'В ожидании' },
  { id: 'in_progress', label: 'В работе' },
  { id: 'resolved', label: 'Решённые' },
  { id: 'closed', label: 'Закрытые' },
];

const DEFAULT_VISIBLE: Filter[] = ['all', 'fresh', 'clients', 'open'];

function matches(table: TableSummary, filter: Filter, desk: DeskController): boolean {
  switch (filter) {
    case 'fresh':
      return desk.freshOf(table) > 0;
    case 'mine':
      return table.initiatorUserId != null && table.initiatorUserId === desk.viewer?.id;
    case 'clients':
      return desk.signalOf(table) === 'client';
    case 'partners':
      return desk.signalOf(table) === 'team';
    case 'open':
    case 'waiting':
    case 'in_progress':
    case 'resolved':
    case 'closed':
      return table.status === filter;
    default:
      return true;
  }
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
  const [visibleFilters, setVisibleFilters] = useState<Filter[]>(DEFAULT_VISIBLE);
  const [filter, setFilter] = useState<Filter>('all');
  const [menuOpen, setMenuOpen] = useState(false);

  const activeFilter: Filter = visibleFilters.includes(filter)
    ? filter
    : (visibleFilters[0] ?? 'all');

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

  const toggleChip = (id: Filter) => {
    setVisibleFilters((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((f) => f !== id);
        return next.length > 0 ? next : ['all'];
      }
      return [...prev, id];
    });
  };

  return (
    <section className="panel table-panel" aria-label="Столы переговоров">
      <div className="table-panel__head">
        <div className="table-panel__title">
          <h2>Столы</h2>
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
          <div className="filters__menu-wrap">
            <button
              type="button"
              className={`filter filter--menu ${menuOpen ? 'is-active' : ''}`}
              onClick={() => setMenuOpen((prev) => !prev)}
              title="Настроить выборку"
              aria-label="Настроить выборку"
            >
              <span className="hamburger" aria-hidden>
                <i />
                <i />
                <i />
              </span>
            </button>

            {menuOpen && (
              <>
                <button
                  type="button"
                  className="roll-backdrop"
                  aria-label="Закрыть меню"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="filters-menu" role="menu" aria-label="Выборки">
                  <p className="tabs-roll__title">Выборка чатов</p>
                  {FILTERS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`filters-menu__item ${visibleFilters.includes(item.id) ? 'is-on' : ''}`}
                      role="menuitemcheckbox"
                      aria-checked={visibleFilters.includes(item.id)}
                      onClick={() => toggleChip(item.id)}
                    >
                      <span className="filters-menu__check">
                        {visibleFilters.includes(item.id) && <Icon name="check" size={11} />}
                      </span>
                      {item.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {FILTERS.filter((item) => visibleFilters.includes(item.id)).map((item) => (
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
              <button
                type="button"
                className="filter-chip__close"
                onClick={() => toggleChip(item.id)}
                aria-label={`Убрать «${item.label}» из выборки`}
                title="Убрать из выборки"
              >
                <Icon name="close" size={11} />
              </button>
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

                <span className="table-row__preview">
                  {table.last ? (
                    <>
                      <b>{table.last.author}:</b> {table.last.text}
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
    </section>
  );
}
