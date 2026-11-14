import type { ShellFamily } from './types';

// A light, quote-aware lexer. Not a full shell parser.

export interface Word {
  // Text with quotes and escapes removed.
  value: string;
  // Exact text from the input.
  raw: string;
  start: number;
  end: number;
  quoted: boolean;
}

export interface Redirect {
  op: string;
  target: string;
}

export interface Segment {
  family: ShellFamily;
  words: Word[];
  start: number;
  end: number;
  raw: string;
  joinerBefore: string | null;
  joinerAfter: string | null;
  redirects: Redirect[];
  // True for command text found inside another command ($(...), bash -c "...", and so on).
  nested: boolean;
}

interface Region {
  start: number;
  end: number;
  family: ShellFamily;
  // Unescaped command text to lex instead of the input, for escaped quotes inside nested commands.
  // - Segments found in it report `anchor` (a span of the input) as their start and end, so snippets stay exact.
  text?: string;
  anchor?: { start: number; end: number };
}

const MAX_DEPTH = 8;

export function lex(text: string, family: ShellFamily): Segment[] {
  const out: Segment[] = [];
  lexRegion(text, { start: 0, end: text.length, family }, false, out, 0);
  return out;
}

function lexRegion(text: string, region: Region, nested: boolean, out: Segment[], depth: number): void {
  if (depth > MAX_DEPTH) return;
  const src = region.text ?? text;
  const scanner = new Scanner(src, region, nested);
  const segs = scanner.run();
  const anchor = region.anchor;
  out.push(...(anchor ? segs.map((s) => ({ ...s, start: anchor.start, end: anchor.end })) : segs));
  const inner = [...scanner.nestedRegions, ...segs.flatMap((s) => invocationRegions(s, src))];
  for (const r of inner) {
    const carried = !anchor || r.text ? r : { ...r, text: src, anchor };
    lexRegion(text, carried, true, out, depth + 1);
  }
}

const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\r';

class Scanner {
  readonly nestedRegions: Region[] = [];
  private readonly fam: ShellFamily;
  private readonly end: number;
  private i: number;
  private segs: Segment[] = [];
  private words: Word[] = [];
  private redirects: Redirect[] = [];
  private segStart = -1;
  private segEnd = -1;
  private joinerBefore: string | null = null;
  private wStart = -1;
  private wVal = '';
  private wQuoted = false;
  private pending: { op: string; start: number } | null = null;
  private heredocs: { delim: string; strip: boolean }[] = [];

  constructor(
    private readonly text: string,
    region: Region,
    private readonly nested: boolean,
  ) {
    this.fam = region.family;
    this.i = region.start;
    this.end = region.end;
  }

  run(): Segment[] {
    while (this.i < this.end) {
      if (this.fam === 'unix') this.stepUnix();
      else if (this.fam === 'powershell') this.stepPowerShell();
      else this.stepCmd();
    }
    this.endWord(this.end);
    this.endSegment(null);
    return this.segs;
  }

  // ---- shared helpers ----

  private ch(at: number): string {
    return at < this.end ? this.text[at] : '';
  }

  private startWord(at: number): void {
    if (this.wStart < 0) this.wStart = at;
  }

  private extend(a: number, b: number): void {
    if (this.segStart < 0 || a < this.segStart) this.segStart = a;
    if (b > this.segEnd) this.segEnd = b;
  }

  private endWord(at: number): void {
    if (this.wStart < 0) return;
    const w: Word = {
      value: this.wVal,
      raw: this.text.slice(this.wStart, at),
      start: this.wStart,
      end: at,
      quoted: this.wQuoted,
    };
    if (this.pending) {
      this.redirects.push({ op: this.pending.op, target: w.value });
      this.extend(this.pending.start, at);
      if (this.fam === 'unix' && /^\d*<<-?$/.test(this.pending.op)) {
        this.heredocs.push({ delim: w.value, strip: this.pending.op.endsWith('-') });
      }
      this.pending = null;
    } else {
      this.words.push(w);
      this.extend(w.start, w.end);
    }
    this.wStart = -1;
    this.wVal = '';
    this.wQuoted = false;
  }

