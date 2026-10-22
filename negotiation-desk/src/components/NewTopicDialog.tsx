// components/NewTopicDialog.tsx — модалка новой темы: название и люди в чате.
//
// Окно-чат уже открыто за модалкой (как и просилось: «открывается чат и это
// модальное окно»), поэтому изменения применяются сразу: правка названия и
// добавление/удаление людей. Кнопка «Готово» просто закрывает модалку.

import { useState } from 'react';
import { plural } from '../desk/format';
import type { DeskController } from '../desk/useDesk';
import Avatar from './Avatar';
import { Icon } from './Icons';

export default function NewTopicDialog({
  desk,
  chatKey,
  onClose,
}: {
  desk: DeskController;
  chatKey: string;
  onClose: () => void;
}) {
  const chat = desk.overlay.chats[chatKey];
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState(chat?.title ?? 'Новая тема');

  if (!chat) return null;

  const members = new Set(chat.participantIds);
  const needle = query.trim().toLowerCase();
  const people = desk.allUsers.filter(
    (user) => !needle || user.name.toLowerCase().includes(needle),
  );

  const toggle = (userId: string) => {
    const next = new Set(members);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    desk.setLocalChatMembers(chatKey, [...next]);
  };

  return (
    <div
      className="overlay"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="modal" role="dialog" aria-label="Новая тема">
        <div className="modal__head">
          <div>
            <h2>Новая тема</h2>
            <p>
              Окно уже открыто — добавьте людей в новый чат. Сейчас:{' '}
              {chat.participantIds.length}{' '}
              {plural(chat.participantIds.length, 'участник', 'участника', 'участников')}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <Icon name="close" />
          </button>
        </div>

        <div className="modal__body">
          <label className="field">
            <span className="field__label">Название темы</span>
            <input
              type="text"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                desk.renameLocalChat(chatKey, event.target.value);
              }}
              placeholder="Например: Лизинг ATLAS-6, вопросы по ТЗ"
              autoFocus
            />
          </label>

          <div>
            <p className="settings-section__title">Люди в новом чате</p>
            <label className="search">
              <Icon name="search" size={15} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Найти участника"
                aria-label="Найти участника"
              />
            </label>

            <ul className="people-pick">
              {people.map((user) => {
                const checked = members.has(user.id);
                return (
                  <li key={user.id}>
                    <button
                      type="button"
                      className={`people-pick__row ${checked ? 'is-checked' : ''}`}
                      onClick={() => toggle(user.id)}
                      aria-pressed={checked}
                    >
                      <Avatar name={user.name} size={26} presence={user.present ? 'in' : 'out'} />
                      <span className="people-pick__text">
                        <span className="people-pick__name">{user.name}</span>
                        <span className="people-pick__meta">
                          {user.companyName ?? 'без компании'} · допуск {user.clearanceLevel}
                        </span>
                      </span>
                      <span className="choice__check" hidden={!checked}>
                        <Icon name="check" size={12} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="modal__foot">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}
