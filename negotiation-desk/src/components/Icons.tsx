// components/Icons.tsx — тонкие inline-иконки без внешней библиотеки.
// Все рисуются currentColor: цвет задаёт кнопка/строка, иконки тему не знают.

import type { SVGProps } from 'react';

export type IconName =
  | 'search'
  | 'settings'
  | 'refresh'
  | 'back'
  | 'send'
  | 'users'
  | 'close'
  | 'check'
  | 'file'
  | 'link'
  | 'phone'
  | 'phone-off'
  | 'download'
  | 'plug'
  | 'install'
  | 'spark'
  | 'chevron'
  | 'lock'
  | 'info'
  | 'building';

export function Icon({
  name,
  size = 18,
  ...props
}: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...props,
  };

  switch (name) {
    case 'search':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.6-3.6" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h.08A1.7 1.7 0 0 0 10 3.05V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.08a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" />
        </svg>
      );
    case 'refresh':
      return (
        <svg {...common}>
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
      );
    case 'back':
      return (
        <svg {...common}>
          <path d="M19 12H5" />
          <path d="m11 18-6-6 6-6" />
        </svg>
      );
    case 'send':
      return (
        <svg {...common}>
          <path d="m22 2-7 20-4-9-9-4Z" />
          <path d="M22 2 11 13" />
        </svg>
      );
    case 'users':
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'close':
      return (
        <svg {...common}>
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path d="m4 12.5 5 5L20 6.5" />
        </svg>
      );
    case 'file':
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
          <path d="M14 2v6h6" />
          <path d="M9 13h6M9 17h4" />
        </svg>
      );
    case 'link':
      return (
        <svg {...common}>
          <path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
          <path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1" />
        </svg>
      );
    case 'phone':
      return (
        <svg {...common}>
          <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" />
        </svg>
      );
    case 'phone-off':
      return (
        <svg {...common}>
          <path d="M10.7 13.3a16 16 0 0 0 3.4 2.6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9" />
          <path d="m2 2 20 20" />
        </svg>
      );
    case 'download':
      return (
        <svg {...common}>
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
      );
    case 'plug':
      return (
        <svg {...common}>
          <path d="M9 2v6M15 2v6" />
          <path d="M6 8h12v3a6 6 0 0 1-12 0Z" />
          <path d="M12 17v5" />
        </svg>
      );
    case 'install':
      return (
        <svg {...common}>
          <rect x="7" y="2" width="10" height="20" rx="2.2" />
          <path d="M11 18h2" />
          <path d="M12 7v6" />
          <path d="m9.5 10.5 2.5 2.5 2.5-2.5" />
        </svg>
      );
    case 'spark':
      return (
        <svg {...common}>
          <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z" />
          <path d="M19 16v4M17 18h4" />
        </svg>
      );
    case 'chevron':
      return (
        <svg {...common}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      );
    case 'lock':
      return (
        <svg {...common}>
          <rect x="4" y="10" width="16" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
      );
    case 'info':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
      );
    case 'building':
      return (
        <svg {...common}>
          <path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
          <path d="M16 9h2a2 2 0 0 1 2 2v10" />
          <path d="M2 21h20" />
          <path d="M8 7h4M8 11h4M8 15h4" />
        </svg>
      );
    default:
      return null;
  }
}

/**
 * Знак приложения: круглый стол, места участников и жёлтая точка сигнала.
 * Тот же рисунок лежит в public/icons/icon.svg — иконка PWA и шапка совпадают.
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label="Стол переговоров Simonix"
    >
      <defs>
        <linearGradient id="desk-brand-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#24558f" />
          <stop offset="1" stopColor="#0e1d31" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill="url(#desk-brand-bg)" />
      <circle
        cx="256"
        cy="256"
        r="146"
        fill="none"
        stroke="#f4f1ea"
        strokeWidth="18"
        opacity="0.92"
      />
      <circle cx="256" cy="256" r="44" fill="#f4f1ea" />
      <circle cx="134" cy="134" r="20" fill="#f4f1ea" />
      <circle cx="378" cy="134" r="20" fill="#fde047" />
      <circle cx="134" cy="378" r="20" fill="#f4f1ea" />
      <circle cx="378" cy="378" r="20" fill="#f4f1ea" />
    </svg>
  );
}

/** Индикатор сигнала: полый кружок, как в шапке кабинета. */
export function SignalDot({
  signal,
  size = 10,
  className = '',
}: {
  signal: 'none' | 'team' | 'client';
  size?: number;
  className?: string;
}) {
  const title =
    signal === 'client'
      ? 'пишет клиент'
      : signal === 'team'
        ? 'пишут свои или партнёры'
        : 'нового нет';
  return (
    <span
      className={`signal-dot signal-dot--${signal} ${className}`}
      style={{ width: size, height: size }}
      title={title}
      aria-label={title}
    />
  );
}
