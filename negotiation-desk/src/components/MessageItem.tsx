// components/MessageItem.tsx — сообщение, файл, системное событие или звонок.

import { timeOf } from '../desk/format';
import { CLEARANCE_LABEL } from '../desk/labels';
import type { DeskMessage } from '../desk/types';
import Avatar from './Avatar';
import { Icon } from './Icons';

export default function MessageItem({
  message,
  mine,
  showAuthor,
}: {
  message: DeskMessage;
  mine: boolean;
  showAuthor: boolean;
}) {
  const restricted = message.requiredClearance < 3;
  const clearanceTitle = restricted
    ? `Видно с допуском ${message.requiredClearance} и выше (${CLEARANCE_LABEL[message.requiredClearance]})`
    : undefined;

  if (message.type === 'system') {
    return (
      <div className="event">
        <span className="event__line" />
        <span className="event__body">
          <Icon name="info" size={13} />
          <span>{message.text ?? 'системное событие'}</span>
        </span>
        <span className="event__line" />
      </div>
    );
  }

  if (message.type === 'call_started' || message.type === 'call_ended') {
    const started = message.type === 'call_started';
    return (
      <div className="event">
        <span className="event__line" />
        <span className={`event__body event__body--call ${started ? '' : 'is-ended'}`}>
          <Icon name={started ? 'phone' : 'phone-off'} size={13} />
          <span>{message.text ?? (started ? 'Звонок начат' : 'Звонок завершён')}</span>
          <time>{timeOf(message.createdAt)}</time>
        </span>
        <span className="event__line" />
      </div>
    );
  }

  return (
    <article className={`msg ${mine ? 'msg--mine' : ''}`}>
      {!mine && (
        <Avatar name={message.senderName} size={30} className={showAuthor ? '' : 'is-hidden'} />
      )}

      <div className="msg__body">
        {showAuthor && !mine && <p className="msg__author">{message.senderName}</p>}

        <div className="bubble">
          {message.text && <p className="bubble__text">{message.text}</p>}

          {message.files && message.files.length > 0 && (
            <ul className="bubble__files">
              {message.files.map((file) => (
                <li key={file} className="file-chip" title={file}>
                  <span className="file-chip__icon">
                    <Icon name="file" size={15} />
                  </span>
                  <span className="file-chip__name">{file}</span>
                  <Icon name="download" size={14} className="file-chip__action" />
                </li>
              ))}
            </ul>
          )}

          <div className="bubble__foot">
            <time dateTime={message.createdAt}>{timeOf(message.createdAt)}</time>
            {mine && <span className="bubble__check">отправлено</span>}
            {restricted && (
              <span className="clearance-chip" title={clearanceTitle}>
                <Icon name="lock" size={11} />
                допуск {message.requiredClearance}
              </span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
