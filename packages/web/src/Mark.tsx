// A terminal prompt in a rounded square; the block is the cursor.
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="24" height="22" rx="5" stroke="currentColor" strokeWidth="2" />
      <path d="M8 10.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="14" y="16.2" width="6" height="2.6" rx="0.5" fill="var(--cyan)" />
    </svg>
  );
}
