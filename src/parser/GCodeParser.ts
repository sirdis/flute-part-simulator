import type { GCodeLine, ParsedCommand, AxisParams, ArcParams, MachineState, MotionSegment } from '../types';

const PARAM_RE = /([XYZAIJFSxyzaijfs])(-?\d+\.?\d*(?:e[+-]?\d+)?)/gi;

function extractParams(text: string): Record<string, number> {
  const result: Record<string, number> = {};
  let m: RegExpExecArray | null;
  PARAM_RE.lastIndex = 0;
  while ((m = PARAM_RE.exec(text)) !== null) {
    result[m[1].toUpperCase()] = parseFloat(m[2]);
  }
  return result;
}

function extractComment(raw: string): { text: string; stripped: string } {
  const comments: string[] = [];
  const stripped = raw.replace(/\([^)]*\)/g, (c) => {
    comments.push(c.slice(1, -1));
    return ' ';
  }).replace(/;.*$/, '').trim();
  return { text: comments.join(' '), stripped };
}

function parseLine(raw: string, lineIndex: number): GCodeLine {
  const { text: comment, stripped } = extractComment(raw);

  // Extract MARK hole name
  let mark: string | null = null;
  const markMatch = comment.match(/MARK\s+Hole:\s*([^\s->]+)/i);
  if (markMatch) mark = markMatch[1];

  let command: ParsedCommand | null = null;

  // Match G and M words
  const gWords = [...stripped.matchAll(/[GM](\d+)/gi)].map(m => ({ letter: m[0][0].toUpperCase(), code: parseInt(m[1]) }));
  const params = extractParams(stripped);

  const axisParams: AxisParams = {};
  if ('X' in params) axisParams.x = params['X'];
  if ('Y' in params) axisParams.y = params['Y'];
  if ('Z' in params) axisParams.z = params['Z'];
  if ('A' in params) axisParams.a = params['A'];

  for (const { letter, code } of gWords) {
    if (letter === 'G') {
      if (code === 0)  { command = { type: 'G00', params: axisParams }; break; }
      if (code === 1)  { command = { type: 'G01', params: axisParams }; break; }
      if (code === 2 || code === 3) {
        const arcP: ArcParams = {
          ...axisParams,
          i: params['I'] ?? 0,
          j: params['J'] ?? 0,
        };
        command = { type: code === 2 ? 'G02' : 'G03', params: arcP };
        break;
      }
      if (code === 21) { command = { type: 'G21' }; break; }
      if (code === 90) { command = { type: 'G90' }; break; }
      if (code === 92) { command = { type: 'G92', params: axisParams }; break; }
    }
    if (letter === 'M') {
      if (code === 3)  { command = { type: 'M03' }; break; }
      if (code === 5)  { command = { type: 'M05' }; break; }
      if (code === 30) { command = { type: 'M30' }; break; }
    }
  }

  // Standalone F or S (no G word on the line)
  if (!command) {
    if ('F' in params) command = { type: 'F', value: params['F'] };
    else if ('S' in params) command = { type: 'S', value: params['S'] };
  }

  // Combined spindle start: "S11000 M03"
  if (!command && gWords.some(w => w.letter === 'M' && w.code === 3)) {
    command = { type: 'M03' };
  }

  return { lineIndex, raw, command, comment, mark };
}

export function parseGCode(text: string): GCodeLine[] {
  return text.split('\n').map((raw, i) => parseLine(raw, i));
}

// ── Motion builder ──────────────────────────────────────────────────────────

const defaultMachine = (): MachineState => ({ x: 0, y: 0, z: 0, a: 0, f: 600, isAbsolute: true });

function applyParams(state: MachineState, params: AxisParams): MachineState {
  const next = { ...state };
  if (state.isAbsolute) {
    if (params.x !== undefined) next.x = params.x;
    if (params.y !== undefined) next.y = params.y;
    if (params.z !== undefined) next.z = params.z;
    if (params.a !== undefined) next.a = params.a;
  } else {
    if (params.x !== undefined) next.x += params.x;
    if (params.y !== undefined) next.y += params.y;
    if (params.z !== undefined) next.z += params.z;
    if (params.a !== undefined) next.a += params.a;
  }
  return next;
}

export interface ParseResult {
  lines: GCodeLine[];
  segments: MotionSegment[];
  machineStates: MachineState[];  // state BEFORE executing line[i]
  toolDiameter: number;
  marks: Array<{ lineIndex: number; name: string }>;
  yRange: [number, number];  // machine Y (longitudinal axis) range
}

export function buildMotion(lines: GCodeLine[]): ParseResult {
  const segments: MotionSegment[] = [];
  const machineStates: MachineState[] = [];
  const marks: Array<{ lineIndex: number; name: string }> = [];
  let state = defaultMachine();
  let toolDiameter = 3.175;
  let yMin = Infinity, yMax = -Infinity;  // machine Y = longitudinal axis

  for (const line of lines) {
    machineStates.push({ ...state });

    // Collect marks
    if (line.mark) marks.push({ lineIndex: line.lineIndex, name: line.mark });

    // Extract tool diameter from comment
    const tdMatch = line.comment.match(/tool\s+diameter\s+([\d.]+)/i);
    if (tdMatch) toolDiameter = parseFloat(tdMatch[1]);

    const cmd = line.command;
    if (!cmd) continue;

    if (cmd.type === 'G90') { state = { ...state, isAbsolute: true }; continue; }
    if (cmd.type === 'F')   { state = { ...state, f: cmd.value }; continue; }
    if (cmd.type === 'G92') {
      // Work offset reset — apply only axes present in params
      if (cmd.params.x !== undefined) state = { ...state, x: cmd.params.x };
      if (cmd.params.y !== undefined) state = { ...state, y: cmd.params.y };
      if (cmd.params.z !== undefined) state = { ...state, z: cmd.params.z };
      if (cmd.params.a !== undefined) state = { ...state, a: cmd.params.a };
      continue;
    }

    if (cmd.type === 'G00' || cmd.type === 'G01') {
      const from = { ...state };
      const to = applyParams(state, cmd.params);
      state = to;
      segments.push({ fromMachine: from, toMachine: to, isRapid: cmd.type === 'G00', lineIndex: line.lineIndex });

      yMin = Math.min(yMin, from.y, to.y);
      yMax = Math.max(yMax, from.y, to.y);
      continue;
    }

    if (cmd.type === 'G02' || cmd.type === 'G03') {
      const from = { ...state };
      const to = applyParams(state, cmd.params);
      state = to;
      segments.push({
        fromMachine: from,
        toMachine: to,
        isRapid: false,
        lineIndex: line.lineIndex,
        arc: { i: cmd.params.i, j: cmd.params.j, cw: cmd.type === 'G02' },
      });
      yMin = Math.min(yMin, from.y, to.y);
      yMax = Math.max(yMax, from.y, to.y);
    }
  }

  return {
    lines,
    segments,
    machineStates,
    toolDiameter,
    marks,
    yRange: [isFinite(yMin) ? yMin : 0, isFinite(yMax) ? yMax : 200],
  };
}
