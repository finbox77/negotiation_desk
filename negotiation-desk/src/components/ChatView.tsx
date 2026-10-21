// components/ChatView.tsx — окно стола: шапка, лента сообщений, ввод.

import { useEffect, useMemo, useRef } from 'react';
import { dayLabel, dateKey, plural } from '../desk/format';
import { disputeLabel, statusLabel } from '../desk/labels';
import type { DeskMessage } from '../desk/types';
import type { DeskController } from '../desk/useDesk';
import Composer from './Composer';
import { BrandMark, Icon, SignalDot } from './Icons';
import MessageItem from './MessageItem';

function EmptyDesk() {
  return (
    <div className="empty-desk">
      <div className="empty-desk__art">
        <span className="empty-desk__ring empty-desk__ring--one" />
        <span className="empty-desk__ring empty-desk__ring--two" />
        <BrandMark size={92} />
      </div>
      <h2>Выберите стол переговоров</h2>
      <p>
        Слева — все окна, где вы участник. Кружок у названия показывает, кто пишет:
        серый — нового нет, жёлтый — свои и партнёры, зелёный — клиент.
      </p>
      <div className="empty-desk__hints">
        <span>
          <Icon name="lock" size={14} /> сообщения с допуском видит только руководство
        </span>
        <span>
          <Icon name="file" size={14} /> документы подшиваются к сообщениям
        </span>
        <span>
          <Icon name="phone" size={14} /> звонки остаются в истории стола
        </span>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="skeleton" aria-label="Загрузка сообщений">
      {[72, 54, 80, 44].map((width, index) => (
        <div key={index} className={`skeleton__row ${index % 2 ? 'is-mine' : ''}`}>
          <span className="skeleton__avatar" />
          <span className="skeleton__bubble" style={{ width: `${width}%` }} />
        </div>
      ))}
    </div>
  );
}

export default function ChatView({
  desk,
  onBack,
}: {
  desk: DeskController;
  onBack: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    const result: Array<{ key: string; label: string; items: DeskMessage[] }> = [];
    for (const message of desk.messages) {
      const key = dateKey(message.createdAt);
      const last = result[result.length - 1];
      if (last && last.key === key) last.items.push(message);
      else result.push({ key, label: dayLabel(message.createdAt), items: [message] });
    }
    return result;
  }, [desk.messages]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const frame = requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [desk.messages, desk.selectedId, desk.chatLoading]);

  if (!desk.selectedTable) return <section className="panel chat chat--empty"><EmptyDesk /></section>;

  const table = desk.selectedTable;
  const signal = desk.signalOf(table);
  const restricted = (desk.viewer?.clearanceLevel ?? 3) > 1;

  return (
    <section className="panel chat" aria-label={`Стол: ${table.title}`}>
      <header className="chat__head">
        <button
          type="button"
          className="icon-btn chat__back"
          onClick={onBack}
          title="К списку столов"
          aria-label="Назад к столам"
        >
          <Icon name="back" />
        </button>

        <div className="chat__heading">
          <div className="chat__title-line">
            <SignalDot signal={signal} size={11} />
            <h2>{table.title}</h2>
            <span className={`status status--${table.status}`}>{statusLabel(table.status)}</span>
          </div>
          <p className="chat__meta">
            <span>{disputeLabel(table.disputeType)}</span>
            <span className="dot-sep">·</span>
            <span>
              {table.participants} {plural(table.participants, 'участник', 'участника', 'участников')}
            </span>
            <span className="dot-sep">·</span>
            <span>
              {desk.messages.length}{' '}
              {plural(desk.messages.length, 'сообщение', 'сообщения', 'сообщений')}
            </span>
          </p>
        </div>

        <button
          type="button"
          className="icon-btn"
          onClick={() => void desk.refresh()}
          title="Обновить сообщения"
          aria-label="Обновить сообщения"
        >
          <Icon name="refresh" className={desk.chatLoading ? 'spin' : undefined} />
        </button>
      </header>

      {restricted && (
        <div className="chat__access-note">
          <Icon name="lock" size={13} />
          Часть сообщений может быть скрыта: ваш допуск — {desk.viewer?.clearanceLevel}.
        </div>
      )}

      {desk.chatError && (
        <div className="inline-error">
          <Icon name="info" size={15} />
          <span>{desk.chatError}</span>
          <button type="button" className="btn btn--small" onClick={() => void desk.refresh()}>
            Повторить
          </button>
        </div>
      )}

      <div className="messages" ref={scrollRef}>
        {desk.chatLoading && desk.messages.length === 0 ? (
          <Skeleton />
        ) : desk.messages.length === 0 ? (
          <div className="messages__empty">
            <Icon name="spark" size={26} />
            <p>В этом окне ещё нет сообщений. Напишите первое — оно запустит обсуждение.</p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="day">
              <div className="day__label">
                <span>{group.label}</span>
              </div>
              {group.items.map((message, index) => {
                const previous = group.items[index - 1];
                const showAuthor = !previous || previous.sender !== message.sender;
                return (
                  <MessageItem
                    key={message.id}
                    message={message}
                    mine={message.sender === desk.viewer?.id}
                    showAuthor={showAuthor}
                  />
                );
              })}
            </div>
          ))
        )}
      </div>

      <Composer desk={desk} />
    </section>
  );
}
