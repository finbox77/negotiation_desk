// components/ContextPanel.tsx — правая колонка: кто смотрит, участники, контекст.
//
// На узких экранах колонка скрывается: всё важное есть в шапке стола. Здесь
// живут только справка и участники, без действий — так проще встроить обратно
// в кабинет сайта.

import { dayLabel, money } from '../desk/format';
import {
  CLEARANCE_LABEL,
  DEAL_STATUS_LABEL,
  DEAL_TYPE_LABEL,
  disputeLabel,
  roleLabel,
} from '../desk/labels';
import type { DeskController } from '../desk/useDesk';
import Avatar from './Avatar';
import { Icon, SignalDot } from './Icons';

export default function ContextPanel({ desk }: { desk: DeskController }) {
  const { viewer, card, selectedTable, settings } = desk;

  return (
    <aside className="context" aria-label="Контекст стола">
      <div className="side-card viewer-card">
        <Avatar name={viewer?.name ?? 'Гость'} size={42} />
        <div className="viewer-card__text">
          <p className="viewer-card__name">{viewer?.name ?? 'Гость'}</p>
          <p className="viewer-card__role">
            {viewer?.roleLabel ?? 'сессия сайта'}
            {viewer?.companyName ? ` · ${viewer.companyName}` : ''}
          </p>
        </div>
        <span
          className="clearance-badge"
          title={`Допуск ${viewer?.clearanceLevel ?? 3}: ${CLEARANCE_LABEL[viewer?.clearanceLevel ?? 3]}`}
        >
          <Icon name="lock" size={11} />
          {viewer?.clearanceLevel ?? 3}
        </span>
      </div>

      {selectedTable && card ? (
        <>
          <div className="side-card">
            <h3 className="side-card__title">
              <Icon name="users" size={14} />
              Участники
              <span className="side-card__count">{card.participants.length}</span>
            </h3>
            <ul className="participants">
              {card.participants.map((person) => (
                <li key={person.userId} className="participant">
                  <Avatar name={person.name} size={28} />
                  <span className="participant__text">
                    <span className="participant__name">
                      {person.name}
                      {person.userId === viewer?.id && <em> · вы</em>}
                    </span>
                    <span className="participant__company">
                      {person.companyName ?? 'без компании'}
                    </span>
                  </span>
                  <span className={`role-chip ${person.isInitiator ? 'is-initiator' : ''}`}>
                    {roleLabel(person.role)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="side-card">
            <h3 className="side-card__title">
              <Icon name="link" size={14} />
              Контекст
            </h3>
            <dl className="context-list">
              {card.context.product && (
                <div>
                  <dt>Продукт</dt>
                  <dd>{card.context.product.title}</dd>
                </div>
              )}
              {card.context.environment && (
                <div>
                  <dt>Объект</dt>
                  <dd>{card.context.environment.name}</dd>
                </div>
              )}
              {card.context.deal && (
                <div>
                  <dt>Сделка</dt>
                  <dd>
                    {DEAL_TYPE_LABEL[card.context.deal.dealType] ?? card.context.deal.dealType}
                    {' · '}
                    {DEAL_STATUS_LABEL[card.context.deal.status] ?? card.context.deal.status}
                    <span className="context-list__amount">
                      {money(card.context.deal.totalAmount)}
                    </span>
                  </dd>
                </div>
              )}
              <div>
                <dt>Тип спора</dt>
                <dd>{disputeLabel(card.table.disputeType)}</dd>
              </div>
              <div>
                <dt>Открыт</dt>
                <dd>{dayLabel(card.table.createdAt)}</dd>
              </div>
            </dl>
          </div>

          <div className="side-card side-card--legend">
            <h3 className="side-card__title">
              <Icon name="info" size={14} />
              Сигналы
            </h3>
            <p className="legend-row">
              <SignalDot signal="none" /> <span>нет новых</span>
            </p>
            <p className="legend-row">
              <SignalDot signal="team" /> <span>свои и партнёры</span>
            </p>
            <p className="legend-row">
              <SignalDot signal="client" /> <span>клиент — разбирают первым</span>
            </p>
          </div>
        </>
      ) : (
        <div className="side-card">
          <h3 className="side-card__title">
            <Icon name="spark" size={14} />
            Как устроен стол
          </h3>
          <ul className="side-hints">
            <li>Стол — это окно по сделке, тендеру или заявке. Окон может быть несколько.</li>
            <li>Сообщение с допуском 1 увидят только руководители, с допуском 3 — все.</li>
            <li>Документы, звонки и системные события живут в той же ленте.</li>
          </ul>
          <p className="side-note">
            Выберите окно слева, чтобы увидеть участников и контекст.
          </p>
        </div>
      )}

      <div className="side-card side-card--mode">
        <h3 className="side-card__title">
          <Icon name="plug" size={14} />
          {settings.mode === 'demo' ? 'Демо-режим' : 'Подключено к сайту'}
        </h3>
        <p className="side-note">
          {settings.mode === 'demo'
            ? 'Данные живут в браузере: можно писать, менять допуск и смотреть сигналы. Бэкенд не нужен.'
            : 'Стол читает и пишет в базу основного сайта через /api/v1/negotiations.'}
        </p>
        <a className="side-link" href={settings.siteUrl} target="_blank" rel="noreferrer">
          Открыть Simonix <Icon name="chevron" size={13} />
        </a>
      </div>
    </aside>
  );
}
