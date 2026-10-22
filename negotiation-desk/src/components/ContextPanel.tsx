// components/ContextPanel.tsx — правая колонка: кто смотрит, участники, контекст.
//
// У каждого участника видны уровень допуска и статус-ободок вокруг аватара
// (зелёный — в столе или пишет, серый — не в столе). Клик по кружку —
// контекстное меню; клик по имени — внизу раскрываются окна участника и
// переданные ему файлы. Кнопка «Дерево участников» открывает плавающее окно
// со связями «участники ↔ окна».

import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { dayLabel, money, plural } from '../desk/format';
import {
  CLEARANCE_LABEL,
  DEAL_STATUS_LABEL,
  DEAL_TYPE_LABEL,
  disputeLabel,
  roleLabel,
} from '../desk/labels';
import type { Participant } from '../desk/types';
import type { DeskController } from '../desk/useDesk';
import Avatar from './Avatar';
import { Icon } from './Icons';
import ParticipantMenu from './ParticipantMenu';

export default function ContextPanel({
  desk,
  onOpenTree,
}: {
  desk: DeskController;
  onOpenTree: () => void;
}) {
  const { viewer, card, selectedTable, settings, selectedUserId, ensureMessagesIndex } = desk;
  const [menu, setMenu] = useState<{ userId: string; x: number; y: number } | null>(null);
  /** Двойной клик по участнику — перенести его в другой чат. */
  const [transfer, setTransfer] = useState<{ userId: string; x: number; y: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const selectedUser = selectedUserId ? desk.userById.get(selectedUserId) : null;

  useEffect(() => {
    if (selectedUserId) {
      setPanelOpen(true);
      ensureMessagesIndex();
    }
  }, [selectedUserId, ensureMessagesIndex]);

  return (
    <aside className="context" aria-label="Контекст стола">
      <div className="side-card viewer-card">
        <Avatar name={viewer?.name ?? 'Гость'} size={42} presence="in" />
        <div className="viewer-card__text">
          <p className="viewer-card__name">{viewer?.name ?? 'Гость'}</p>
          <p className="viewer-card__role">
            {viewer?.roleLabel ?? 'сессия сайта'}
            {viewer?.companyName ? ` · ${viewer.companyName}` : ''}
          </p>
        </div>
        <span
          className="clearance-badge"
          title={`Допуск ${viewer?.clearanceLevel ?? 3}: ${CLEARANCE_LABEL[viewer?.clearanceLevel ?? 3]}`}
        >
          <Icon name="lock" size={11} />
          {viewer?.clearanceLevel ?? 3}
        </span>
      </div>

      {selectedTable && card ? (
        <>
          <div className="side-card">
            <h3 className="side-card__title">
              <Icon name="users" size={14} />
              Участники
              <span className="side-card__count">{card.participants.length}</span>
              <button
                type="button"
                className="side-card__action"
                onClick={onOpenTree}
                title="Дерево участников и окон"
              >
                <Icon name="tree" size={13} />
                Дерево
              </button>
            </h3>
            <ul className="participants">
              {card.participants.map((person: Participant) => {
                const lastMessage = desk.messages[desk.messages.length - 1];
                const writing =
                  lastMessage?.sender === person.userId &&
                  Date.now() - Date.parse(lastMessage.createdAt) < 20_000;
                return (
                <li
                  key={person.userId}
                  className={`participant ${desk.selectedUserId === person.userId ? 'is-selected' : ''}`}
                  draggable
                  onDragStart={(event: DragEvent) => {
                    event.dataTransfer.setData('application/x-desk-user', person.userId);
                    event.dataTransfer.setData('text/plain', person.userId);
                    event.dataTransfer.effectAllowed = 'link';
                  }}
                  onDoubleClick={(event) => {
                    setMenu(null);
                    ensureMessagesIndex();
                    setTransfer({ userId: person.userId, x: event.clientX, y: event.clientY });
                  }}
                  title="Двойной клик — перенести в другой чат"
                >
                  <button
                    type="button"
                    className="participant__avatar-btn"
                    title={`${person.name} — действия`}
                    onClick={(event) =>
                      setMenu({ userId: person.userId, x: event.clientX, y: event.clientY })
                    }
                  >
                    <Avatar
                      name={person.name}
                      size={30}
                      presence={person.present ? 'in' : 'out'}
                      typing={writing}
                    />
                  </button>

                  <span className="participant__text">
                    <button
                      type="button"
                      className="participant__name"
                      onClick={() =>
                        desk.setSelectedUserId(
                          desk.selectedUserId === person.userId ? null : person.userId,
                        )
                      }
                      title="Показать окна и файлы участника"
                    >
                      {person.name}
                      {person.userId === viewer?.id && <em> · вы</em>}
                    </button>
                    <span className="participant__company">
                      {person.companyName ?? 'без компании'}
                    </span>
                  </span>

                  <span
                    className="clearance-badge"
                    title={`Допуск ${person.clearanceLevel}: ${CLEARANCE_LABEL[person.clearanceLevel] ?? 'участник'}`}
                  >
                    <Icon name="lock" size={10} />
                    {person.clearanceLevel}
                  </span>
                  <span className={`role-chip ${person.isInitiator ? 'is-initiator' : ''}`}>
                    {roleLabel(person.role)}
                  </span>
                </li>
                );
              })}
            </ul>
          </div>

          {selectedUser && (
            <div className="side-card">
              <h3 className="side-card__title">
                <Icon name="link" size={14} />
                Окна участника
                <button
                  type="button"
                  className="side-card__action"
                  onClick={() => setPanelOpen((prev) => !prev)}
                  title={panelOpen ? 'Скрыть' : 'Показать'}
                >
                  <Icon name={panelOpen ? 'chevron-down' : 'chevron'} size={12} />
                  {panelOpen ? 'Скрыть' : 'Показать'}
                </button>
                {/* Крестика нет: карточка сама скрывается, если отжать участника. */}
              </h3>

              {panelOpen && (
                <MemberWindows desk={desk} userId={selectedUser.id} />
              )}
            </div>
          )}

          <div className="side-card side-card--save">
            <h3 className="side-card__title">
              <Icon name="download" size={14} />
              Сохранить чат
            </h3>
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={() => void desk.saveChatToWord()}
            >
              <Icon name="file" size={14} />
              В документ Word
            </button>
            <p className="side-note">
              Тема, участники, переписка, время и вес — файлом на устройство. Папка файлов чата —
              до 10 МБ.
            </p>
          </div>

          <div className="side-card">
            <h3 className="side-card__title">
              <Icon name="link" size={14} />
              Контекст
            </h3>
            <dl className="context-list">
              {card.context.product && (
                <div>
                  <dt>Продукт</dt>
                  <dd>{card.context.product.title}</dd>
                </div>
              )}
              {card.context.environment && (
                <div>
                  <dt>Объект</dt>
                  <dd>{card.context.environment.name}</dd>
                </div>
              )}
              {card.context.deal && (
                <div>
                  <dt>Сделка</dt>
                  <dd>
                    {DEAL_TYPE_LABEL[card.context.deal.dealType] ?? card.context.deal.dealType}
                    {' · '}
                    {DEAL_STATUS_LABEL[card.context.deal.status] ?? card.context.deal.status}
                    <span className="context-list__amount">
                      {money(card.context.deal.totalAmount)}
                    </span>
                  </dd>
                </div>
              )}
              <div>
                <dt>Тип спора</dt>
                <dd>{disputeLabel(card.table.disputeType)}</dd>
              </div>
              <div>
                <dt>Открыт</dt>
                <dd>{dayLabel(card.table.createdAt)}</dd>
              </div>
            </dl>
          </div>
        </>
      ) : (
        <div className="side-card">
          <h3 className="side-card__title">
            <Icon name="spark" size={14} />
            Как устроен стол
            <button
              type="button"
              className="side-card__action"
              onClick={onOpenTree}
              title="Дерево участников и окон"
            >
              <Icon name="tree" size={13} />
              Дерево
            </button>
          </h3>
          <ul className="side-hints">
            <li>Стол — это окно по сделке, тендеру или заявке. Окон может быть несколько.</li>
            <li>Сообщение с допуском 1 увидят только руководители, с допуском 3 — все.</li>
            <li>Документы, звонки и системные события живут в той же ленте.</li>
          </ul>
          <p className="side-note">
            Выберите окно слева, чтобы увидеть участников и контекст.
          </p>
        </div>
      )}

      <div className="side-card side-card--mode">
        <h3 className="side-card__title">
          <Icon name="plug" size={14} />
          {settings.mode === 'demo' ? 'Демо-режим' : 'Подключено к сайту'}
        </h3>
        <p className="side-note">
          {settings.mode === 'demo'
            ? 'Данные живут в браузере: можно писать, менять допуск и работать с окнами. Бэкенд не нужен.'
            : 'Стол читает и пишет в базу основного сайта через /api/v1/negotiations.'}
        </p>
        <a className="side-link" href={settings.siteUrl} target="_blank" rel="noreferrer">
          Открыть Simonix <Icon name="chevron" size={13} />
        </a>
      </div>

      {menu && (
        <ParticipantMenu
          desk={desk}
          userId={menu.userId}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}

      {transfer && (
        <TransferMenu
          desk={desk}
          userId={transfer.userId}
          x={transfer.x}
          y={transfer.y}
          onClose={() => setTransfer(null)}
        />
      )}
    </aside>
  );
}

/**
 * Перенос участника в другой чат по двойному клику: список чатов
 * (сначала открытые в центральном окне), выбор привязывает участника —
 * он появится в списке участников того чата.
 */
function TransferMenu({
  desk,
  userId,
  x,
  y,
  onClose,
}: {
  desk: DeskController;
  userId: string;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const name = desk.userById.get(userId)?.name ?? 'участник';

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const openIds = desk.windows.map((w) => w.id);
  const targets = desk.tables
    .filter((table) => table.id !== desk.selectedId)
    .sort((a, b) => Number(openIds.includes(b.id)) - Number(openIds.includes(a.id)));

  return (
    <div
      ref={ref}
      className="ctx-menu ctx-menu--transfer"
      style={{ left: Math.min(x, window.innerWidth - 290), top: Math.min(y, window.innerHeight - 340) }}
      role="menu"
      aria-label={`Перенести: ${name}`}
    >
      <p className="ctx-menu__title">Перенести «{name}» в чат:</p>
      <div className="ctx-menu__scroll">
        {targets.map((table) => {
          const already = desk.usersOfWindow(table.id).includes(userId);
          const isOpen = openIds.includes(table.id);
          return (
            <button
              key={table.id}
              type="button"
              className="ctx-menu__item"
              role="menuitem"
              disabled={already}
              title={table.title}
              onClick={() => {
                desk.bindParticipant(table.id, userId);
                onClose();
              }}
            >
              <span className={`chat-tab__dot ${desk.freshOf(table) > 0 ? 'is-unread' : ''}`} />
              <span className="ctx-menu__grow">{table.title}</span>
              <span className="ctx-menu__hint">
                {already ? 'уже в чате' : isOpen ? 'открыт в центре' : ''}
              </span>
            </button>
          );
        })}
        {targets.length === 0 && <p className="tree-note">Других чатов пока нет</p>}
      </div>
    </div>
  );
}

/** Окна участника и переданные в них файлы (сворачивается). */
function MemberWindows({ desk, userId }: { desk: DeskController; userId: string }) {
  const windows = desk.windowsOfUser(userId);

  if (desk.indexLoading && windows.length === 0) {
    return <p className="tree-note">Показываем окна участника…</p>;
  }

  return (
    <ul className="member-windows">
      {windows.map((window) => {
        const files = desk.filesToUser(window.id);
        const count = desk.countOf(window.id, userId);
        return (
          <li key={window.id} className="member-window">
            <button
              type="button"
              className="member-window__title"
              onClick={() => desk.openWindow(window.id)}
              title="Открыть окно"
            >
              <span className={`chat-tab__dot ${desk.freshOf(window) > 0 ? 'is-unread' : ''}`} />
              {window.title}
              <em>
                {' '}
                · {count} {plural(count, 'сообщение', 'сообщения', 'сообщений')}
              </em>
            </button>
            {files.length > 0 ? (
              <ul className="member-window__files">
                {files.map((file, index) => (
                  <li key={`${file}-${index}`} className="file-chip" title={file}>
                    <span className="file-chip__icon">
                      <Icon name="file" size={13} />
                    </span>
                    <span className="file-chip__name">{file}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="member-window__empty">файлов не передавали</p>
            )}
          </li>
        );
      })}
      {windows.length === 0 && (
        <li className="tree-note">Участник пока не привязан ни к одному окну</li>
      )}
    </ul>
  );
}