  private endSegment(joiner: string | null): void {
    if (this.pending) {
      this.redirects.push({ op: this.pending.op, target: '' });
      this.extend(this.pending.start, this.pending.start + this.pending.op.length);
      this.pending = null;
    }
    if (this.words.length > 0 || this.redirects.length > 0) {
      this.segs.push({
        family: this.fam,
        words: this.words,
        start: this.segStart,
        end: this.segEnd,
        raw: this.text.slice(this.segStart, this.segEnd),
        joinerBefore: this.joinerBefore,
        joinerAfter: joiner,
        redirects: this.redirects,
        nested: this.nested,
      });
      this.joinerBefore = joiner;
    } else if (joiner !== null) {
      this.joinerBefore = joiner;
    }
    this.words = [];
    this.redirects = [];
    this.segStart = -1;
    this.segEnd = -1;
  }

  private addNested(start: number, end: number, family: ShellFamily = this.fam): void {
    if (end > start) this.nestedRegions.push({ start, end, family });
  }

  // Index of the bracket closing the one at `open`, quote-aware; `end` if unclosed.
  private matchBracket(open: number): number {
    const o = this.text[open];
    const c = o === '(' ? ')' : o === '{' ? '}' : ']';
    let depth = 0;
    for (let j = open; j < this.end; j++) {
      const x = this.text[j];
      if (x === "'" || x === '"') {
        const close = this.text.indexOf(x, j + 1);
        if (close < 0 || close >= this.end) return this.end;
        j = close;
        continue;
      }
      if (x === o) depth++;
      else if (x === c && --depth === 0) return j;
    }
    return this.end;
  }

  private indexOf(s: string, from: number): number {
    const k = this.text.indexOf(s, from);
    return k < 0 || k >= this.end ? this.end : k;
  }

  private skipToLineEnd(): void {
    this.i = this.indexOf('\n', this.i);
  }

  private newline(): void {
    this.endWord(this.i);
    this.endSegment('\n');
    this.i++;
    if (this.heredocs.length > 0) this.skipHeredocs();
  }

  private skipHeredocs(): void {
    while (this.heredocs.length > 0 && this.i < this.end) {
      const { delim, strip } = this.heredocs[0];
      const lineEnd = this.indexOf('\n', this.i);
      const line = this.text.slice(this.i, lineEnd);
      this.i = Math.min(lineEnd + 1, this.end);
      if ((strip ? line.replace(/^\t+/, '') : line).trim() === delim) this.heredocs.shift();
    }
  }

  // At `>` or `<` (or `&>` in unix).
  private redirect(): void {
    const t = this.text;
    let opStart = this.i;
    let op = '';
    const adjacent = this.wStart >= 0 && this.wStart + this.wVal.length === this.i && !this.wQuoted;
    if (adjacent && /^(\d+|\*)$/.test(this.wVal)) {
      op = this.wVal;
      opStart = this.wStart;
      this.wStart = -1;
      this.wVal = '';
    } else {
      this.endWord(this.i);
    }
    if (t[this.i] === '&') {
      op += '&';
      this.i++;
    }
    const c = t[this.i];
    op += c;
    this.i++;
    if (c === '<' && this.ch(this.i) === '<') {
      op += '<';
      this.i++;
      if (this.ch(this.i) === '<') {
        op += '<';
        this.i++;
      } else if (this.ch(this.i) === '-') {
        op += '-';
        this.i++;
      }
    } else if (c === '>' && (this.ch(this.i) === '>' || this.ch(this.i) === '|')) {
      op += this.ch(this.i);
      this.i++;
    }
    if (this.ch(this.i) === '&') {
      let j = this.i + 1;
      while (j < this.end && /[\d-]/.test(t[j])) j++;
      if (j > this.i + 1) {
        const target = t.slice(this.i, j);
        this.redirects.push({ op: op + target, target });
        this.extend(opStart, j);
        this.i = j;
        return;
      }
    }
    this.pending = { op, start: opStart };
  }

