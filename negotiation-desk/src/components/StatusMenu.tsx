// components/StatusMenu.tsx — «≡» в шапке чата: статус окна и удаление.
//
// Статусы: открыть (по умолчанию), ожидание, в работе, вопрос решён, закрыть
// (в закрытом чате отправка недоступна). Отдельно — «Удалить»: требуется
// пароль; пока пароль по умолчанию «admin» — он введён и виден.

import { useEffect, useRef, useState } from 'react';
import { STATUS_MENU } from '../desk/labels';
import type { NegotiationStatus } from '../desk/types';
import type { DeskController } from '../desk/useDesk';
import { Icon } from './Icons';

const DEFAULT_PASSWORD = 'admin';

export default function StatusMenu({
  desk,
  x,
  y,
  onClose,
}: {
  desk: DeskController;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const [askDelete, setAskDelete] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = desk.selectedTable?.status ?? 'open';

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      // Диалог удаления живёт вне меню: клики по нему не должны закрывать меню
      // на mousedown — иначе диалог размонтируется раньше click и удаление
      // не сработает (так «новые чаты не удалялись»).
      if (askDelete) return;
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (askDelete) setAskDelete(false);
        else onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, askDelete]);

  const menuLeft = Math.min(x, window.innerWidth - 260);
  const menuTop = Math.min(y, window.innerHeight - 320);

  return (
    <>
      <div
        ref={ref}
        className="ctx-menu"
        style={{ left: menuLeft, top: menuTop }}
        role="menu"
        aria-label="Статус чата"
      >
        <p className="ctx-menu__title">Статус чата</p>

        {STATUS_MENU.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`ctx-menu__item ${current === item.id ? 'is-current' : ''}`}
            role="menuitemradio"
            aria-checked={current === item.id}
            onClick={() => {
              desk.setWindowStatus(desk.selectedId ?? '', item.id as NegotiationStatus);
              onClose();
            }}
          >
            {current === item.id ? <Icon name="check" size={14} /> : <span className="ctx-menu__gap" />}
            {item.label}
            <span className="ctx-menu__hint">{item.hint}</span>
          </button>
        ))}

        <div className="ctx-menu__sep" />

        <button
          type="button"
          className="ctx-menu__item ctx-menu__item--danger"
          role="menuitem"
          onClick={() => setAskDelete(true)}
        >
          <Icon name="trash" size={14} />
          Удалить
          <span className="ctx-menu__hint">нужен пароль</span>
        </button>
      </div>

      {askDelete && (
        <DeleteDialog
          desk={desk}
          onCancel={() => {
            setAskDelete(false);
            onClose();
          }}
          onDone={() => {
            setAskDelete(false);
            onClose();
          }}
        />
      )}
    </>
  );
}

function DeleteDialog({
  desk,
  onCancel,
  onDone,
}: {
  desk: DeskController;
  onCancel: () => void;
  onDone: () => void;
}) {
  // Пароль по умолчанию — введён и виден (пока не подключён сервер).
  const [password, setPassword] = useState(DEFAULT_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const title = desk.selectedTable?.title ?? '';

  const submit = () => {
    if (password !== DEFAULT_PASSWORD) {
      setError('Неверный пароль');
      return;
    }
    if (desk.selectedId) desk.deleteWindow(desk.selectedId);
    onDone();
  };

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="modal modal--small" role="dialog" aria-label="Удалить чат">
        <div className="modal__head">
          <div>
            <h2>Удалить чат</h2>
            <p>«{title}» будет удалён без возможности восстановления</p>
          </div>
          <button type="button" className="icon-btn" onClick={onCancel} aria-label="Закрыть">
            <Icon name="close" />
          </button>
        </div>

        <div className="modal__body">
          <label className="field">
            <span className="field__label">Пароль (пока по умолчанию — admin)</span>
            <input
              type="text"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
              }}
              autoFocus
            />
          </label>
          {error && <p className="field__error">{error}</p>}
          <p className="settings-note">
            <Icon name="info" size={13} />
            <span>Пароль виден и заранее введён: серверной проверки пока нет.</span>
          </p>
        </div>

        <div className="modal__foot">
          <button type="button" className="btn" onClick={onCancel}>
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
