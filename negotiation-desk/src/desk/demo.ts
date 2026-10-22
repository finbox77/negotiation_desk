// desk/demo.ts — демонстрационный стол без бэкенда.
//
// Зачем: приложение должно запускаться одной командой (`npm run dev`) и сразу
// показывать живую логику стола — сигналы «клиент/свои», допуски, участников,
// документы и события звонка. Данные правдоподобные, но вымышленные; они не
// пересекаются с демо-сидом основного сайта и живут только в этом файле.
//
// Три профиля показывают, как работает допуск:
//   директор (1) видит всё, инженер (2) — без сообщений «для руководства»,
//   вендор (3) — только общие сообщения.

import { statusLabel } from './labels';
import type {
  CardContext,
  DemoProfileId,
  DeskMessage,
  DeskSnapshot,
  DeskUser,
  MessageType,
  NegotiationStatus,
  Participant,
  ParticipantRole,
  SendPayload,
  TableCard,
  TableSummary,
  Viewer,
} from './types';

export type { DemoProfileId } from './types';

const FRESH_WINDOW_MS = 72 * 3600 * 1000;

type DemoAuthor = {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
  companyIsClient: boolean;
  roleLabel: string;
  /** Уровень допуска: 1 — руководство, 3 — все сотрудники. */
  clearanceLevel: number;
  /** Сейчас в столе переговоров (ободок аватара зелёный). */
  present: boolean;
};

type DemoParticipant = { userId: string; role: ParticipantRole };

type DemoTable = {
  id: string;
  title: string;
  disputeType: string;
  status: NegotiationStatus;
  dealId: string | null;
  productId: string | null;
  environmentId: string | null;
  initiatorUserId: string;
  initiatorCompanyId: string | null;
  respondentCompanyId: string | null;
  createdAt: string;
  updatedAt: string;
  context: CardContext;
  participants: DemoParticipant[];
};

type DemoMessage = {
  id: string;
  tableId: string;
  sender: string;
  type: MessageType;
  text: string | null;
  files: string[] | null;
  requiredClearance: number;
  createdAt: string;
};

type DemoState = {
  tables: DemoTable[];
  messages: DemoMessage[];
};

const AUTHORS: Record<string, DemoAuthor> = {
  'u-demo-director': {
    id: 'u-demo-director',
    name: 'Анна Соколова',
    companyId: 'c-demo-client',
    companyName: 'Технопарк Север',
    companyIsClient: true,
    roleLabel: 'директор',
    clearanceLevel: 1,
    present: true,
  },
  'u-demo-engineer': {
    id: 'u-demo-engineer',
    name: 'Игорь Левин',
    companyId: 'c-demo-client',
    companyName: 'Технопарк Север',
    companyIsClient: true,
    roleLabel: 'инженер',
    clearanceLevel: 2,
    present: true,
  },
  'u-demo-manager': {
    id: 'u-demo-manager',
    name: 'Павел Дорохов',
    companyId: 'c-demo-client',
    companyName: 'Технопарк Север',
    companyIsClient: true,
    roleLabel: 'менеджер',
    clearanceLevel: 2,
    present: false,
  },
  'u-demo-customer': {
    id: 'u-demo-customer',
    name: 'Наталья Гордеева',
    companyId: 'c-demo-port',
    companyName: 'Северный порт',
    companyIsClient: true,
    roleLabel: 'заказчик',
    clearanceLevel: 1,
    present: true,
  },
  'u-demo-vendor': {
    id: 'u-demo-vendor',
    name: 'Максим Крылов',
    companyId: 'c-demo-vendor',
    companyName: 'Роботех СПб',
    companyIsClient: false,
    roleLabel: 'вендор',
    clearanceLevel: 3,
    present: true,
  },
  'u-demo-vendor-dir': {
    id: 'u-demo-vendor-dir',
    name: 'Сергей Осипов',
    companyId: 'c-demo-vendor',
    companyName: 'Роботех СПб',
    companyIsClient: false,
    roleLabel: 'директор вендора',
    clearanceLevel: 2,
    present: false,
  },
  'u-demo-bank': {
    id: 'u-demo-bank',
    name: 'Ольга Мирская',
    companyId: 'c-demo-bank',
    companyName: 'Балтийский лизинг',
    companyIsClient: false,
    roleLabel: 'банк',
    clearanceLevel: 2,
    present: true,
  },
  'u-demo-logist': {
    id: 'u-demo-logist',
    name: 'Артём Белов',
    companyId: 'c-demo-logistics',
    companyName: 'Деловые Линии',
    companyIsClient: false,
    roleLabel: 'логистика',
    clearanceLevel: 3,
    present: false,
  },
  'u-demo-support': {
    id: 'u-demo-support',
    name: 'Лидия Ким',
    companyId: 'c-demo-platform',
    companyName: 'Simonix',
    companyIsClient: false,
    roleLabel: 'поддержка',
    clearanceLevel: 2,
    present: false,
  },
};

