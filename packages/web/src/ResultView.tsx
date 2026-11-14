import type { FocusEvent, MouseEvent } from 'react';
import {
  AREA_LABEL,
  AREAS,
  type Area,
  type FinalAnalysis,
  type FinalFinding,
  type GlossaryCommand,
  type Level,
} from '@ca/core/types';
import { SHELL_LABEL } from './CommandForm';
import { allTokenRanges, findInOrder, symbolRanges, type Range } from './tokens';

const LEVEL_BARS: Record<Level, number> = { none: 0, low: 1, medium: 2, high: 3 };
const LEVEL_LABEL: Record<Level, string> = { none: 'None', low: 'Low', medium: 'Medium', high: 'High' };
const LEVEL_RANK = LEVEL_BARS;

type Highlight = (ranges: Range[]) => void;

// Hover and keyboard focus both highlight; leaving clears.
function hoverProps(onHighlight: Highlight, ranges: () => Range[]) {
  const on = (_e: MouseEvent | FocusEvent) => onHighlight(ranges());
  const off = () => onHighlight([]);
  return { tabIndex: 0, onMouseEnter: on, onMouseLeave: off, onFocus: on, onBlur: off };
}

const present = (r: Range | null): Range[] => (r ? [r] : []);

// Three rising bars, filled up to the level; the label stays the accessible text.
export function Meter({ level }: { level: Level }) {
  return (
    <span className="meter" aria-hidden="true">
      {[1, 2, 3].map((n) => (
        <i key={n} className={n <= LEVEL_BARS[level] ? 'on' : undefined} />
      ))}
    </span>
  );
}

function Badge({ level }: { level: Level }) {
  return (
    <span className={`badge ${level}`}>
      <Meter level={level} />
      {LEVEL_LABEL[level]}
    </span>
  );
}