  // ---- unix (bash, zsh, sh) ----

  private stepUnix(): void {
    const t = this.text;
    const c = t[this.i];
    const n = this.ch(this.i + 1);
    if (c === '\\') {
      if (n === '\n') {
        this.i += 2;
        return;
      }
      this.startWord(this.i);
      this.wVal += n;
      this.i += 2;
      return;
    }
    if (isSpace(c)) {
      this.endWord(this.i);
      this.i++;
      return;
    }
    if (c === '\n') return this.newline();
    if (c === '#' && this.wStart < 0) return this.skipToLineEnd();
    if (c === "'") {
      this.startWord(this.i);
      this.wQuoted = true;
      const close = this.indexOf("'", this.i + 1);
      this.wVal += t.slice(this.i + 1, close);
      this.i = close + 1;
      return;
    }
    if (c === '"') return this.unixDouble();
    if (c === '$' && n === '(') {
      this.startWord(this.i);
      const close = this.matchBracket(this.i + 1);
      if (this.ch(this.i + 2) !== '(') this.addNested(this.i + 2, close);
      this.wVal += t.slice(this.i, close + 1);
      this.i = close + 1;
      return;
    }
    if (c === '`') {
      this.startWord(this.i);
      const close = this.indexOf('`', this.i + 1);
      this.addNested(this.i + 1, close);
      this.wVal += t.slice(this.i, close + 1);
      this.i = close + 1;
      return;
    }
    if ((c === '<' || c === '>') && n === '(') {
      this.startWord(this.i);
      const close = this.matchBracket(this.i + 1);
      this.addNested(this.i + 2, close);
      this.wVal += t.slice(this.i, close + 1);
      this.i = close + 1;
      return;
    }
    if (c === '|') {
      this.endWord(this.i);
      if (n === '|') {
        this.endSegment('||');
        this.i += 2;
      } else {
        this.endSegment('|');
        this.i += n === '&' ? 2 : 1;
      }
      return;
    }
    if (c === '&') {
      if (n === '&') {
        this.endWord(this.i);
        this.endSegment('&&');
        this.i += 2;
        return;
      }
      if (n === '>') return this.redirect();
      this.endWord(this.i);
      this.endSegment('&');
      this.i++;
      return;
    }
    if (c === ';') {
      this.endWord(this.i);
      this.endSegment(';');
      this.i += n === ';' ? 2 : 1;
      return;
    }
    if (c === '(' || c === ')') {
      this.endWord(this.i);
      this.endSegment(null);
      this.i++;
      return;
    }
    if (c === '>' || c === '<') return this.redirect();
    this.startWord(this.i);
    this.wVal += c;
    this.i++;
  }

  private unixDouble(): void {
    const t = this.text;
    this.startWord(this.i);
    this.wQuoted = true;
    this.i++;
    while (this.i < this.end && t[this.i] !== '"') {
      const x = t[this.i];
      const y = this.ch(this.i + 1);
      if (x === '\\' && '"\\$`\n'.includes(y) && y !== '') {
        if (y !== '\n') this.wVal += y;
        this.i += 2;
        continue;
      }
      if (x === '$' && y === '(') {
        const close = this.matchBracket(this.i + 1);
        if (this.ch(this.i + 2) !== '(') this.addNested(this.i + 2, close);
        this.wVal += t.slice(this.i, close + 1);
        this.i = close + 1;
        continue;
      }
      if (x === '`') {
        const close = this.indexOf('`', this.i + 1);
        this.addNested(this.i + 1, close);
        this.wVal += t.slice(this.i, close + 1);
        this.i = close + 1;
        continue;
      }
      this.wVal += x;
      this.i++;
    }
    this.i++;
  }

  // ---- PowerShell ----