export const DEMO_PROFILES: Array<{ id: DemoProfileId; label: string; hint: string }> = [
  { id: 'director', label: 'Директор', hint: 'допуск 1 · видно всё' },
  { id: 'engineer', label: 'Инженер', hint: 'допуск 2 · без «для руководства»' },
  { id: 'vendor', label: 'Вендор', hint: 'допуск 3 · только общие сообщения' },
];

const VIEWER_PROFILE: Record<DemoProfileId, { userId: string; clearanceLevel: number }> = {
  director: { userId: 'u-demo-director', clearanceLevel: 1 },
  engineer: { userId: 'u-demo-engineer', clearanceLevel: 2 },
  vendor: { userId: 'u-demo-vendor', clearanceLevel: 3 },
};

function isoFromNow(now: number, minutesAgo: number): string {
  return new Date(now - minutesAgo * 60_000).toISOString();
}

function buildState(): DemoState {
  const now = Date.now();
  const min = (n: number) => isoFromNow(now, n);
  const hours = (n: number) => min(n * 60);
  const days = (n: number) => hours(n * 24);

  const tables: DemoTable[] = [
    {
      id: 'nt-demo-port',
      title: 'Склад «Северный порт»: паллетизация',
      disputeType: 'commercial_dispute',
      status: 'open',
      dealId: null,
      productId: 'pr-demo-atlas',
      environmentId: 'env-demo-port',
      initiatorUserId: 'u-demo-customer',
      initiatorCompanyId: 'c-demo-port',
      respondentCompanyId: 'c-demo-vendor',
      createdAt: days(6),
      updatedAt: min(35),
      context: {
        deal: null,
        product: { id: 'pr-demo-atlas', title: 'ATLAS-6 · паллетоукладчик' },
        environment: { id: 'env-demo-port', name: 'Склад «Северный порт», 1 200 м²' },
      },
      participants: [
        { userId: 'u-demo-customer', role: 'initiator' },
        { userId: 'u-demo-director', role: 'staff' },
        { userId: 'u-demo-engineer', role: 'staff' },
        { userId: 'u-demo-vendor', role: 'counterparty' },
        { userId: 'u-demo-manager', role: 'observer' },
      ],
    },
    {
      id: 'nt-demo-lease',
      title: 'Лизинг ATLAS-6, 2 шт.',
      disputeType: 'pre_contract',
      status: 'open',
      dealId: 'fd-demo-lease',
      productId: 'pr-demo-atlas',
      environmentId: null,
      initiatorUserId: 'u-demo-director',
      initiatorCompanyId: 'c-demo-client',
      respondentCompanyId: 'c-demo-vendor',
      createdAt: days(8),
      updatedAt: hours(2),
      context: {
        deal: {
          id: 'fd-demo-lease',
          dealType: 'leasing',
          status: 'negotiation',
          totalAmount: 7_480_000,
        },
        product: { id: 'pr-demo-atlas', title: 'ATLAS-6 · паллетоукладчик' },
        environment: null,
      },
      participants: [
        { userId: 'u-demo-director', role: 'initiator' },
        { userId: 'u-demo-vendor-dir', role: 'counterparty' },
        { userId: 'u-demo-bank', role: 'bank' },
        { userId: 'u-demo-vendor', role: 'counterparty' },
      ],
    },
    {
      id: 'nt-demo-tender',
      title: 'Тендер 44-ФЗ: уточнение ТЗ',
      disputeType: 'gov_program_audit',
      status: 'open',
      dealId: null,
      productId: 'pr-demo-atlas',
      environmentId: null,
      initiatorUserId: 'u-demo-manager',
      initiatorCompanyId: 'c-demo-client',
      respondentCompanyId: null,
      createdAt: days(9),
      updatedAt: hours(5),
      context: {
        deal: null,
        product: { id: 'pr-demo-atlas', title: 'ATLAS-6 · паллетоукладчик' },
        environment: null,
      },
      participants: [
        { userId: 'u-demo-manager', role: 'initiator' },
        { userId: 'u-demo-engineer', role: 'staff' },
        { userId: 'u-demo-director', role: 'staff' },
        { userId: 'u-demo-vendor', role: 'counterparty' },
      ],
    },
    {
      id: 'nt-demo-warranty',
      title: 'Гарантия: привод ATLAS-6',
      disputeType: 'technical_warranty',
      status: 'waiting_platform',
      dealId: 'fd-demo-warranty',
      productId: 'pr-demo-atlas',
      environmentId: null,
      initiatorUserId: 'u-demo-engineer',
      initiatorCompanyId: 'c-demo-client',
      respondentCompanyId: 'c-demo-vendor',
      createdAt: days(4),
      updatedAt: hours(26),
      context: {
        deal: {
          id: 'fd-demo-warranty',
          dealType: 'sale',
          status: 'active',
          totalAmount: 3_740_000,
        },
        product: { id: 'pr-demo-atlas', title: 'ATLAS-6 · паллетоукладчик' },
        environment: null,
      },
      participants: [
        { userId: 'u-demo-engineer', role: 'initiator' },
        { userId: 'u-demo-vendor', role: 'counterparty' },
        { userId: 'u-demo-support', role: 'platform' },
        { userId: 'u-demo-director', role: 'observer' },
      ],
    },
    {
      id: 'nt-demo-delivery',
      title: 'Доставка: слот на 24.10',
      disputeType: 'delivery_logistics',
      status: 'resolved',
      dealId: 'fd-demo-lease',
      productId: 'pr-demo-atlas',
      environmentId: null,
      initiatorUserId: 'u-demo-manager',
      initiatorCompanyId: 'c-demo-client',
      respondentCompanyId: 'c-demo-logistics',
      createdAt: days(3),
      updatedAt: days(2),
      context: {
        deal: {
          id: 'fd-demo-lease',
          dealType: 'leasing',
          status: 'approved',
          totalAmount: 7_480_000,
        },
        product: { id: 'pr-demo-atlas', title: 'ATLAS-6 · паллетоукладчик' },
        environment: null,
      },
      participants: [
        { userId: 'u-demo-manager', role: 'initiator' },
        { userId: 'u-demo-logist', role: 'counterparty' },
        { userId: 'u-demo-director', role: 'observer' },
      ],
    },
    {
      id: 'nt-demo-support',
      title: 'Поддержка: доступ к картам объектов',
      disputeType: 'platform_support',
      status: 'closed',
      dealId: null,
      productId: null,
      environmentId: 'env-demo-port',
      initiatorUserId: 'u-demo-engineer',
      initiatorCompanyId: 'c-demo-client',
      respondentCompanyId: 'c-demo-platform',
      createdAt: days(14),
      updatedAt: days(12),
      context: {
        deal: null,
        product: null,
        environment: { id: 'env-demo-port', name: 'Склад «Северный порт», 1 200 м²' },
      },
      participants: [
        { userId: 'u-demo-engineer', role: 'initiator' },
        { userId: 'u-demo-support', role: 'platform' },
        { userId: 'u-demo-director', role: 'observer' },
      ],
    },
  ];

  const messages: DemoMessage[] = [
    // ---------------- «Северный порт»: клиент ждёт ответа (зелёный) -----------
    {
      id: 'nm-demo-101',
      tableId: 'nt-demo-port',
      sender: 'u-demo-customer',
      type: 'system',
      text: 'Окно создано по обращению заказчика. Инициатор: «Северный порт».',
      files: null,
      requiredClearance: 3,
      createdAt: days(6),
    },
    {
      id: 'nm-demo-102',
      tableId: 'nt-demo-port',
      sender: 'u-demo-customer',
      type: 'text',
      text: 'Нужен расчёт на две паллетоукладочные линии. Смена 12 часов, пиковая нагрузка — 340 паллет в час. Склад работает круглосуточно.',
      files: null,
      requiredClearance: 3,
      createdAt: hours(5 * 24 + 6),
    },
    {
      id: 'nm-demo-103',
      tableId: 'nt-demo-port',
      sender: 'u-demo-director',
      type: 'text',
      text: 'Принято. Собираем КР по двум линиям, отдельно покажем окупаемость при вашей загрузке. Вернёмся с расчётом в течение двух дней.',
      files: null,
      requiredClearance: 3,
      createdAt: hours(5 * 24 + 2),
    },
    {
      id: 'nm-demo-104',
      tableId: 'nt-demo-port',
      sender: 'u-demo-engineer',
      type: 'text',
      text: 'По планировке: зона приёмки 18×12 м, потолок 7,2 м. Нужны габариты ворот и тип покрытия пола — от этого зависит схема движения.',
      files: null,
      requiredClearance: 3,
      createdAt: hours(3 * 24 + 4),
    },
    {
      id: 'nm-demo-105',
      tableId: 'nt-demo-port',
      sender: 'u-demo-manager',
      type: 'text',
      text: 'Внутренняя вилка по марже для этой сделки: не ниже 18%. Внешнюю смету собираем от 6,9 млн за две линии.',
      files: null,
      requiredClearance: 2,
      createdAt: hours(2 * 24 + 8),
    },
    {
      id: 'nm-demo-106',
      tableId: 'nt-demo-port',
      sender: 'u-demo-customer',
      type: 'text',
      text: 'Бюджет согласован на уровне 7,2 млн. Пришлите финальную смету до пятницы — совет директоров собирается в понедельник.',
      files: null,
      requiredClearance: 3,
      createdAt: min(35),
    },
    {
      id: 'nm-demo-107',
      tableId: 'nt-demo-port',
      sender: 'u-demo-vendor',
      type: 'file',
      text: 'Добавили схему расстановки двух линий под ваш контур приёмки.',
      files: ['Схема_двух_линий_ATLAS-6.pdf'],
      requiredClearance: 3,
      createdAt: hours(2 * 24 + 1),
    },

    // ---------------- Лизинг: банк дал условия, висит вопрос (жёлтый) ---------
    {
      id: 'nm-demo-201',
      tableId: 'nt-demo-lease',
      sender: 'u-demo-director',
      type: 'system',
      text: 'Окно по сделке: лизинг двух ATLAS-6, 36 месяцев.',
      files: null,
      requiredClearance: 3,
      createdAt: days(8),
    },
    {
      id: 'nm-demo-202',
      tableId: 'nt-demo-lease',
      sender: 'u-demo-director',
      type: 'text',
      text: 'Базовые условия: аванс 20%, 36 платежей, остаточная стоимость 10%. Просим подтвердить ставку и график выкупа.',
      files: null,
      requiredClearance: 3,
      createdAt: days(7),
    },
    {
      id: 'nm-demo-203',
      tableId: 'nt-demo-lease',
      sender: 'u-demo-vendor-dir',
      type: 'text',
      text: 'Со стороны вендора подтверждаем PDI за свой счёт и обучение двух операторов. Поставка после подписания — 6 недель.',
      files: null,
      requiredClearance: 3,
      createdAt: days(6),
    },
    {
      id: 'nm-demo-204',
      tableId: 'nt-demo-lease',
      sender: 'u-demo-director',
      type: 'text',
      text: 'Внутренний лимит по проекту — удорожание не выше 14,2% в год. Ниже этой планки не спускаемся.',
      files: null,
      requiredClearance: 1,
      createdAt: days(4),
    },
    {
      id: 'nm-demo-205',
      tableId: 'nt-demo-lease',
      sender: 'u-demo-bank',
      type: 'call_started',
      text: null,
      files: null,
      requiredClearance: 3,
      createdAt: min(150),
    },
    {
      id: 'nm-demo-206',
      tableId: 'nt-demo-lease',
      sender: 'u-demo-bank',
      type: 'call_ended',
      text: 'Звонок с банком · 14 мин',
      files: null,
      requiredClearance: 3,
      createdAt: min(136),
    },
    {
      id: 'nm-demo-207',
      tableId: 'nt-demo-lease',
      sender: 'u-demo-bank',
      type: 'text',
      text: 'Предварительно одобрено: ставка 13,4%, удорожание 7,8% в год. Для финального решения нужен баланс за два периода.',
      files: null,
      requiredClearance: 3,
      createdAt: hours(2),
    },
    {
      id: 'nm-demo-208',
      tableId: 'nt-demo-lease',
      sender: 'u-demo-bank',
      type: 'file',
      text: 'Решение по лизингу во вложении — подписано со стороны банка.',
      files: ['Решение_по_лизингу.pdf'],
      requiredClearance: 3,
      createdAt: hours(2),
    },

    // ---------------- Тендер: пишут свои, вопрос по ТЗ (жёлтый) ---------------
    {
      id: 'nm-demo-301',
      tableId: 'nt-demo-tender',
      sender: 'u-demo-manager',
      type: 'system',
      text: 'Окно создано по тендеру 44-ФЗ.',
      files: null,
      requiredClearance: 3,
      createdAt: days(9),
    },
    {
      id: 'nm-demo-302',
      tableId: 'nt-demo-tender',
      sender: 'u-demo-manager',
      type: 'text',
      text: 'Заказчик прислал уточнённое ТЗ: изменился вес паллеты — до 1 200 кг. Проверьте, проходит ли захват.',
      files: null,
      requiredClearance: 3,
      createdAt: days(8),
    },
    {
      id: 'nm-demo-303',
      tableId: 'nt-demo-tender',
      sender: 'u-demo-engineer',
      type: 'text',
      text: 'Захват рассчитан на 1 100 кг с запасом 15%. Для 1 200 кг нужна версия с усиленной рамой — это +180 тыс. к бюджету.',
      files: null,
      requiredClearance: 3,
      createdAt: days(7),
    },
    {
      id: 'nm-demo-304',
      tableId: 'nt-demo-tender',
      sender: 'u-demo-director',
      type: 'text',
      text: 'Позиция по цене: ниже 6,4 млн не опускаемся, даже если конкурент демпингует. Обоснование — в коммерческом расчёте.',
      files: null,
      requiredClearance: 1,
      createdAt: days(6),
    },
    {
      id: 'nm-demo-305',
      tableId: 'nt-demo-tender',
      sender: 'u-demo-engineer',
      type: 'text',
      text: 'Согласовал с заводом усиленную раму: срок поставки не меняется. Подтверждение пришлю в тендерную документацию.',
      files: null,
      requiredClearance: 3,
      createdAt: hours(5),
    },

    // ---------------- Гарантия: ждёт платформу, новых нет (серый) -------------
    {
      id: 'nm-demo-401',
      tableId: 'nt-demo-warranty',
      sender: 'u-demo-engineer',
      type: 'system',
      text: 'Окно по гарантийному случаю: привод левой каретки.',
      files: null,
      requiredClearance: 3,
      createdAt: days(4),
    },
    {
      id: 'nm-demo-402',
      tableId: 'nt-demo-warranty',
      sender: 'u-demo-engineer',
      type: 'text',
      text: 'Приложил телеметрию за 14 дней до отказа: два перегрева привода и ошибка E-17. Пробег 1 840 км, гарантия действует.',
      files: ['Телеметрия_ATLAS-6_14д.xlsx'],
      requiredClearance: 3,
      createdAt: days(3),
    },
    {
      id: 'nm-demo-403',
      tableId: 'nt-demo-warranty',
      sender: 'u-demo-vendor',
      type: 'text',
      text: 'Запросили у завода заключение по партии приводов. Ответ обещали в течение трёх рабочих дней.',
      files: null,
      requiredClearance: 3,
      createdAt: days(2),
    },
    {
      id: 'nm-demo-404',
      tableId: 'nt-demo-warranty',
      sender: 'u-demo-director',
      type: 'text',
      text: 'Передаю на арбитраж платформы: вендор не уложился в срок ответа. Прошу зафиксировать дату и приложить переписку.',
      files: null,
      requiredClearance: 3,
      createdAt: hours(26),
    },

    // ---------------- Доставка: решено ---------------------------------------
    {
      id: 'nm-demo-501',
      tableId: 'nt-demo-delivery',
      sender: 'u-demo-manager',
      type: 'system',
      text: 'Окно по слоту доставки.',
      files: null,
      requiredClearance: 3,
      createdAt: days(3),
    },
    {
      id: 'nm-demo-502',
      tableId: 'nt-demo-delivery',
      sender: 'u-demo-logist',
      type: 'text',
      text: 'Свободные слоты: 24.10 с 09:00 до 12:00 или 25.10 после 14:00. Разгрузка с задней рампы, нужен проезд для фуры.',
      files: null,
      requiredClearance: 3,
      createdAt: days(3),
    },
    {
      id: 'nm-demo-503',
      tableId: 'nt-demo-delivery',
      sender: 'u-demo-director',
      type: 'text',
      text: 'Берём 24.10 с 09:00. Пропуск на фуру закажем заранее, контакт охраны скину в личку.',
      files: null,
      requiredClearance: 3,
      createdAt: days(2),
    },

    // ---------------- Поддержка: закрыто --------------------------------------
    {
      id: 'nm-demo-601',
      tableId: 'nt-demo-support',
      sender: 'u-demo-engineer',
      type: 'system',
      text: 'Окно создано по обращению в поддержку.',
      files: null,
      requiredClearance: 3,
      createdAt: days(14),
    },
    {
      id: 'nm-demo-602',
      tableId: 'nt-demo-support',
      sender: 'u-demo-engineer',
      type: 'text',
      text: 'Не открывается слой карт у инженера: вместо зон пустой экран. Браузер Chrome, доступ выдан вчера.',
      files: null,
      requiredClearance: 3,
      createdAt: days(14),
    },
    {
      id: 'nm-demo-603',
      tableId: 'nt-demo-support',
      sender: 'u-demo-support',
      type: 'text',
      text: 'У пользователя не хватало права maps_view. Выдали, доступ проверен — слой открывается. Закрываю обращение.',
      files: null,
      requiredClearance: 3,
      createdAt: days(12),
    },
  ];

  return { tables, messages };
}

