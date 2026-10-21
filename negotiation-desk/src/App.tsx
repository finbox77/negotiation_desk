// App.tsx — каркас PWA: шапка, три колонки, баннеры состояния и настройки.
//
// На широком экране видны сразу список, лента и контекст. На телефоне —
// одна колонка: список → лента с кнопкой «назад». Состояние колонки локальное:
// при выборе стола открывается лента, при возврате — снова список.

import { useEffect, useState } from 'react';
import ChatView from './components/ChatView';
import ContextPanel from './components/ContextPanel';
import SettingsDialog from './components/SettingsDialog';
import TableList from './components/TableList';
import TopBar from './components/TopBar';
import { Icon } from './components/Icons';
import { useDesk } from './desk/useDesk';
import { useInstallPrompt } from './desk/useInstallPrompt';

export default function App() {
  const desk = useDesk();
  const install = useInstallPrompt();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pane, setPane] = useState<'list' | 'chat'>('list');

  useEffect(() => {
    if (desk.selectedId) setPane('chat');
  }, [desk.selectedId]);

  const loginUrl = `${desk.settings.siteUrl.replace(/\/+$/, '')}/auth/login`;
  const showOffline = !desk.online && desk.settings.mode === 'site';

  return (
    <div className="app" data-pane={pane}>
      <TopBar
        desk={desk}
        onSettings={() => setSettingsOpen(true)}
        onInstall={() => void install.install()}
        canInstall={install.canInstall && !install.installed}
      />

      {showOffline && (
        <div className="banner banner--warn">
          <Icon name="plug" size={15} />
          <span>Нет сети. Стол покажет последние данные, но отправить сообщение не получится.</span>
        </div>
      )}

      {desk.authRequired ? (
        <div className="banner banner--auth">
          <Icon name="lock" size={15} />
          <span>Нужен вход на сайте Simonix — сессия не найдена или истекла.</span>
          <a className="btn btn--small" href={loginUrl} target="_blank" rel="noreferrer">
            Войти
          </a>
          <button type="button" className="btn btn--small" onClick={() => void desk.refresh()}>
            Проверить снова
          </button>
        </div>
      ) : (
        desk.error && (
          <div className="banner banner--error">
            <Icon name="info" size={15} />
            <span>{desk.error}</span>
            <button type="button" className="btn btn--small" onClick={() => void desk.refresh()}>
              Повторить
            </button>
            <button
              type="button"
              className="btn btn--small"
              onClick={() => setSettingsOpen(true)}
            >
              Настройки
            </button>
          </div>
        )
      )}

      <main className="desk-grid" id="desk-main">
        <TableList
          desk={desk}
          onSelect={(id) => {
            desk.select(id);
            setPane('chat');
          }}
        />
        <ChatView desk={desk} onBack={() => setPane('list')} />
        <ContextPanel desk={desk} />
      </main>

      {settingsOpen && (
        <SettingsDialog
          desk={desk}
          install={install}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {desk.notice && (
        <button
          type="button"
          className="toast"
          onClick={desk.clearNotice}
          title="Скрыть"
        >
          <Icon name="check" size={14} />
          {desk.notice}
        </button>
      )}
    </div>
  );
}
