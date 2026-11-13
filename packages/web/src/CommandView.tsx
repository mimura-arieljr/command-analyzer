import type { Range, Span } from './tokens';

interface Props {
  text: string;
  spans: Span[];
  highlight: Range[];
  // Index into `words` of the word being scanned, or null.
  scanIndex: number | null;
  words: Range[];
  onEdit?: () => void;
}

interface Piece {
  start: number;
  end: number;
  kind: Span['kind'];
  hl: boolean;
  scan: boolean;
}

const overlaps = (a: number, b: number, r: Range) => a < r[1] && b > r[0];

// Cut spans at highlight and scan edges so each piece is wholly in or out.
function pieces(text: string, spans: Span[], highlight: Range[], scan: Range | null): Piece[] {
  const base = spans.length ? spans : [{ start: 0, end: text.length, kind: 'plain' as const }];
  const cuts = new Set<number>();
  for (const r of [...highlight, ...(scan ? [scan] : [])]) {
    cuts.add(r[0]);
    cuts.add(r[1]);
  }
  const out: Piece[] = [];
  for (const s of base) {
    const inner = [...cuts].filter((c) => c > s.start && c < s.end).sort((a, b) => a - b);
    const edges = [s.start, ...inner, s.end];
    for (let i = 0; i < edges.length - 1; i++) {
      const [a, b] = [edges[i], edges[i + 1]];
      out.push({
        start: a,
        end: b,
        kind: s.kind,
        hl: highlight.some((r) => overlaps(a, b, r)),
        scan: !!scan && overlaps(a, b, scan),
      });
    }
  }
  return out;
}

export function CommandView({ text, spans, highlight, scanIndex, words, onEdit }: Props) {
  const scan = scanIndex !== null ? (words[scanIndex] ?? null) : null;
  const editable = !!onEdit;
  return (
    <div
      className={editable ? 'cmdview editable' : 'cmdview'}
      aria-label={editable ? 'Command. Select to edit.' : 'Command being analyzed'}
      role={editable ? 'button' : undefined}
      tabIndex={editable ? 0 : undefined}
      onClick={onEdit}
      onKeyDown={(e) => {
        if (editable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onEdit();
        }
      }}
    >
      {pieces(text, spans, highlight, scan).map((p) => {
        const cls = ['tok', p.kind, p.hl && 'hl', p.scan && 'scan'].filter(Boolean).join(' ');
        return (
          <span key={p.start} className={cls}>
            {text.slice(p.start, p.end)}
          </span>
        );
      })}
    </div>
  );
}
