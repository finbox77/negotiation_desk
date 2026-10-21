// components/TableList.tsx — левый рельс: поиск, фильтры и окна стола.

import { useMemo, useState } from 'react';
import { disputeLabel, statusLabel } from '../desk/labels';
import { plural, relativeTime } from '../desk/format';
import type { DeskController } from '../desk/useDesk';
import type { TableSummary } from '../desk/types';
import { Icon, SignalDot } from './Icons';

type Filter = 'all' | 'fresh' | 'clients' | 'open';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'fresh', label: 'Новые' },
  { id: 'clients', label: 'Клиенты' },
  { id: 'open', label: 'Открытые' },
];

function matches(table: TableSummary, filter: Filter, desk: DeskController): boolean {
  if (filter === 'fresh') return desk.freshOf(table) > 0;
  if (filter === 'clients') return desk.signalOf(table) === 'client';
  if (filter === 'open') return table.status === 'open' || table.status === 'waiting_platform';
  return true;
}

export default function TableList({
  desk,
  onSelect,
}: {
  desk: DeskController;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return desk.tables.filter((table) => {
      if (!matches(table, filter, desk)) return false;
      if (!needle) return true;
      return (
        table.title.toLowerCase().includes(needle) ||
        table.last?.text.toLowerCase().includes(needle) ||
        table.last?.author.toLowerCase().includes(needle)
      );
    });
  }, [desk, filter, query]);

  const freshTotal = desk.tables.reduce((sum, t) => sum + desk.freshOf(t), 0);

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

        <div className="filters" role="tablist" aria-label="Фильтр столов">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className={`filter ${filter === item.id ? 'is-active' : ''}`}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
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

          return (
            <button
              key={table.id}
              type="button"
              className={`table-row ${active ? 'is-active' : ''}`}
              onClick={() => onSelect(table.id)}
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
