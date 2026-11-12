import React, { useState } from 'react';
import { motion } from 'framer-motion';

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  isOnline?: boolean;
  showPresence?: boolean;
  className?: string;
}

const SIZE_MAP = {
  xs: { ring: 'w-7 h-7',    text: 'text-[10px]', dot: 'w-2 h-2',   ring2: 'ring-[1.5px]' },
  sm: { ring: 'w-9 h-9',    text: 'text-xs',      dot: 'w-2.5 h-2.5', ring2: 'ring-2' },
  md: { ring: 'w-10 h-10',  text: 'text-sm',      dot: 'w-2.5 h-2.5', ring2: 'ring-2' },
  lg: { ring: 'w-12 h-12',  text: 'text-base',    dot: 'w-3 h-3',   ring2: 'ring-2' },
  xl: { ring: 'w-20 h-20',  text: 'text-xl',      dot: 'w-4 h-4',   ring2: 'ring-2' },
};

export function Avatar({
  src,
  name,
  size = 'md',
  isOnline = false,
  showPresence = false,
  className = '',
}: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const s = SIZE_MAP[size];

  const initials = (name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

  return (
    <div className={`relative inline-flex shrink-0 select-none ${className}`}>
      <div
        className={`${s.ring} rounded-full overflow-hidden flex items-center justify-center font-semibold bg-gradient-to-br from-slate-800 to-slate-900 text-cyan-200 border border-white/8`}
      >
        {src && !imgFailed ? (
          <img
            src={src}
            alt={`${name} avatar`}
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className={s.text}>{initials || 'U'}</span>
        )}
      </div>

      {showPresence && (
        <span
          title={isOnline ? 'Online' : 'Offline'}
          aria-label={isOnline ? 'Online' : 'Offline'}
          className={`absolute bottom-0 right-0 ${s.dot} rounded-full ${s.ring2} ring-base-100 ${
            isOnline ? 'bg-emerald-400' : 'bg-slate-500'
          } ${isOnline ? 'online-pulse' : ''}`}
        />
      )}
    </div>
  );
}

/* ─── Animated avatar group (for group member previews) ─────────────────── */
export function AvatarGroup({
  users,
  max = 4,
  size = 'sm',
}: {
  users: Array<{ id: string; avatarUrl?: string | null; displayName: string }>;
  max?: number;
  size?: AvatarProps['size'];
}) {
  const visible = users.slice(0, max);
  const overflow = users.length - max;
  const s = SIZE_MAP[size];

  return (
    <div className="flex items-center">
      {visible.map((u, i) => (
        <motion.div
          key={u.id}
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.05 }}
          className="-ml-2 first:ml-0"
          style={{ zIndex: visible.length - i }}
        >
          <Avatar src={u.avatarUrl} name={u.displayName} size={size} className="ring-2 ring-base-100" />
        </motion.div>
      ))}
      {overflow > 0 && (
        <div className={`-ml-2 ${s.ring} rounded-full bg-base-300 border border-base-100/20 flex items-center justify-center ${s.text} font-semibold text-base-content/70`} style={{ zIndex: 0 }}>
          +{overflow}
        </div>
      )}
    </div>
  );
}
