// components/Avatar.tsx — инициалы в цветном круге.
//
// presence — ободок статуса вокруг аватара: зелёный «в столе» (или пишет),
// серый — не в столе. Ободок рисуется тенью, размеры круга не меняются.

import type { CSSProperties } from 'react';
import { avatarColor, initials } from '../desk/format';

export type AvatarPresence = 'in' | 'out' | 'none';

export default function Avatar({
  name,
  size = 32,
  className = '',
  presence = 'none',
  typing = false,
}: {
  name: string;
  size?: number;
  className?: string;
  presence?: AvatarPresence;
  /** Кольцо пульсирует, пока участник пишет. */
  typing?: boolean;
}) {
  const ring =
    presence === 'in'
      ? 'var(--ok)'
      : presence === 'out'
        ? 'color-mix(in srgb, var(--ink-faint) 55%, transparent)'
        : 'transparent';

  return (
    <span
      className={`avatar ${presence !== 'none' ? 'avatar--ringed' : ''} ${typing ? 'is-typing' : ''} ${className}`}
      style={{
        width: size,
        height: size,
        background: avatarColor(name),
        fontSize: Math.max(9, Math.round(size * 0.32)),
        '--avatar-ring': ring,
        '--avatar-ring-w': '1px',
      } as CSSProperties}
      title={presence === 'none' ? name : `${name} · ${presence === 'in' ? 'в столе' : 'не в столе'}`}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
