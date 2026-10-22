// components/Composer.tsx — ввод сообщения с выбором допуска и вложениями.
//
// Допуск — реальное поле negotiation_messages.required_clearance: сообщение с
// допуском 1 не увидят сотрудники с допуском 2–3. Поэтому выбор подписан
// по-человечески, а не цифрами.
//
// Вложения: «Загрузить с устройства» работает сразу (файлы уходят с сообщением),
// «Из кабинета» — заготовка под документы основного проекта.

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { registerFile } from '../desk/fileStore';
import { CLEARANCE_LABEL } from '../desk/labels';
import type { DeskController } from '../desk/useDesk';
import { Icon } from './Icons';

export default function Composer({ desk }: { desk: DeskController }) {
  const [text, setText] = useState('');
  const [clearance, setClearance] = useState(3);
  const [files, setFiles] = useState<File[]>([]);
  const [attachMenu, setAttachMenu] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const writable = Boolean(desk.selectedId) && desk.canWrite;

  const minClearance = desk.viewer?.clearanceLevel ?? 1;
  const options = [1, 2, 3].filter((level) => level >= minClearance);

  useEffect(() => {
    if (clearance < minClearance) setClearance(3);
  }, [clearance, minClearance]);

  useEffect(() => {
    // Сменили стол — черновик не тащим в другое окно.
    setText('');
    setFiles([]);
  }, [desk.selectedId]);

  useEffect(() => {
    if (!attachMenu) return;
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setAttachMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [attachMenu]);

  const grow = () => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 150)}px`;
  };

  const onPickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    if (picked.length) {
      // Содержимое файла сохраняем — оно понадобится для папки при выгрузке в Word.
      for (const file of picked) registerFile(file);
      setFiles((prev) => [...prev, ...picked].slice(0, 10));
    }
    setAttachMenu(false);
    // Разрешаем выбрать тот же файл повторно.
    event.target.value = '';
  };

  const submit = async () => {
    if (desk.sending || !writable) return;
    const names = files.map((file) => file.name);
    if (!text.trim() && names.length === 0) return;
    const ok = await desk.send(text, clearance, names.length ? names : null);
    if (!ok) return;
    setText('');
    setFiles([]);
    requestAnimationFrame(() => {
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      textareaRef.current?.focus();
    });
  };

  return (
    <div className="composer">
      {files.length > 0 && (
        <ul className="composer__files">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="file-chip" title={file.name}>
              <span className="file-chip__icon">
                <Icon name="file" size={14} />
              </span>
              <span className="file-chip__name">{file.name}</span>
              <button
                type="button"
                className="file-chip__remove"
                onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                aria-label={`Убрать ${file.name}`}
              >
                <Icon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

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
            !desk.selectedId
              ? 'Выберите стол переговоров'
              : !desk.canWrite
                ? 'Чат закрыт — отправка недоступна'
                : `Сообщение в «${desk.selectedTable?.title ?? ''}»`
          }
          aria-label="Текст сообщения"
          disabled={!writable}
        />

        <div className="composer__bar">
          <div className="attach" ref={menuRef}>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setAttachMenu((prev) => !prev)}
              disabled={!writable}
              title="Прикрепить файл"
              aria-label="Прикрепить файл"
            >
              <Icon name="attach" size={17} />
            </button>

            {attachMenu && (
              <div className="attach__menu" role="menu">
                <button
                  type="button"
                  className="attach__item"
                  role="menuitem"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Icon name="download" size={14} />
                  Загрузить с устройства
                  <span className="ctx-menu__hint">файлы с компьютера</span>
                </button>
                <button
                  type="button"
                  className="attach__item"
                  role="menuitem"
                  onClick={() => {
                    setAttachMenu(false);
                    desk.notify(
                      'Файлы из кабинета появятся после подключения к основному проекту',
                    );
                  }}
                  title="Документы кабинета — после подключения к проекту"
                >
                  <Icon name="file" size={14} />
                  Из кабинета
                  <span className="ctx-menu__hint">нужна связь с проектом</span>
                </button>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={onPickFiles}
              aria-label="Загрузить с устройства"
            />
          </div>

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
            disabled={(!text.trim() && files.length === 0) || desk.sending || !writable}
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
