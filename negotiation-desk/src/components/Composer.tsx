// components/Composer.tsx — ввод сообщения с выбором допуска.
//
// Допуск — реальное поле negotiation_messages.required_clearance: сообщение с
// допуском 1 не увидят сотрудники с допуском 2–3. Поэтому выбор подписан
// по-человечески, а не цифрами.

import { useEffect, useRef, useState } from 'react';
import { CLEARANCE_LABEL } from '../desk/labels';
import type { DeskController } from '../desk/useDesk';
import { Icon } from './Icons';

export default function Composer({ desk }: { desk: DeskController }) {
  const [text, setText] = useState('');
  const [clearance, setClearance] = useState(3);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const minClearance = desk.viewer?.clearanceLevel ?? 1;
  const options = [1, 2, 3].filter((level) => level >= minClearance);

  useEffect(() => {
    if (clearance < minClearance) setClearance(3);
  }, [clearance, minClearance]);

  useEffect(() => {
    // Сменили стол — черновик не тащим в другое окно.
    setText('');
  }, [desk.selectedId]);

  const grow = () => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 150)}px`;
  };

  const submit = async () => {
    if (desk.sending || !text.trim()) return;
    const ok = await desk.send(text, clearance);
    if (!ok) return;
    setText('');
    requestAnimationFrame(() => {
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      textareaRef.current?.focus();
    });
  };

  return (
    <div className="composer">
      <div className="composer__box">
        <textarea
          ref={textareaRef}
          value={text}
          rows={1}
          onChange={(event) => {
            setText(event.target.value);
            grow();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={
            desk.selectedTable
              ? `Сообщение в «${desk.selectedTable.title}»`
              : 'Выберите стол переговоров'
          }
          aria-label="Текст сообщения"
          disabled={!desk.selectedId}
        />

        <div className="composer__bar">
          <label className="clearance-select" title="Кто увидит сообщение">
            <Icon name="lock" size={13} />
            <select
              value={clearance}
              onChange={(event) => setClearance(Number(event.target.value))}
              aria-label="Допуск сообщения"
            >
              {options.map((level) => (
                <option key={level} value={level}>
                  {level} — {CLEARANCE_LABEL[level]}
                </option>
              ))}
            </select>
          </label>

          <span className="composer__hint">
            <kbd>Ctrl</kbd> + <kbd>Enter</kbd> — отправить
          </span>

          <button
            type="button"
            className="send-btn"
            onClick={() => void submit()}
            disabled={!text.trim() || desk.sending || !desk.selectedId}
            title="Отправить сообщение"
            aria-label="Отправить"
          >
            {desk.sending ? <span className="send-btn__spinner" /> : <Icon name="send" size={18} />}
          </button>
        </div>
      </div>

      <p className="composer__note">
        {minClearance === 1
          ? 'Вы видите все сообщения стола. Допуск 1 — только руководство, 3 — все сотрудники.'
          : `Ваш допуск — ${minClearance}. Сообщения с меньшим допуском вам не показываются.`}
      </p>
    </div>
  );
}
