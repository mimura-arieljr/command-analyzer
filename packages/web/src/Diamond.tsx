import type { Area, Level } from '@ca/core/types';

// Hazard-label diamonds: the border colour is the level.
// - Large ones (pictograms) hold a plain glyph for the area.
// - Small ones are filled for high, outlined for medium and low, hollow grey for none.

const GLYPH: Record<Area | 'unknown', string> = {
  data_loss: 'M24 22h16l-1.5 22h-13z M21 22h22 M28 22v-3h8v3 M29 27v12 M35 27v12',
  system_changes:
    'M32 27a5 5 0 1 0 0 10a5 5 0 1 0 0-10z M32 20v4 M32 40v4 M20 32h4 M40 32h4 M23.5 23.5l2.8 2.8 M37.7 37.7l2.8 2.8 M23.5 40.5l2.8-2.8 M37.7 26.3l2.8-2.8',
  network: 'M32 21a11 11 0 1 0 0 22a11 11 0 1 0 0-22z M21 32h22 M32 21c-6 7-6 15 0 22 M32 21c6 7 6 15 0 22',
  elevated_rights: 'M32 19l11 4v8c0 7-5 12-11 14-6-2-11-7-11-14v-8z M27.5 32l3 3 6-6',
  hidden_behaviour: 'M20 32c4-6 8-8 12-8s8 2 12 8c-4 6-8 8-12 8s-8-2-12-8z M22 22l20 20 M32 29a3 3 0 1 0 0 6a3 3 0 1 0 0-6z',
  unknown: 'M27.5 27a4.5 4.5 0 1 1 6.5 4c-1.5.8-2 1.8-2 3.5 M32 40v.5',
};

interface Props {
  area: Area | 'unknown';
  level: Level;
  size: number;
  dashed?: boolean;
}

export function Diamond({ area, level, size, dashed = false }: Props) {
  const big = size > 30;
  const fill = big ? 'var(--sheet)' : level === 'high' ? `var(--lvl-${level})` : level === 'none' ? 'transparent' : 'var(--sheet)';
  return (
    <svg className={`diamond ${level}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path
        d="M32 4 60 32 32 60 4 32Z"
        fill={fill}
        stroke={`var(--lvl-${level})`}
        strokeWidth={big ? 5 : 7}
        strokeLinejoin="round"
        strokeDasharray={dashed ? '7 6' : undefined}
      />
      {big && <path d={GLYPH[area]} fill="none" stroke="var(--ink)" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}