  private stepPowerShell(): void {
    const t = this.text;
    const c = t[this.i];
    const n = this.ch(this.i + 1);
    if (c === '`') {
      if (n === '\n') {
        this.i += 2;
        return;
      }
      if (n === '\r' && this.ch(this.i + 2) === '\n') {
        this.i += 3;
        return;
      }
      this.startWord(this.i);
      this.wVal += n;
      this.i += 2;
      return;
    }
    if (isSpace(c)) {
      this.endWord(this.i);
      this.i++;
      return;
    }
    if (c === '\n') return this.newline();
    if (c === '<' && n === '#') {
      this.endWord(this.i);
      this.i = Math.min(this.indexOf('#>', this.i + 2) + 2, this.end);
      return;
    }
    if (c === '#' && this.wStart < 0) return this.skipToLineEnd();
    if (c === '@' && (n === "'" || n === '"') && /^\r?\n/.test(t.slice(this.i + 2, this.i + 4))) {
      this.startWord(this.i);
      this.wQuoted = true;
      const close = this.indexOf('\n' + n + '@', this.i + 2);
      this.wVal += t.slice(this.i + 2, close).replace(/^\r?\n/, '');
      this.i = Math.min(close + 3, this.end);
      return;
    }
    if (c === "'") {
      this.startWord(this.i);
      this.wQuoted = true;
      this.i++;
      while (this.i < this.end) {
        if (t[this.i] === "'") {
          if (this.ch(this.i + 1) === "'") {
            this.wVal += "'";
            this.i += 2;
            continue;
          }
          break;
        }
        this.wVal += t[this.i];
        this.i++;
      }
      this.i++;
      return;
    }
    if (c === '"') return this.psDouble();
    if ((c === '$' || c === '@') && n === '(') {
      this.startWord(this.i);
      const close = this.matchBracket(this.i + 1);
      this.addNested(this.i + 2, close);
      this.wVal += t.slice(this.i, close + 1);
      this.i = close + 1;
      return;
    }
    if (c === '(' || c === '{') {
      const atStart = this.wStart < 0;
      this.startWord(this.i);
      const close = this.matchBracket(this.i);
      if (atStart || c === '{') this.addNested(this.i + 1, close);
      this.wVal += t.slice(this.i, close + 1);
      this.i = close + 1;
      return;
    }
    if (c === ')' || c === '}') {
      this.endWord(this.i);
      this.i++;
      return;
    }
    if (c === '|') {
      this.endWord(this.i);
      const two = n === '|';
      this.endSegment(two ? '||' : '|');
      this.i += two ? 2 : 1;
      return;
    }
    if (c === '&' && n === '&') {
      this.endWord(this.i);
      this.endSegment('&&');
      this.i += 2;
      return;
    }
    if (c === ';') {
      this.endWord(this.i);
      this.endSegment(';');
      this.i++;
      return;
    }
    if (c === '>' || c === '<') return this.redirect();
    this.startWord(this.i);
    this.wVal += c;
    this.i++;
  }

  private psDouble(): void {
    const t = this.text;
    this.startWord(this.i);
    this.wQuoted = true;
    this.i++;
    while (this.i < this.end) {
      const x = t[this.i];
      const y = this.ch(this.i + 1);
      if (x === '"') {
        if (y === '"') {
          this.wVal += '"';
          this.i += 2;
          continue;
        }
        break;
      }
      if (x === '`' && y !== '') {
        this.wVal += y;
        this.i += 2;
        continue;
      }
      if (x === '$' && y === '(') {
        const close = this.matchBracket(this.i + 1);
        this.addNested(this.i + 2, close);
        this.wVal += t.slice(this.i, close + 1);
        this.i = close + 1;
        continue;
      }
      this.wVal += x;
      this.i++;
    }
    this.i++;
  }

  // ---- cmd ----

