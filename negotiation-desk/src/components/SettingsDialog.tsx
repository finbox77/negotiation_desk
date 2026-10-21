// components/SettingsDialog.tsx — режим, профиль, адреса, тема и установка PWA.
//
// Настройки применяются по кнопке: черновик живёт локально, чтобы случайный
// ввод адреса не перезагружал стол на каждом символе.

import { useEffect, useState } from 'react';
import { ApiError, fetchSnapshot } from '../desk/api';
import { DEMO_PROFILES } from '../desk/demo';
import type { Settings } from '../desk/types';
import type { DeskController } from '../desk/useDesk';
import type { useInstallPrompt } from '../desk/useInstallPrompt';
import { Icon } from './Icons';

type TestState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok'; text: string }
  | { kind: 'auth'; text: string }
  | { kind: 'error'; text: string };

export default function SettingsDialog({
  desk,
  onClose,
  install,
}: {
  desk: DeskController;
  onClose: () => void;
  install: ReturnType<typeof useInstallPrompt>;
}) {
  const [draft, setDraft] = useState<Settings>(desk.settings);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  useEffect(() => {
    setDraft(desk.settings);
  }, [desk.settings]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const patch = (value: Partial<Settings>) => {
    setDraft((prev) => ({ ...prev, ...value }));
    setTest({ kind: 'idle' });
  };

  const checkConnection = async () => {
    setTest({ kind: 'busy' });
    try {
      const snapshot = await fetchSnapshot(draft.apiBase);
      setTest({
        kind: 'ok',
        text: `Связь есть · столов: ${snapshot.tables.length} · вы: ${snapshot.viewer.name ?? 'без имени'}`,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.kind === 'auth') {
          setTest({ kind: 'auth', text: 'Сайт отвечает, но нужен вход. Откройте сайт и войдите.' });
        } else {
          setTest({ kind: 'error', text: error.message });
        }
      } else {
        setTest({ kind: 'error', text: 'Не удалось проверить связь' });
      }
    }
  };

  const apply = () => {
    desk.updateSettings(draft);
    onClose();
  };

  return (
    <div className="overlay" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Настройки стола переговоров"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal__head">
          <div>
            <h2>Настройки</h2>
            <p>Режим, данные и установка приложения</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <Icon name="close" />
          </button>
        </header>

        <div className="modal__body">
          <section className="settings-section">
            <h3 className="settings-section__title">Источник данных</h3>
            <div className="choice-grid">
              <button
                type="button"
                className={`choice ${draft.mode === 'demo' ? 'is-active' : ''}`}
                onClick={() => patch({ mode: 'demo' })}
              >
                <Icon name="spark" size={20} />
                <span className="choice__title">Демо</span>
                <span className="choice__hint">Без бэкенда. Данные в браузере.</span>
                {draft.mode === 'demo' && <span className="choice__check"><Icon name="check" size={13} /></span>}
              </button>

              <button
                type="button"
                className={`choice ${draft.mode === 'site' ? 'is-active' : ''}`}
                onClick={() => patch({ mode: 'site' })}
              >
                <Icon name="plug" size={20} />
                <span className="choice__title">Сайт</span>
                <span className="choice__hint">Настоящие столы через API Simonix.</span>
                {draft.mode === 'site' && <span className="choice__check"><Icon name="check" size={13} /></span>}
              </button>
            </div>

            {draft.mode === 'demo' ? (
              <>
                <h3 className="settings-section__title settings-section__title--spaced">
                  Демо-профиль
                </h3>
                <div className="profile-list">
                  {DEMO_PROFILES.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      className={`profile-option ${draft.demoProfile === profile.id ? 'is-active' : ''}`}
                      onClick={() => patch({ demoProfile: profile.id })}
                    >
                      <span className="profile-option__radio" />
                      <span className="profile-option__text">
                        <span className="profile-option__name">{profile.label}</span>
                        <span className="profile-option__hint">{profile.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <div className="settings-note">
                  <Icon name="info" size={14} />
                  <span>
                    Переключите профиль и откройте стол: часть сообщений исчезнет — так работает
                    допуск. Отправленные вами сообщения тоже подчиняются допуску.
                  </span>
                </div>
                <button type="button" className="btn btn--small" onClick={() => desk.resetDemoData()}>
                  <Icon name="refresh" size={14} />
                  Сбросить демо-данные
                </button>
              </>
            ) : (
              <>
                <h3 className="settings-section__title settings-section__title--spaced">
                  Подключение
                </h3>
                <label className="field">
                  <span>API сайта</span>
                  <input
                    type="url"
                    value={draft.apiBase}
                    onChange={(event) => patch({ apiBase: event.target.value })}
                    placeholder="пусто = /api через прокси Vite"
                    spellCheck={false}
                  />
                  <small>
                    Оставьте пустым при `npm run dev`: Vite проксирует /api на{' '}
                    <code>localhost:3000</code>. Для отдельного домена укажите{' '}
                    <code>https://simonix.ru</code>.
                  </small>
                </label>

                <label className="field">
                  <span>Адрес сайта</span>
                  <input
                    type="url"
                    value={draft.siteUrl}
                    onChange={(event) => patch({ siteUrl: event.target.value })}
                    placeholder="http://localhost:3000"
                    spellCheck={false}
                  />
                  <small>Нужен для входа и ссылок «Открыть Simonix».</small>
                </label>

                <div className="test-row">
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => void checkConnection()}
                    disabled={test.kind === 'busy'}
                  >
                    <Icon name="plug" size={14} />
                    {test.kind === 'busy' ? 'Проверяем…' : 'Проверить связь'}
                  </button>
                  <a
                    className="text-link"
                    href={`${draft.siteUrl.replace(/\/+$/, '')}/auth/login`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Войти на сайте <Icon name="chevron" size={12} />
                  </a>
                </div>

                {test.kind !== 'idle' && test.kind !== 'busy' && (
                  <p className={`test-result test-result--${test.kind}`}>
                    <Icon name={test.kind === 'ok' ? 'check' : 'info'} size={14} />
                    {test.text}
                  </p>
                )}
              </>
            )}
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">Оформление</h3>
            <div className="segmented" role="group" aria-label="Тема">
              {(
                [
                  ['system', 'Как в системе'],
                  ['light', 'Светлая'],
                  ['dark', 'Тёмная'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={draft.theme === value ? 'is-active' : ''}
                  onClick={() => patch({ theme: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">Приложение</h3>
            <p className="settings-text">
              Стол можно установить на телефон или компьютер: он откроется в отдельном окне,
              без адресной строки.
            </p>
            <div className="install-row">
              {install.installed ? (
                <span className="test-result test-result--ok">
                  <Icon name="check" size={14} /> Приложение уже установлено
                </span>
              ) : install.canInstall ? (
                <button
                  type="button"
                  className="btn btn--primary btn--small"
                  onClick={() => void install.install()}
                >
                  <Icon name="install" size={15} />
                  Установить приложение
                </button>
              ) : install.isIos ? (
                <span className="settings-text settings-text--muted">
                  iPhone/iPad: «Поделиться» → «На экран Домой».
                </span>
              ) : (
                <span className="settings-text settings-text--muted">
                  Кнопка установки появляется на HTTPS или localhost после сборки
                  (<code>npm run build && npm run preview</code>).
                </span>
              )}
            </div>
            <p className="settings-version">Стол переговоров · v0.1.0 · PWA</p>
          </section>
        </div>

        <footer className="modal__foot">
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="btn btn--primary" onClick={apply}>
            Применить
          </button>
        </footer>
      </div>
    </div>
  );
}