let state: DemoState = buildState();

export function demoViewer(profile: DemoProfileId): Viewer {
  const cfg = VIEWER_PROFILE[profile] ?? VIEWER_PROFILE.director;
  const author = AUTHORS[cfg.userId];
  return {
    id: author.id,
    name: author.name,
    clearanceLevel: cfg.clearanceLevel,
    companyId: author.companyId,
    companyName: author.companyName,
    roleLabel: author.roleLabel,
  };
}

/** Каталог всех участников демо-стола — для дерева, чатов и подсказок. */
export function demoDirectory(viewer: Viewer): DeskUser[] {
  return Object.values(AUTHORS).map((author) => ({
    id: author.id,
    name: author.name,
    companyName: author.companyName,
    companyIsClient: author.companyIsClient,
    clearanceLevel:
      author.id === viewer.id ? viewer.clearanceLevel : author.clearanceLevel,
    present: author.present || author.id === viewer.id,
  }));
}

function authorOf(userId: string): DemoAuthor {
  return (
    AUTHORS[userId] ?? {
      id: userId,
      name: 'участник',
      companyId: 'c-demo-unknown',
      companyName: '—',
      companyIsClient: false,
      roleLabel: 'участник',
      clearanceLevel: 3,
      present: false,
    }
  );
}