  private stepCmd(): void {
    const t = this.text;
    const c = t[this.i];
    const n = this.ch(this.i + 1);
    if (this.wStart < 0 && this.words.length === 0 && this.redirects.length === 0) {
      if (/^(@?rem(\s|$)|::)/i.test(t.slice(this.i, Math.min(this.i + 5, this.end)))) return this.skipToLineEnd();
    }
    if (c === '^') {
      if (n === '\n') {
        this.i += 2;
        return;
      }
      if (n === '\r' && this.ch(this.i + 2) === '\n') {
        this.i += 3;
        return;
      }
      this.startWord(this.i);
      this.wVal += n;
      this.i += 2;
      return;
    }
    if (isSpace(c)) {
      this.endWord(this.i);
      this.i++;
      return;
    }
    if (c === '\n') return this.newline();
    if (c === '"') {
      this.startWord(this.i);
      this.wQuoted = true;
      const close = this.indexOf('"', this.i + 1);
      this.wVal += t.slice(this.i + 1, close);
      this.i = close + 1;
      return;
    }
    if (c === '&' || c === '|') {
      this.endWord(this.i);
      const two = n === c;
      this.endSegment(two ? c + c : c);
      this.i += two ? 2 : 1;
      return;
    }
    if (c === '(' || c === ')') {
      this.endWord(this.i);
      this.endSegment(null);
      this.i++;
      return;
    }
    if (c === '>' || c === '<') return this.redirect();
    this.startWord(this.i);
    this.wVal += c;
    this.i++;
  }
}

// ---- command words ----

// Wrappers that run the command after them, with the flags that take a value.
const UNIX_PREFIXES: Record<string, string[]> = {
  env: ['-u', '-C', '-S'],
  nohup: [],
  time: ['-f', '-o'],
  command: [],
  exec: ['-a'],
  nice: ['-n'],
  stdbuf: ['-i', '-o', '-e'],
  builtin: [],
  timeout: ['-s', '-k', '--signal', '--kill-after'],
  watch: ['-n', '-d', '--interval'],
  ionice: ['-c', '-n', '-p'],
  caffeinate: ['-t', '-w'],
};
// Wrappers with a positional argument before the command (timeout DURATION cmd).
const UNIX_PREFIX_POSITIONALS: Record<string, number> = { timeout: 1 };
const UNIX_KEYWORDS = new Set(['then', 'do', 'else', 'elif', 'if', 'while', 'until', '!', '{', '}']);
const CMD_COMPARE = new Set(['equ', 'neq', 'lss', 'leq', 'gtr', 'geq', '==']);

export interface CommandWord {
  name: string;
  index: number;
}

// Index after a cmd `if` condition (`if [/i] [not] exist X`, `errorlevel N`, `defined X`, `a==b`, `a EQU b`).
function skipCmdIf(ws: Word[], k: number): number {
  k++;
  if (ws[k]?.value.toLowerCase() === '/i') k++;
  if (ws[k]?.value.toLowerCase() === 'not') k++;
  const v = ws[k]?.value.toLowerCase() ?? '';
  if (v === 'exist' || v === 'errorlevel' || v === 'defined' || v === 'cmdextversion') return k + 2;
  if (/^[^=]+==[^=]+$/.test(ws[k]?.value ?? '')) return k + 1;
  if (CMD_COMPARE.has(ws[k + 1]?.value.toLowerCase() ?? '')) return k + 3;
  return k + 1;
}

// Index after a unix wrapper at `k` and its flags.
function skipUnixPrefix(ws: Word[], k: number): number {
  const name = ws[k].value;
  const valued = UNIX_PREFIXES[name];
  k++;
  while (k < ws.length && ws[k].value.startsWith('-') && ws[k].value !== '-') {
    const flag = ws[k].value;
    k++;
    if (flag === '--') break;
    if (valued.includes(flag)) k++;
  }
  return k + (UNIX_PREFIX_POSITIONALS[name] ?? 0);
}

