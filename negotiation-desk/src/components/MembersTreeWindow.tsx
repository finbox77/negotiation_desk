// components/MembersTreeWindow.tsx — независимое плавающее окно «Дерево».
//
// Слева — список окон (чатов) стола, справа — общий список участников без
// дублей. Выбор окна подсвечивает его участников, выбор участника — его окна.
// Двойной клик по окну — оказаться на нём в переговорном столе. Список окон
// за участником раскрывается галочкой справа: там привязка к чатам через
// список (перенос убран). Поиск — по именам участников и по тексту в чатах.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { relativeTime, plural } from '../desk/format';
import type { DeskController } from '../desk/useDesk';
import Avatar from './Avatar';
import { Icon } from './Icons';

export default function MembersTreeWindow({
  desk,
  onClose,
}: {
  desk: DeskController;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selChat, setSelChat] = useState<string | null>(null);
  const [selUser, setSelUser] = useState<string | null>(null);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [pos, setPos] = useState(() => ({
    x: Math.max(16, Math.round((window.innerWidth - 640) / 2)),
    y: 88,
  }));
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    desk.ensureMessagesIndex();
  }, [desk]);

  // Окно можно перетаскивать за шапку.
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

  const needle = query.trim().toLowerCase();

  const messageHits = useMemo(() => {
    if (!needle) return [];
    const hits: Array<{
      windowKey: string;
      title: string;
      text: string;
      sender: string;
      at: string;
    }> = [];
    for (const [windowKey, list] of Object.entries(desk.msgIndex)) {
      const title = desk.tables.find((t) => t.id === windowKey)?.title ?? windowKey;
      for (const message of list) {
        if ((message.text ?? '').toLowerCase().includes(needle)) {
          hits.push({
            windowKey,
            title,
            text: message.text ?? '',
            sender: message.senderName,
            at: message.createdAt,
          });
        }
      }
    }
    hits.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return hits.slice(0, 10);
  }, [desk.msgIndex, desk.tables, needle]);

  const users = useMemo(
    () =>
      desk.allUsers.filter(
        (user) =>
          !needle ||
          user.name.toLowerCase().includes(needle) ||
          (user.companyName ?? '').toLowerCase().includes(needle),
      ),
    [desk.allUsers, needle],
  );

  return (
    <div
      className="tree-window"
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-label="Дерево участников и окон"
    >
      <header className="tree-window__head" onMouseDown={onHeaderDown}>
        <Icon name="tree" size={15} />
        <h3>Дерево участников и окон</h3>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
          <Icon name="close" />
        </button>
      </header>

      <div className="tree-window__search">
        <label className="search">
          <Icon name="search" size={15} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по участникам и тексту в чатах"
            aria-label="Поиск по участникам и чатам"
          />
          {query && (
            <button
              type="button"
              className="search__clear"
              onClick={() => setQuery('')}
              aria-label="Очистить поиск"
            >
              <Icon name="close" size={13} />
            </button>
          )}
        </label>
      </div>

      {needle && messageHits.length > 0 && (
        <div className="tree-window__hits">
          <h4 className="tree-section__title">
            <Icon name="search" size={12} />
            Найдено в сообщениях
          </h4>
          <ul className="tree-hits">
            {messageHits.map((hit, index) => (
              <li key={`${hit.windowKey}-${index}`}>
                <button
                  type="button"
                  className="tree-hit"
                  onClick={() => {
                    desk.openWindow(hit.windowKey);
                    onClose();
                  }}
                >
                  <span className="tree-hit__title">{hit.title}</span>
                  <span className="tree-hit__text">
                    <b>{hit.sender}:</b> {hit.text}
                  </span>
                  <time>{relativeTime(hit.at)}</time>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="tree-window__body tree-window__body--split">
        {/* ЛЕВО: окна */}
        <section className="tree-col">
          <h4 className="tree-section__title">
            <Icon name="link" size={12} />
            Окна
            <span className="side-card__count">{desk.tables.length}</span>
          </h4>
          <ul className="tree-rows">
            {desk.tables.map((window) => {
              const lit = selUser !== null && desk.windowsOfUser(selUser).some((w) => w.id === window.id);
              return (
                <li key={window.id}>
                  <button
                    type="button"
                    className={`tree-row ${selChat === window.id ? 'is-selected' : ''} ${lit ? 'is-lit' : ''}`}
                    onClick={() => setSelChat(selChat === window.id ? null : window.id)}
                    onDoubleClick={() => {
                      desk.openWindow(window.id);
                      onClose();
                    }}
                    title={`${window.title} — двойной клик, чтобы открыть на столе`}
                  >
                    <span className={`chat-tab__dot ${desk.freshOf(window) > 0 ? 'is-unread' : ''}`} />
                    <span className="tree-row__name">{window.title}</span>
                    <span className="tree-row__meta">
                      {window.participants} {plural(window.participants, 'уч.', 'уч.', 'уч.')}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ПРАВО: участники */}
        <section className="tree-col">
          <h4 className="tree-section__title">
            <Icon name="users" size={12} />
            Участники стола
            <span className="side-card__count">{users.length}</span>
          </h4>
          <ul className="tree-rows">
            {users.map((user) => {
              const windows = desk.windowsOfUser(user.id);
              const lit =
                selChat !== null && desk.usersOfWindow(selChat).includes(user.id);
              const open = expandedUser === user.id;
              return (
                <li key={user.id} className="tree-user-li">
                  <div
                    className={`tree-row tree-row--user ${selUser === user.id ? 'is-selected' : ''} ${lit ? 'is-lit' : ''}`}
                  >
                    <button
                      type="button"
                      className="tree-row__pick"
                      onClick={() => setSelUser(selUser === user.id ? null : user.id)}
                      title="Показать окна участника"
                    >
                      <Avatar name={user.name} size={24} presence={user.present ? 'in' : 'out'} />
                      <span className="tree-row__name">
                        {user.name}
                        <em> · допуск {user.clearanceLevel}</em>
                      </span>
                    </button>
                    <span className="tree-row__meta">
                      {windows.length} {plural(windows.length, 'окно', 'окна', 'окон')}
                    </span>
                    <button
                      type="button"
                      className={`tree-row__check ${open ? 'is-open' : ''}`}
                      onClick={() => setExpandedUser(open ? null : user.id)}
                      title="Список чатов участника"
                      aria-label="Список чатов участника"
                    >
                      <Icon name="check" size={12} />
                    </button>
                  </div>

                  {open && (
                    <ul className="tree-bind">
                      {desk.tables.map((window) => {
                        const bound = windows.some((w) => w.id === window.id);
                        return (
                          <li key={window.id}>
                            <button
                              type="button"
                              className={`tree-bind__row ${bound ? 'is-on' : ''}`}
                              onClick={() =>
                                bound
                                  ? desk.unbindParticipant(window.id, user.id)
                                  : desk.bindParticipant(window.id, user.id)
                              }
                              title={bound ? 'Убрать из этого окна' : 'Привязать к этому окну'}
                            >
                              <span className="tree-bind__box">
                                {bound && <Icon name="check" size={11} />}
                              </span>
                              <span className="tree-row__name">{window.title}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