function VerdictBanner({ analysis }: { analysis: FinalAnalysis }) {
  const { overall } = analysis;
  // The AI check failed and the rules found nothing: unknown, not safe.
  const unchecked = !!analysis.model_error && overall === 'none';
  if (unchecked) {
    return (
      <div className="banner unchecked rv" role="alert" style={{ '--i': 0 } as React.CSSProperties}>
        <div className="top">
          <span className="tag">Not fully checked</span>
          <p>{analysis.headline}</p>
        </div>
      </div>
    );
  }
  return (
    <div className={`banner ${overall} rv`} role="alert" style={{ '--i': 0 } as React.CSSProperties}>
      <div className="top">
        <span className={overall === 'high' ? 'tag pulse' : 'tag'}>
          <Meter level={overall} />
          Risk: {overall}
        </span>
        <p>{analysis.headline}</p>
      </div>
      <ul className="areas" aria-label="Risk by area">
        {AREAS.map((a) => (
          <li key={a} className={`area ${analysis.risks[a].level}`}>
            <Meter level={analysis.risks[a].level} />
            {AREA_LABEL[a]}
            <span className="sr-only">: {analysis.risks[a].level}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FindingItem({ finding, command, onHighlight }: { finding: FinalFinding; command: string; onHighlight: Highlight }) {
  const certain = finding.certainty === 'certain';
  return (
    <div
      className={`finding ${finding.certainty}`}
      {...hoverProps(onHighlight, () => present(findInOrder(command, [finding.snippet])[0]))}
    >
      <div className="row">
        <span className="tag-s">{certain ? 'Certain' : 'Possible'}</span>
        <span className={finding.source === 'rule' ? 'tag-s rule' : 'tag-s'}>{finding.source === 'rule' ? 'Rule check' : 'AI'}</span>
      </div>
      {finding.reason}
      {(finding.depends_on || finding.how_to_verify) && (
        <dl>
          {finding.depends_on && (
            <div>
              <dt>Depends on:</dt> <dd>{finding.depends_on}</dd>
            </div>
          )}
          {finding.how_to_verify && (
            <div>
              <dt>Check it:</dt> <dd>{finding.how_to_verify}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

// Areas with findings, highest level first; ties keep the area order (data loss first).
function cardAreas(analysis: FinalAnalysis): Area[] {
  return AREAS.filter((a) => analysis.risks[a].findings.length > 0).sort(
    (x, y) => LEVEL_RANK[analysis.risks[y].level] - LEVEL_RANK[analysis.risks[x].level],
  );
}

function RiskCard({ area, analysis, command, onHighlight, index }: { area: Area; analysis: FinalAnalysis; command: string; onHighlight: Highlight; index: number }) {
  const { level, findings } = analysis.risks[area];
  return (
    <div className="card risk-card rv" style={{ '--i': index } as React.CSSProperties}>
      <div className="cat-head">
        <h2>{AREA_LABEL[area]}</h2>
        <Badge level={level} />
      </div>
      {findings.map((f, i) => (
        <FindingItem key={i} finding={f} command={command} onHighlight={onHighlight} />
      ))}
    </div>
  );
}

function WhatItDoes({ analysis, index }: { analysis: FinalAnalysis; index: number }) {
  const { shell } = analysis;
  return (
    <div className="card rv" style={{ '--i': index } as React.CSSProperties}>
      <h2>What it does</h2>
      <div className="meta">
        {shell.name !== 'unknown' && <span className="chip accent">{SHELL_LABEL[shell.name]}</span>}
        <span className="chip">Confidence: {shell.confidence}</span>
      </div>
      {shell.note && <p className="muted note-line">{shell.note}</p>}
      <p>{analysis.what_it_does}</p>
    </div>
  );
}

function TypeTag({ kind }: { kind: 'cmd' | 'flag' | 'sym' }) {
  return <span className={`ty ${kind}`}>{kind === 'cmd' ? 'Command' : kind === 'flag' ? 'Flag' : 'Symbol'}</span>;
}

function CommandRow({ c, command, onHighlight }: { c: GlossaryCommand; command: string; onHighlight: Highlight }) {
  return (
    <li>
      <div className="ln" {...hoverProps(onHighlight, () => allTokenRanges(command, c.name))}>
        <TypeTag kind="cmd" />
        <span>
          <code className="c">{c.name}</code> {c.meaning}
          {c.alias_note && <span className="alias">{c.alias_note}</span>}
        </span>
      </div>
      {c.flags.length > 0 && (
        <ul>
          {c.flags.map((f, i) => (
            <li key={i}>
              <div className="ln" {...hoverProps(onHighlight, () => allTokenRanges(command, f.token))}>
                <TypeTag kind="flag" />
                <span>
                  <code className="f">{f.token}</code> {f.meaning}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Glossary({ analysis, command, onHighlight, index }: { analysis: FinalAnalysis; command: string; onHighlight: Highlight; index: number }) {
  const { commands, symbols } = analysis.glossary;
  return (
    <div className="card rv" style={{ '--i': index } as React.CSSProperties}>
      <h2>Commands, flags and symbols</h2>
      <ul className="gl">
        {commands.map((c, i) => (
          <CommandRow key={i} c={c} command={command} onHighlight={onHighlight} />
        ))}
        {symbols.map((s, i) => (
          <li key={`s${i}`}>
            <div className="ln" {...hoverProps(onHighlight, () => symbolRanges(command, s.token))}>
              <TypeTag kind="sym" />
              <span>
                <code className="s">{s.token}</code> {s.meaning}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <p className="tip">Hover or focus a row to find it in your command.</p>
    </div>
  );
}

function StepsTable({ analysis, command, onHighlight, index }: { analysis: FinalAnalysis; command: string; onHighlight: Highlight; index: number }) {
  const { steps } = analysis;
  const ranges = findInOrder(command, steps.map((s) => s.snippet));
  let n = 0;
  return (
    <div className="card rv" style={{ '--i': index } as React.CSSProperties}>
      <h2>Step by step</h2>
      <table className="steps">
        <thead>
          <tr>
            <th className="num">
              <span className="sr-only">Step</span>
            </th>
            <th className="part">Part</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s, i) => {
            const hover = hoverProps(onHighlight, () => present(ranges[i]));
            if (s.kind === 'joiner') {
              return (
                <tr key={i} className="joiner" {...hover}>
                  <td className="num"></td>
                  <td colSpan={2}>
                    <code>{s.snippet}</code> {s.explanation}
                  </td>
                </tr>
              );
            }
            n += 1;
            return (
              <tr key={i} {...hover}>
                <td className="num">{n}</td>
                <td>
                  <code>{s.snippet}</code>
                </td>
                <td>{s.explanation}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface Props {
  analysis: FinalAnalysis;
  // The command this result belongs to, for hover matching.
  command: string;
  onHighlight: Highlight;
  onRetry: () => void;
}

export function ResultView({ analysis, command, onHighlight, onRetry }: Props) {
  if (!analysis.is_command) {
    return (
      <div className="card rv" style={{ '--i': 0 } as React.CSSProperties}>
        <p>{analysis.not_a_command_message}</p>
      </div>
    );
  }
  const areas = cardAreas(analysis);
  let i = 1 + areas.length;
  const hasGlossary = analysis.glossary.commands.length + analysis.glossary.symbols.length > 0;
  return (
    <>
      <VerdictBanner analysis={analysis} />
      {areas.map((a, k) => (
        <RiskCard key={a} area={a} analysis={analysis} command={command} onHighlight={onHighlight} index={k + 1} />
      ))}
      {analysis.model_error ? (
        <div className="card note rv" style={{ '--i': i } as React.CSSProperties}>
          <p>The explanation isn't available right now. These results come from the rule checks only.</p>
          <button type="button" className="btn-ghost small" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : (
        <>
          {analysis.what_it_does && <WhatItDoes analysis={analysis} index={i++} />}
          {hasGlossary && <Glossary analysis={analysis} command={command} onHighlight={onHighlight} index={i++} />}
          {analysis.steps.length > 0 && <StepsTable analysis={analysis} command={command} onHighlight={onHighlight} index={i++} />}
        </>
      )}
    </>
  );
}
