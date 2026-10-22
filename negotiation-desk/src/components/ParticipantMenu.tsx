// components/ParticipantMenu.tsx — контекстное меню участника (клик по кружку)
// и диалог очистки его истории.
//
// Пункты: написать (личное окно чата), подсветить сообщения, счётчик
// сообщений, очистка истории с выбором числа последних сообщений и удаление
// участника из активного окна.

import { useEffect, useRef, useState } from 'react';
import { plural } from '../desk/format';
import type { DeskController } from '../desk/useDesk';
import { Icon } from './Icons';

export default function ParticipantMenu({
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
  const [clearOpen, setClearOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const user = desk.userById.get(userId);
  const name = user?.name ?? 'участник';
  const windowKey = desk.selectedId;
  const count = windowKey ? desk.countOf(windowKey, userId) : 0;

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (clearOpen) setClearOpen(false);
        else onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, clearOpen]);

  const menuLeft = Math.min(x, window.innerWidth - 250);
  const menuTop = Math.min(y, window.innerHeight - 240);

  return (
    <>
      <div
        ref={ref}
        className="ctx-menu"
        style={{ left: menuLeft, top: menuTop }}
        role="menu"
        aria-label={`Действия: ${name}`}
      >
        <p className="ctx-menu__title">{name}</p>

        <button
          type="button"
          className="ctx-menu__item"
          role="menuitem"
          onClick={() => {
            desk.createLocalChat({
              kind: 'private',
              title: name,
              peerId: userId,
              participantIds: [desk.viewer?.id ?? 'u-unknown', userId],
            });
            onClose();
          }}
        >
          <Icon name="write" size={14} />
          Написать
          <span className="ctx-menu__hint">новое окно чата</span>
        </button>

        <button
          type="button"
          className="ctx-menu__item"
          role="menuitem"
          onClick={() => {
            desk.setHighlightUserId(userId);
            onClose();
          }}
        >
          <Icon name="highlight" size={14} />
          Подсветить сообщения
        </button>

        <p className="ctx-menu__info">
          <Icon name="info" size={13} />
          Сообщений в окне: <b>{count}</b>
        </p>

        <button
          type="button"
          className="ctx-menu__item"
          role="menuitem"
          disabled={count === 0}
          onClick={() => setClearOpen(true)}
        >
          <Icon name="eraser" size={14} />
          Очистить историю…
        </button>

        <button
          type="button"
          className="ctx-menu__item ctx-menu__item--danger"
          role="menuitem"
          onClick={() => {
            if (windowKey) desk.unbindParticipant(windowKey, userId);
            onClose();
          }}
        >
          <Icon name="trash" size={14} />
          Удалить из чата
        </button>
      </div>

      {clearOpen && (
        <ClearHistoryDialog
          desk={desk}
          userId={userId}
          onClose={() => {
            setClearOpen(false);
            onClose();
          }}
        />
      )}
    </>
  );
}

function ClearHistoryDialog({
  desk,
  userId,
  onClose,
}: {
  desk: DeskController;
  userId: string;
  onClose: () => void;
}) {
  const user = desk.userById.get(userId);
  const name = user?.name ?? 'участника';
  const total = desk.selectedId ? desk.countOf(desk.selectedId, userId) : 0;
  const [count, setCount] = useState(total);

  const submit = () => {
    const n = Math.max(1, Math.min(total, Math.floor(count) || total));
    desk.clearParticipantMessages(userId, n);
    onClose();
  };

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal modal--small" role="dialog" aria-label="Очистить историю участника">
        <div className="modal__head">
          <div>
            <h2>Очистить историю</h2>
            <p>
              {name} · {total} {plural(total, 'сообщение', 'сообщения', 'сообщений')} в окне
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <Icon name="close" />
          </button>
        </div>

        <div className="modal__body">
          <label className="field">
            <span className="field__label">
              Сколько последних сообщений удалить? (начиная от последнего)
            </span>
            <input
              type="number"
              min={1}
              max={total}
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
              }}
              autoFocus
            />
          </label>
          <p className="settings-note">
            <Icon name="info" size={13} />
            <span>
              Можно удалить часть переписки: укажите число от 1 до {total}, и будут стёрты только
              последние сообщения участника.
            </span>
          </p>
        </div>

        <div className="modal__foot">
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="btn btn--primary" onClick={submit}>
            Удалить
          </button>
        </div>
      </div>
    </div>
  );
}
