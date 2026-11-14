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
import { Diamond } from './Diamond';
import { allTokenRanges, findInOrder, symbolRanges, type Range } from './tokens';

const LEVEL_RANK: Record<Level, number> = { none: 0, low: 1, medium: 2, high: 3 };
// Hazard-label signal words, loudest first.
const SIGNAL: Record<Level, string> = { high: 'Danger', medium: 'Warning', low: 'Caution', none: 'No known risks' };
const LEVEL_LINE: Record<Level, string> = { high: 'High risk', medium: 'Medium risk', low: 'Low risk', none: '' };

type Highlight = (ranges: Range[]) => void;

// Hover and keyboard focus both highlight; leaving clears.
function hoverProps(onHighlight: Highlight, ranges: () => Range[]) {
  const on = (_e: MouseEvent | FocusEvent) => onHighlight(ranges());
  const off = () => onHighlight([]);
  return { tabIndex: 0, onMouseEnter: on, onMouseLeave: off, onFocus: on, onBlur: off };
}

const present = (r: Range | null): Range[] => (r ? [r] : []);

// Areas from highest level to lowest; ties keep the area order (data loss first).
function byLevel(analysis: FinalAnalysis, areas: readonly Area[]): Area[] {
  return [...areas].sort((x, y) => LEVEL_RANK[analysis.risks[y].level] - LEVEL_RANK[analysis.risks[x].level]);
}

