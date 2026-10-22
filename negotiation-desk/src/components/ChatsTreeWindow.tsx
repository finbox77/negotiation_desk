// components/ChatsTreeWindow.tsx — независимое плавающее окно «Дерево чатов»:
// слева все чаты, справа категории и статусы.
//
// Подсветка связей: выбор чата подсвечивает его категории и статус справа;
// выбор категории/статуса подсвечивает чаты слева. Каждый новый выбор
// автоматически снимает предыдущий. Галочки у категорий и статусов — это
// одновременно «показать в полосе выборки слева» и суммарная подсветка:
// несколько галочек подсвечивают объединение их чатов. «Все» неудаляема
// и всегда в полосе.
//
// Свои категории («виртуальные папки») создаются тут же по имени; чат можно
// вручную отнести к нескольким категориям — список категоризации открывается
// под выбранным чатом. Встроенные категории, в которые чат попадает сам
// (новые, клиенты…), помечены «авто».

import { useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { plural } from '../desk/format';
import { statusLabel } from '../desk/labels';
import type { TableSummary } from '../desk/types';
import type { DeskController } from '../desk/useDesk';
import { Icon, SignalDot } from './Icons';
import type { FilterDef } from './TableList';

type GroupSelection = { kind: 'category' | 'status'; id: string } | null;

export default function ChatsTreeWindow({
  desk,
  categories,
  statuses,
  shownFilters,
  onToggleFilter,
  onEnsureFilter,
  onDeleteCategory,
  onClose,
}: {
  desk: DeskController;
  categories: FilterDef[];
  statuses: FilterDef[];
  /** Что сейчас видно в полосе выборки слева (галочки). */
  shownFilters: string[];
  onToggleFilter: (id: string) => void;
  onEnsureFilter: (id: string) => void;
  onDeleteCategory: (id: string) => void;
  onClose: () => void;
}) {
  const [selChat, setSelChat] = useState<string | null>(null);
  const [selGroup, setSelGroup] = useState<GroupSelection>(null);
  // Источник подсветки: один за раз, чтобы не путаться.
  const [source, setSource] = useState<'chat' | 'group' | 'checked'>('checked');
  const [newLabel, setNewLabel] = useState('');
  const [pos, setPos] = useState(() => ({
    x: Math.max(16, Math.round((window.innerWidth - 680) / 2)),
    y: 88,
  }));
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  // Окно можно перетаскивать за шапку (как дерево участников).
  const onHeaderDown = (event: ReactMouseEvent) => {
    if ((event.target as HTMLElement).closest('button')) return;
    dragRef.current = { dx: event.clientX - pos.x, dy: event.clientY - pos.y };
    const onMove = (move: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({
        x: Math.min(Math.max(8, move.clientX - dragRef.current.dx), window.innerWidth - 220),
        y: Math.min(Math.max(8, move.clientY - dragRef.current.dy), window.innerHeight - 80),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const belongs = (table: TableSummary, group: { kind: string; id: string }): boolean => {
    if (group.id === 'all') return true;
    if (group.kind === 'status') return table.status === group.id;
    return desk.categoriesOf(table).includes(group.id);
  };

  /** Чаты, подсвеченные справа: одиночный выбор или сумма галочек. */
  const litChats = useMemo(() => {
    const lit = new Set<string>();
    if (source === 'group' && selGroup) {
      for (const table of desk.tables) if (belongs(table, selGroup)) lit.add(table.id);
    } else if (source === 'checked') {
      const groups: Array<{ kind: string; id: string }> = [
        ...categories,
        ...statuses,
      ].filter((item) => item.id !== 'all' && shownFilters.includes(item.id));
      for (const table of desk.tables) {
        if (groups.some((group) => belongs(table, group))) lit.add(table.id);
      }
    }
    return lit;
    // belongs использует categoriesOf из desk — объект обновляется каждый рендер.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk, source, selGroup, shownFilters, categories, statuses]);

  const selectedTable = desk.tables.find((t) => t.id === selChat) ?? null;

  const pickChat = (id: string) => {
    // Новый выбор снимает предыдущий.
    setSelGroup(null);
    setSource('chat');
    setSelChat(selChat === id ? null : id);
  };

  const pickGroup = (kind: 'category' | 'status', id: string) => {
    setSelChat(null);
    setSource('group');
    setSelGroup(selGroup?.kind === kind && selGroup?.id === id ? null : { kind, id });
  };

  const toggleChecked = (id: string) => {
    if (id === 'all') return;
    // Галочки становятся текущим источником суммарной подсветки.
    setSelChat(null);
    setSelGroup(null);
    setSource('checked');
    onToggleFilter(id);
  };

  const createCategory = () => {
    const id = desk.addCustomCategory(newLabel);
    if (!id) return;
    setNewLabel('');
    onEnsureFilter(id);
  };

  const countOf = (group: { kind: string; id: string }) =>
    desk.tables.filter((table) => belongs(table, group)).length;

  const renderGroup = (item: FilterDef) => {
    const checked = shownFilters.includes(item.id);
    const selected = selGroup?.kind === item.kind && selGroup?.id === item.id;
    const lit =
      source === 'chat' && selectedTable != null && belongs(selectedTable, item);
    return (
      <div
        key={`${item.kind}-${item.id}`}
        className={`cat-row ${selected ? 'is-selected' : ''} ${lit ? 'is-lit' : ''}`}
      >
        <button
          type="button"
          className={`tree-bind__box cat-row__check ${checked ? 'is-on' : ''}`}
          onClick={() => toggleChecked(item.id)}
          disabled={item.id === 'all'}
          title={
            item.id === 'all'
              ? '«Все» всегда в полосе выборки'
              : 'Показать в полосе выборки слева'
          }
          aria-label={`Галочка «${item.label}»`}
          aria-checked={checked}
          role="checkbox"
        >
          {checked && <Icon name="check" size={11} />}
        </button>
        <button
          type="button"
          className="cat-row__pick"
          onClick={() => pickGroup(item.kind, item.id)}
          title="Подсветить чаты этой группы"
        >
          <span className="tree-row__name">{item.label}</span>
        </button>
        <span className="tree-row__meta">{countOf(item)}</span>
        {item.custom && (
          <button
            type="button"
            className="cat-row__del"
            onClick={() => onDeleteCategory(item.id)}
            title={`Удалить категорию «${item.label}»`}
            aria-label={`Удалить категорию «${item.label}»`}
          >
            <Icon name="trash" size={12} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      className="tree-window"
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-label="Дерево чатов, категорий и статусов"
    >
      <header className="tree-window__head" onMouseDown={onHeaderDown}>
        <Icon name="tree" size={15} />
        <h3>Чаты, категории и статусы</h3>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
          <Icon name="close" />
        </button>
      </header>

      <div className="tree-window__body tree-window__body--split cats-split">
        {/* ЛЕВО: все чаты */}
        <section className="tree-col">
          <h4 className="tree-section__title">
            <Icon name="link" size={12} />
            Чаты
            <span className="side-card__count">{desk.tables.length}</span>
          </h4>
          <ul className="tree-rows">
            {desk.tables.map((table) => {
              const isSel = selChat === table.id;
              return (
                <li key={table.id} className="tree-user-li">
                  <button
                    type="button"
                    className={`tree-row ${isSel ? 'is-selected' : ''} ${litChats.has(table.id) ? 'is-lit' : ''}`}
                    onClick={() => pickChat(table.id)}
                    onDoubleClick={() => {
                      desk.openWindow(table.id);
                      onClose();
                    }}
                    title={`${table.title} — клик подсвечивает категории справа, двойной открывает чат`}
                  >
                    <SignalDot signal={desk.signalOf(table)} size={9} />
                    <span className="tree-row__name">{table.title}</span>
                    <span className="tree-row__meta">
                      {statusLabel(table.status)} · {table.participants}{' '}
                      {plural(table.participants, 'уч.', 'уч.', 'уч.')}
                    </span>
                  </button>

                  {isSel && (
                    <ul className="tree-bind" aria-label="Категории выбранного чата">
                      {categories
                        .filter((cat) => cat.id !== 'all')
                        .map((cat) => {
                          const auto = desk.builtinCategoriesOf(table).includes(cat.id);
                          const manual = (
                            desk.overlay.chatCategories[table.id] ?? []
                          ).includes(cat.id);
                          const on = auto || manual;
                          return (
                            <li key={cat.id}>
                              <button
                                type="button"
                                className={`tree-bind__row ${on ? 'is-on' : ''}`}
                                disabled={auto}
                                onClick={() => desk.setChatCategory(table.id, cat.id, !manual)}
                                title={
                                  auto
                                    ? 'Чат попадает сюда автоматически'
                                    : on
                                      ? 'Убрать чат из категории'
                                      : 'Добавить чат в категорию'
                                }
                              >
                                <span className="tree-bind__box">
                                  {on && <Icon name="check" size={11} />}
                                </span>
                                <span className="tree-row__name">{cat.label}</span>
                                {auto && <span className="tree-row__meta">авто</span>}
                              </button>
                            </li>
                          );
                        })}
                    </ul>
                  )}
                </li>
              );
            })}
            {desk.tables.length === 0 && <li className="tree-note">Чатов пока нет</li>}
          </ul>
        </section>

        {/* ПРАВО: категории и статусы */}
        <section className="tree-col cats-col">
          <div className="cats-scroll">
            <h4 className="tree-section__title">
              <Icon name="tree" size={12} />
              Категории
            </h4>
            <div className="cat-rows">{categories.map(renderGroup)}</div>

            <div className="cats-add">
              <input
                type="text"
                value={newLabel}
                onChange={(event) => setNewLabel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') createCategory();
                }}
                placeholder="Новая категория (папка)"
                aria-label="Название новой категории"
              />
              <button
                type="button"
                className="btn btn--small"
                onClick={createCategory}
                disabled={!newLabel.trim()}
              >
                Добавить
              </button>
            </div>

            <h4 className="tree-section__title cats-status-title">
              <Icon name="check" size={12} />
              Статусы
            </h4>
            <div className="cat-rows">{statuses.map(renderGroup)}</div>

            <p className="tree-note cats-note">
              Галочка показывает группу в полосе слева и подсвечивает её чаты (несколько
              галочек — суммарно). Клик по имени — подсветка одной группы, клик по чату —
              его категорий и статуса. Категории выбранного чата меняются списком под ним.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