function canSee(viewer: Viewer, message: DemoMessage): boolean {
  return viewer.clearanceLevel <= message.requiredClearance;
}

function visibleMessages(viewer: Viewer, tableId: string): DemoMessage[] {
  return state.messages
    .filter((m) => m.tableId === tableId && canSee(viewer, m))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** Участник ли смотрящий этого стола: инициатор или строка participants. */
function isParticipant(table: DemoTable, viewer: Viewer): boolean {
  return (
    table.initiatorUserId === viewer.id ||
    table.participants.some((p) => p.userId === viewer.id)
  );
}

/** Клиент — сотрудник чужой компании-заказчика; остальные — свои и партнёры. */
function signalOf(viewer: Viewer, message: DemoMessage): 'team' | 'client' {
  const author = authorOf(message.sender);
  if (author.companyId !== viewer.companyId && author.companyIsClient) return 'client';
  return 'team';
}

export function demoSnapshot(viewer: Viewer): DeskSnapshot {
  const now = Date.now();
  let fresh = 0;
  let freshFromClients = 0;

  const tables: TableSummary[] = state.tables.filter((t) => isParticipant(t, viewer)).map((t) => {
    const visible = visibleMessages(viewer, t.id);
    const incoming = visible.filter(
      (m) => m.sender !== viewer.id && now - Date.parse(m.createdAt) < FRESH_WINDOW_MS,
    );

    let signal: TableSummary['signal'] = 'none';
    for (const m of incoming) {
      if (signalOf(viewer, m) === 'client') {
        freshFromClients += 1;
        signal = 'client';
      } else if (signal === 'none') {
        signal = 'team';
      }
    }
    fresh += incoming.length;

    const lastRaw = visible[visible.length - 1] ?? null;
    const last = lastRaw
      ? {
          id: lastRaw.id,
          author: authorOf(lastRaw.sender).name,
          text:
            lastRaw.text ??
            (lastRaw.type === 'file' ? 'приложен файл' : 'системное событие'),
          createdAt: lastRaw.createdAt,
          fresh:
            lastRaw.sender !== viewer.id &&
            now - Date.parse(lastRaw.createdAt) < FRESH_WINDOW_MS,
        }
      : null;

    return {
      id: t.id,
      title: t.title,
      disputeType: t.disputeType,
      status: t.status,
      statusLabel: statusLabel(t.status),
      dealId: t.dealId,
      productId: t.productId,
      environmentId: t.environmentId,
      participants: t.participants.length,
      messages: visible.length,
      fresh: incoming.length,
      signal,
      last,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      initiatorUserId: t.initiatorUserId,
    };
  });

  tables.sort(
    (a, b) =>
      b.fresh - a.fresh ||
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
      Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );

  return {
    viewer,
    tables,
    totals: {
      tables: tables.length,
      fresh,
      freshFromClients,
      signal: freshFromClients > 0 ? 'client' : fresh > 0 ? 'team' : 'none',
    },
  };
}

export function demoCard(viewer: Viewer, tableId: string): TableCard | null {
  const table = state.tables.find((t) => t.id === tableId);
  if (!table || !isParticipant(table, viewer)) return null;

  const participants: Participant[] = table.participants.map((p) => {
    const author = authorOf(p.userId);
    return {
      userId: author.id,
      name: author.name,
      role: p.role,
      companyId: author.companyId,
      companyName: author.companyName,
      isInitiator: p.userId === table.initiatorUserId,
      clearanceLevel: author.clearanceLevel,
      present: author.present || p.userId === viewer.id,
    };
  });

  return {
    table: {
      id: table.id,
      title: table.title,
      disputeType: table.disputeType,
      status: table.status,
      dealId: table.dealId,
      productId: table.productId,
      environmentId: table.environmentId,
      initiatorUserId: table.initiatorUserId,
      initiatorCompanyId: table.initiatorCompanyId,
      respondentCompanyId: table.respondentCompanyId,
      createdAt: table.createdAt,
      updatedAt: table.updatedAt,
    },
    participants,
    context: table.context,
    messageCount: visibleMessages(viewer, table.id).length,
  };
}

export function demoMessages(viewer: Viewer, tableId: string): DeskMessage[] {
  return visibleMessages(viewer, tableId).map((m) => ({
    id: m.id,
    sender: m.sender,
    senderName: authorOf(m.sender).name,
    type: m.type,
    text: m.text,
    files: m.files,
    requiredClearance: m.requiredClearance,
    createdAt: m.createdAt,
    visibleDocuments: m.files?.length ?? 0,
  }));
}

export function demoSend(viewer: Viewer, tableId: string, payload: SendPayload): DeskMessage {
  const table = state.tables.find((t) => t.id === tableId);
  if (!table || !isParticipant(table, viewer)) throw new Error('Стол не найден');

  const message: DemoMessage = {
    id: `nm-demo-${Date.now().toString(36)}`,
    tableId,
    sender: viewer.id,
    type: payload.files?.length ? 'file' : 'text',
    text: payload.text.trim() || null,
    files: payload.files ?? null,
    requiredClearance: payload.requiredClearance,
    createdAt: new Date().toISOString(),
  };
  state.messages.push(message);
  table.updatedAt = message.createdAt;

  return {
    id: message.id,
    sender: viewer.id,
    senderName: viewer.name ?? 'вы',
    type: message.type,
    text: message.text,
    files: message.files,
    requiredClearance: message.requiredClearance,
    createdAt: message.createdAt,
    visibleDocuments: message.files?.length ?? 0,
  };
}

/** Сбросить демо-данные (кнопка в настройках). */
export function resetDemo(): void {
  state = buildState();
}
