// components/ChatTabs.tsx — мини-шапка: закреплённые окна стола вкладками.
//
// Порядок: новые закрепления слева, старые сдвигаются направо. Непрочитанное
// окно помечено зелёным полым кружком. При наведении — подсказка полного
// названия (фиксированная, чтобы строка вкладок не «гуляла»). С краю — «≡»:
// рулетка всех закреплённых окон со скроллом и подсказками. На вкладку можно
// уронить участника — он будет привязан к этому окну.

import { useState } from 'react';
import type { DragEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { TableSummary } from '../desk/types';
import type { DeskController } from '../desk/useDesk';
import { Icon } from './Icons';

type Tip = { text: string; x: number; y: number } | null;

export default function ChatTabs({
  desk,
  onDropUser,
}: {
  desk: DeskController;
  onDropUser: (windowKey: string, userId: string) => void;
}) {
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [rollOpen, setRollOpen] = useState(false);
  const [tip, setTip] = useState<Tip>(null);

  // Пустая полоса той же высоты: геометрия центрального окна не «плавает»,
  // когда открытых чатов нет.
  if (desk.windows.length === 0) return <div className="chat-tabs chat-tabs--empty" aria-hidden />;

  // Во время dragover браузер прячет данные (protected mode) — getData вернёт
  // пустую строку. До drop можно спрашивать только типы, данные — уже на drop.
  const hasUserDrag = (event: DragEvent): boolean => {
    const types: string[] = Array.from(event.dataTransfer.types ?? []);
    return types.includes('application/x-desk-user') || types.includes('text/plain');
  };

  const readDrop = (event: DragEvent): string | null => {
    if (!hasUserDrag(event)) return null;
    return (
      event.dataTransfer.getData('application/x-desk-user') ||
      event.dataTransfer.getData('text/plain') ||
      null
    );
  };

  const showTip = (event: ReactMouseEvent, text: string) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ text, x: rect.left + rect.width / 2, y: rect.bottom + 6 });
  };

  return (
    <div className="chat-tabs" role="tablist" aria-label="Закреплённые окна">
      <div className="chat-tabs__scroll">
        {desk.windows.map((window: TableSummary) => {
          const unread = desk.freshOf(window);
          const active = window.id === desk.selectedId;
          return (
            <button
              key={window.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`chat-tab ${active ? 'is-active' : ''} ${dragOverKey === window.id ? 'is-drop' : ''}`}
              onClick={() => desk.openWindow(window.id)}
              onMouseEnter={(event) => showTip(event, window.title)}
              onMouseLeave={() => setTip(null)}
              onDragOver={(event) => {
                if (hasUserDrag(event)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'link';
                  setDragOverKey(window.id);
                }
              }}
              onDragLeave={() => setDragOverKey((prev) => (prev === window.id ? null : prev))}
              onDrop={(event) => {
                const userId = readDrop(event);
                setDragOverKey(null);
                setTip(null);
                if (!userId || !desk.userById.has(userId)) return;
                event.preventDefault();
                onDropUser(window.id, userId);
              }}
            >
              <span className={`chat-tab__dot ${unread > 0 ? 'is-unread' : ''}`} aria-hidden />
              <span className="chat-tab__title">{window.title}</span>
              <span
                className="chat-tab__close"
                title="Закрыть вкладку"
                aria-label="Закрыть вкладку"
                onClick={(event) => {
                  event.stopPropagation();
                  desk.closeWindow(window.id);
                }}
              >
                <Icon name="close" size={11} />
              </span>
            </button>
          );
        })}
      </div>

      <div className="chat-tabs__roll-wrap">
        <button
          type="button"
          className={`chat-tabs__roll-btn ${rollOpen ? 'is-open' : ''}`}
          onClick={() => setRollOpen((prev) => !prev)}
          title="Список открытых окон"
          aria-label="Список открытых окон"
        >
          <span className="hamburger" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        </button>

        {rollOpen && (
          <>
            <button
              type="button"
              className="roll-backdrop"
              aria-label="Закрыть список"
              onClick={() => setRollOpen(false)}
            />
            <div className="tabs-roll" role="menu" aria-label="Открытые окна">
              <p className="tabs-roll__title">Окна в переговорном столе</p>
              <div className="tabs-roll__list">
                {desk.windows.map((window: TableSummary) => {
                  const unread = desk.freshOf(window);
                  return (
                    <button
                      key={window.id}
                      type="button"
                      role="menuitem"
                      className={`tabs-roll__item ${window.id === desk.selectedId ? 'is-active' : ''}`}
                      onClick={() => {
                        desk.openWindow(window.id);
                        setRollOpen(false);
                      }}
                      onMouseEnter={(event) => showTip(event, window.title)}
                      onMouseLeave={() => setTip(null)}
                    >
                      <span className={`chat-tab__dot ${unread > 0 ? 'is-unread' : ''}`} />
                      <span className="tabs-roll__name">{window.title}</span>
                      {unread > 0 && <span className="tabs-roll__badge">+{unread}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {tip && (
        <span className="chat-tabs__tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
          {tip.text}
        </span>
      )}
    </div>
  );
}
