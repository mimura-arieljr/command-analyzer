// Which result cards are on the page.
export interface Present {
  does: boolean;
  risk: boolean;
  parts: boolean;
  steps: boolean;
}

// grid-template-areas for the bento layout, wide and narrow.
// - Wide: command and label on top, parts on the left, summary then risks on the right, steps across the bottom.
// - Rows exist only for cards that are present, so a missing card leaves no gap and the grid stays a rectangle.
export function bentoAreas(p: Present): { wide: string; narrow: string } {
  const right = [p.does && 'does', p.risk && 'risk'].filter(Boolean) as string[];
  const rows = ['cmd label'];
  if (p.parts) rows.push(...(right.length ? right.map((r) => `parts ${r}`) : ['parts parts']));
  else rows.push(...right.map((r) => `${r} ${r}`));
  if (p.steps) rows.push('steps steps');
  const narrow = ['cmd', 'label', ...right, p.parts && 'parts', p.steps && 'steps'].filter(Boolean);
  return {
    wide: rows.map((r) => `'${r}'`).join(' '),
    narrow: narrow.map((r) => `'${r}'`).join(' '),
  };
}