// The real command of a segment, skipping assignments, keywords and wrapper prefixes.
export function commandWord(seg: Segment, family: ShellFamily = seg.family): CommandWord | null {
  const ws = seg.words;
  let k = 0;
  while (k < ws.length) {
    const v = ws[k].value;
    if (family === 'unix') {
      if (!ws[k].quoted && /^[A-Za-z_][A-Za-z0-9_]*=/.test(v)) {
        k++;
        continue;
      }
      if (UNIX_KEYWORDS.has(v)) {
        k++;
        continue;
      }
      if (Object.hasOwn(UNIX_PREFIXES, v)) {
        k = skipUnixPrefix(ws, k);
        continue;
      }
    }
    if (family === 'powershell' && (v === '&' || v === '.')) {
      k++;
      continue;
    }
    if (family === 'cmd') {
      const low = v.toLowerCase().replace(/^@/, '');
      if (low === 'if') {
        k = skipCmdIf(ws, k);
        continue;
      }
      if (low === 'do' || low === 'else') {
        k++;
        continue;
      }
    }
    break;
  }
  if (k >= ws.length) return null;
  let name = ws[k].value;
  if (family === 'cmd') name = name.replace(/^@/, '');
  name = name.split(/[\\/]/).pop() ?? name;
  if (family !== 'unix') name = name.toLowerCase().replace(/\.exe$/, '');
  return { name, index: k };
}

const SUDO_ARG_FLAGS = new Set(['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U']);

// The segment with a leading sudo or doas (and its flags) removed; unix only.
export function afterPrivilege(seg: Segment): Segment {
  if (seg.family !== 'unix') return seg;
  const first = seg.words[0]?.value;
  if (first !== 'sudo' && first !== 'doas') return seg;
  let k = 1;
  while (k < seg.words.length && seg.words[k].value.startsWith('-')) {
    const flag = seg.words[k].value;
    k++;
    if (SUDO_ARG_FLAGS.has(flag)) k++;
  }
  return { ...seg, words: seg.words.slice(k) };
}

// ---- command text passed to another shell ----

// The command text inside a word: inside its quotes when fully quoted.
// - When escapes make the text differ from the word's value, lex the value instead (anchored to the word).
function wordRegion(w: Word, family: ShellFamily, src: string): Region {
  const q = w.raw[0];
  const fully = (q === '"' || q === "'") && w.raw.length >= 2 && w.raw.endsWith(q);
  const r = fully ? { start: w.start + 1, end: w.end - 1, family } : { start: w.start, end: w.end, family };
  if (src.slice(r.start, r.end) === w.value) return r;
  return { start: 0, end: w.value.length, family, text: w.value, anchor: { start: w.start, end: w.end } };
}

function wordsRegion(ws: Word[], family: ShellFamily, src: string): Region {
  if (ws.length === 1) return wordRegion(ws[0], family, src);
  return { start: ws[0].start, end: ws[ws.length - 1].end, family };
}

// Index of the first word that is not a flag, skipping the values of `valued` flags.
function firstOperand(ws: Word[], valued: Set<string>): number {
  for (let k = 0; k < ws.length; k++) {
    const v = ws[k].value;
    if (!v.startsWith('-') || v === '-') return k;
    if (valued.has(v)) k++;
  }
  return ws.length;
}

const SSH_VALUE_FLAGS = new Set(['-b', '-B', '-c', '-D', '-E', '-e', '-F', '-I', '-i', '-J', '-L', '-l', '-m', '-O', '-o', '-p', '-Q', '-R', '-S', '-W', '-w']);
const EXEC_VALUE_FLAGS = new Set(['-e', '--env', '-u', '--user', '-w', '--workdir', '--env-file', '--detach-keys']);

// The command text another program runs on a remote host or in a container (ssh, docker exec, kubectl exec).
function remoteCommand(name: string, rest: Word[]): Word[] {
  if (name === 'ssh') {
    const host = firstOperand(rest, SSH_VALUE_FLAGS);
    return rest.slice(host + 1);
  }
  if ((name === 'docker' || name === 'podman') && rest[0]?.value === 'exec') {
    const container = 1 + firstOperand(rest.slice(1), EXEC_VALUE_FLAGS);
    return rest.slice(container + 1);
  }
  if (name === 'kubectl' && rest[0]?.value === 'exec') {
    const dashes = rest.findIndex((w) => w.value === '--');
    return dashes >= 0 ? rest.slice(dashes + 1) : [];
  }
  return [];
}