function HazardLabel({ analysis }: { analysis: FinalAnalysis }) {
  const { overall } = analysis;
  // The AI check failed and the rules found nothing: unknown, not safe.
  if (analysis.model_error && overall === 'none') {
    return (
      <div className="hazard unchecked" role="alert">
        <div className="hazard-main">
          <div className="pictos">
            <div className="picto">
              <Diamond area="unknown" level="none" size={72} dashed />
              <span>Unknown</span>
            </div>
          </div>
          <div>
            <p className="signal">Not fully checked</p>
            <p className="headline">{analysis.headline}</p>
          </div>
        </div>
      </div>
    );
  }
  const atRisk = byLevel(analysis, AREAS).filter((a) => analysis.risks[a].level !== 'none');
  return (
    <div className={`hazard ${overall}`} role="alert">
      <div className="hazard-main">
        {atRisk.length > 0 && (
          <div className="pictos">
            {atRisk.map((a) => (
              <div key={a} className="picto">
                <Diamond area={a} level={analysis.risks[a].level} size={72} />
                <span>{AREA_LABEL[a]}</span>
              </div>
            ))}
          </div>
        )}
        <div>
          <p className="signal">{SIGNAL[overall]}</p>
          {LEVEL_LINE[overall] && <p className="level">{LEVEL_LINE[overall]}</p>}
          <p className="headline">{analysis.headline}</p>
        </div>
      </div>
      <ul className="areas" aria-label="Risk by area">
        {AREAS.map((a) => (
          <li key={a} className={`area ${analysis.risks[a].level}`}>
            <Diamond area={a} level={analysis.risks[a].level} size={16} />
            <b>{AREA_LABEL[a]}</b>
            <em>{analysis.risks[a].level}</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FindingItem({ finding, command, onHighlight }: { finding: FinalFinding; command: string; onHighlight: Highlight }) {
  return (
    <div className="finding link" {...hoverProps(onHighlight, () => present(findInOrder(command, [finding.snippet])[0]))}>
      <p className="statement">{finding.reason}</p>
      <p className="source">
        <b>{finding.certainty === 'certain' ? 'Certain.' : 'Possible.'}</b>{' '}
        {finding.source === 'rule' ? 'Found by the rule checks.' : 'Flagged by the AI.'}
      </p>
      {(finding.depends_on || finding.how_to_verify) && (
        <dl className="facts">
          {finding.depends_on && (
            <>
              <dt>Depends on</dt>
              <dd>{finding.depends_on}</dd>
            </>
          )}
          {finding.how_to_verify && (
            <>
              <dt>Check first</dt>
              <dd>{finding.how_to_verify}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

function RisksCard({ analysis, command, onHighlight }: { analysis: FinalAnalysis; command: string; onHighlight: Highlight }) {
  const areas = byLevel(
    analysis,
    AREAS.filter((a) => analysis.risks[a].findings.length > 0),
  );
  // The stripe takes the colour of the worst group.
  const top = analysis.risks[areas[0]].level;
  return (
    <section className={`card risks ${top} reveal`}>
      <h2>What could go wrong</h2>
      {areas.map((a) => {
        const { level, findings } = analysis.risks[a];
        return (
          <div key={a} className="group">
            <h3>
              <Diamond area={a} level={level} size={16} />
              <span className="name">{AREA_LABEL[a]}</span> <em>{level}</em>
            </h3>
            {findings.map((f, i) => (
              <FindingItem key={i} finding={f} command={command} onHighlight={onHighlight} />
            ))}
          </div>
        );
      })}
    </section>
  );
}

function WhatItDoes({ analysis }: { analysis: FinalAnalysis }) {
  const { shell } = analysis;
  return (
    <section className="card summary reveal">
      <h2>What it does</h2>
      <p className="does">{analysis.what_it_does}</p>
      <p className="does-shell">
        {shell.name === 'unknown' ? 'Shell not detected.' : `${SHELL_LABEL[shell.name]}, ${shell.confidence} confidence.`}
      </p>
      {shell.note && <p className="does-shell">{shell.note}</p>}
    </section>
  );
}

function TokenCell({ token, kind }: { token: string; kind: 'command' | 'flag' | 'symbol' }) {
  return (
    <span className="tok-cell">
      <code className={kind}>{token}</code>
      <span className={`ty ${kind}`}>{kind === 'command' ? 'Command' : kind === 'flag' ? 'Flag' : 'Symbol'}</span>
    </span>
  );
}

function CommandRow({ c, command, onHighlight }: { c: GlossaryCommand; command: string; onHighlight: Highlight }) {
  return (
    <li>
      <div className="ln link" {...hoverProps(onHighlight, () => allTokenRanges(command, c.name))}>
        <TokenCell token={c.name} kind="command" />
        <span>
          {c.meaning}
          {c.alias_note && <span className="alias">{c.alias_note}</span>}
        </span>
      </div>
      {c.flags.length > 0 && (
        <ul className="flags">
          {c.flags.map((f, i) => (
            <li key={i}>
              <div className="ln link" {...hoverProps(onHighlight, () => allTokenRanges(command, f.token))}>
                <TokenCell token={f.token} kind="flag" />
                <span>{f.meaning}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Parts({ analysis, command, onHighlight }: { analysis: FinalAnalysis; command: string; onHighlight: Highlight }) {
  const { commands, symbols } = analysis.glossary;
  return (
    <section className="card glossary reveal">
      <h2>Parts</h2>
      <ul className="gl">
        {commands.map((c, i) => (
          <CommandRow key={i} c={c} command={command} onHighlight={onHighlight} />
        ))}
        {symbols.map((s, i) => (
          <li key={`s${i}`} className={i === 0 ? 'sym first' : 'sym'}>
            <div className="ln link" {...hoverProps(onHighlight, () => symbolRanges(command, s.token))}>
              <TokenCell token={s.token} kind="symbol" />
              <span>{s.meaning}</span>
            </div>
          </li>
        ))}
      </ul>
      <p className="tip">Hover or focus a row to find it in your command.</p>
    </section>
  );
}

function StepsTable({ analysis, command, onHighlight }: { analysis: FinalAnalysis; command: string; onHighlight: Highlight }) {
  const { steps } = analysis;
  const ranges = findInOrder(command, steps.map((s) => s.snippet));
  let n = 0;
  return (
    <section className="card sequence reveal">
      <h2>Step by step</h2>
      <table className="steps">
        <thead className="sr-only">
          <tr>
            <th>Step</th>
            <th>Part</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s, i) => {
            const joiner = s.kind === 'joiner';
            if (!joiner) n += 1;
            return (
              <tr key={i} className={joiner ? 'link joiner' : 'link'} {...hoverProps(onHighlight, () => present(ranges[i]))}>
                <td className="num">{joiner ? '' : n}</td>
                <td className="snip">
                  <code>{s.snippet}</code>
                </td>
                <td className="exp">{s.explanation}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

interface Props {
  analysis: FinalAnalysis;
  // The command this result belongs to, for hover matching.
  command: string;
  onHighlight: Highlight;
  onRetry: () => void;
}

// Which cards a result shows, for the bento grid.
export function resultCards(analysis: FinalAnalysis) {
  const ok = analysis.is_command;
  const full = ok && !analysis.model_error;
  return {
    does: ok && (!!analysis.model_error || !!analysis.what_it_does),
    risk: ok && AREAS.some((a) => analysis.risks[a].findings.length > 0),
    parts: full && analysis.glossary.commands.length + analysis.glossary.symbols.length > 0,
    steps: full && analysis.steps.length > 0,
  };
}

// The result as separate grid items: the label, then cards placed by grid area.
export function ResultView({ analysis, command, onHighlight, onRetry }: Props) {
  if (!analysis.is_command) {
    return (
      <section className="card notcmd hazard-slot">
        <p>{analysis.not_a_command_message}</p>
      </section>
    );
  }
  const cards = resultCards(analysis);
  return (
    <>
      <HazardLabel analysis={analysis} />
      {analysis.model_error ? (
        <section className="card note reveal">
          <p>The explanation isn't available right now. These results come from the rule checks only.</p>
          <button type="button" className="btn" onClick={onRetry}>
            Retry
          </button>
        </section>
      ) : (
        cards.does && <WhatItDoes analysis={analysis} />
      )}
      {cards.risk && <RisksCard analysis={analysis} command={command} onHighlight={onHighlight} />}
      {cards.parts && <Parts analysis={analysis} command={command} onHighlight={onHighlight} />}
      {cards.steps && <StepsTable analysis={analysis} command={command} onHighlight={onHighlight} />}
    </>
  );
}
