// components/Avatar.tsx — инициалы в цветном круге.

import { avatarColor, initials } from '../desk/format';

export default function Avatar({
  name,
  size = 32,
  className = '',
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`avatar ${className}`}
      style={{
        width: size,
        height: size,
        background: avatarColor(name),
        fontSize: Math.max(9, Math.round(size * 0.32)),
      }}
      title={name}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
