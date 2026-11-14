import { useEffect, useState, type RefObject } from 'react';
import { CommandView } from './CommandView';
import type { Range, Span } from './tokens';

interface Props {
  // The command card; the strip shows once it has scrolled out of view.
  target: RefObject<HTMLElement | null>;
  text: string;
  spans: Span[];
  highlight: Range[];
}

// A slim copy of the command pinned to the top, so hovering a part far down still shows where it is.
// - Decorative copy: hidden from screen readers, which already have the command card.
export function CommandStrip({ target, text, spans, highlight }: Props) {
  const [away, setAway] = useState(false);

  useEffect(() => {
    const el = target.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setAway(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [target]);

  if (!away) return null;
  return (
    <div className="strip" aria-hidden="true">
      <div className="strip-in">
        <span className="k">Command</span>
        <CommandView text={text} spans={spans} highlight={highlight} scanIndex={null} words={[]} />
      </div>
    </div>
  );
}