const UNIX_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const FIND_EXEC = new Set(['-exec', '-execdir', '-ok', '-okdir']);
const XARGS_VALUE_FLAGS = new Set(['-I', '-n', '-P', '-d', '-L', '-s', '-E', '-a']);

// The commands find runs with -exec (each one up to its ; or +).
export function findExecs(args: Word[]): Word[][] {
  const out: Word[][] = [];
  for (let k = 0; k < args.length; k++) {
    if (!FIND_EXEC.has(args[k].value)) continue;
    const start = k + 1;
    while (k + 1 < args.length && args[k + 1].value !== ';' && args[k + 1].value !== '+') k++;
    out.push(args.slice(start, k + 1));
    k++;
  }
  return out.filter((ws) => ws.length > 0);
}

// The command xargs runs, as words.
export function xargsCommandWords(args: Word[]): Word[] {
  for (let k = 0; k < args.length; k++) {
    const v = args[k].value;
    if (XARGS_VALUE_FLAGS.has(v)) {
      k++;
      continue;
    }
    if (v.startsWith('-')) continue;
    return args.slice(k);
  }
  return [];
}

// The commands a unix segment hands to another program to run (find -exec, xargs), as segments.
export function innerCommands(seg: Segment): Segment[] {
  if (seg.family !== 'unix') return [];
  const s = afterPrivilege(seg);
  const cw = commandWord(s);
  if (!cw) return [];
  const rest = s.words.slice(cw.index + 1);
  const groups = cw.name === 'find' ? findExecs(rest) : cw.name === 'xargs' ? [xargsCommandWords(rest)] : [];
  return groups.filter((ws) => ws.length > 0).map((ws) => ({ ...seg, words: ws }));
}

function invocationRegions(seg: Segment, src: string): Region[] {
  const s = afterPrivilege(seg);
  const cw = commandWord(s);
  if (!cw) return [];
  const name = cw.name.toLowerCase().replace(/\.exe$/, '');
  const rest = s.words.slice(cw.index + 1);
  if (UNIX_SHELLS.has(name)) {
    const k = rest.findIndex((w) => !w.quoted && /^-[a-z]*c[a-z]*$/i.test(w.value));
    if (k >= 0 && rest[k + 1]) return [wordRegion(rest[k + 1], 'unix', src)];
  }
  if (name === 'su') {
    const k = rest.findIndex((w) => w.value === '-c' || w.value === '--command');
    if (k >= 0 && rest[k + 1]) return [wordRegion(rest[k + 1], 'unix', src)];
    const eq = rest.find((w) => w.value.startsWith('--command='));
    if (eq) return [{ start: 0, end: eq.value.length - 10, family: 'unix', text: eq.value.slice(10), anchor: { start: eq.start, end: eq.end } }];
  }
  if (name === 'powershell' || name === 'pwsh') {
    const k = rest.findIndex((w) => /^-(c|co|com|comm|comma|comman|command)$/i.test(w.value));
    if (k >= 0 && rest[k + 1]) return [wordsRegion(rest.slice(k + 1), 'powershell', src)];
  }
  if (name === 'cmd') {
    const k = rest.findIndex((w) => /^\/[ck]$/i.test(w.value));
    if (k >= 0 && rest[k + 1]) return [wordsRegion(rest.slice(k + 1), 'cmd', src)];
  }
  const remote = remoteCommand(name, rest);
  if (remote.length) return [wordsRegion(remote, 'unix', src)];
  if (name === 'forfiles') {
    const k = rest.findIndex((w) => /^\/c$/i.test(w.value));
    if (k >= 0 && rest[k + 1]) return [wordRegion(rest[k + 1], 'cmd', src)];
  }
  return innerCommands(seg).flatMap((inner) => invocationRegions(inner, src));
}
