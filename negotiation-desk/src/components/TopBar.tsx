// components/TopBar.tsx — шапка PWA: знак, режим, счётчик новых, обновление.

import type { DeskController } from '../desk/useDesk';
import { plural } from '../desk/format';
import { BrandMark, Icon, SignalDot } from './Icons';

export default function TopBar({
  desk,
  onSettings,
  onInstall,
  canInstall,
}: {
  desk: DeskController;
  onSettings: () => void;
  onInstall: () => void;
  canInstall: boolean;
}) {
  const { settings, snapshot, totalFresh, loading, refresh, hasUnread, windows, freshOf } = desk;
  const fromClients = snapshot?.totals.freshFromClients ?? 0;
  // Непрочитанные окна и новые сообщения подсвечивают точку эмблемки.
  const unreadWindows = windows.filter((w) => freshOf(w) > 0).length;
  const alert = hasUnread || unreadWindows > 0;

  return (
    <header className="topbar">
      <div
        className="topbar__brand"
        title={
          alert
            ? `Есть непрочитанные${unreadWindows > 0 ? ` окна: ${unreadWindows}` : ` сообщения: ${totalFresh}`}`
            : 'Стол переговоров — новых сообщений нет'
        }
      >
        <BrandMark size={30} alert={alert} />
        <div className="topbar__titles">
          <h1>Стол переговоров</h1>
          <p>Simonix · окно сделки</p>
        </div>
      </div>

      <button
        type="button"
        className={`mode-chip mode-chip--${settings.mode}`}
        onClick={onSettings}
        title="Режим работы — открыть настройки"
      >
        <span className="mode-chip__dot" />
        {settings.mode === 'demo' ? 'Демо' : 'Сайт'}
      </button>

      <div className="topbar__spacer" />

      <div className="topbar__stat" title="Новые сообщения за последние 72 часа">
        <SignalDot signal={snapshot?.totals.signal ?? 'none'} />
        {totalFresh > 0 ? (
          <span>
            {totalFresh} {plural(totalFresh, 'новое', 'новых', 'новых')}
            {fromClients > 0 && (
              <span className="topbar__stat-client"> · {fromClients} от клиентов</span>
            )}
          </span>
        ) : (
          <span>новых нет</span>
        )}
      </div>

      {canInstall && (
        <button
          type="button"
          className="icon-btn icon-btn--on-dark"
          onClick={onInstall}
          title="Установить приложение"
          aria-label="Установить приложение"
        >
          <Icon name="install" />
        </button>
      )}

      <button
        type="button"
        className="icon-btn icon-btn--on-dark"
        onClick={() => void refresh()}
        title="Обновить стол"
        aria-label="Обновить"
      >
        <Icon name="refresh" className={loading ? 'spin' : undefined} />
      </button>

      <button
        type="button"
        className="icon-btn icon-btn--on-dark"
        onClick={onSettings}
        title="Настройки"
        aria-label="Настройки"
      >
        <Icon name="settings" />
      </button>
    </header>
  );
}
