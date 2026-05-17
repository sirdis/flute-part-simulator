import { describe, it, expect } from 'vitest';
import { parseGCode, buildMotion } from '../parser/GCodeParser';

// ── parseGCode / parseLine ────────────────────────────────────────────────────

describe('parseLine – basic commands', () => {
  it('parses G00 rapid move', () => {
    const [line] = parseGCode('G00 X10 Y20 Z-5');
    expect(line.command?.type).toBe('G00');
    if (line.command?.type === 'G00') {
      expect(line.command.params.x).toBe(10);
      expect(line.command.params.y).toBe(20);
      expect(line.command.params.z).toBe(-5);
    }
  });

  it('parses G01 feed move', () => {
    const [line] = parseGCode('G01 Y50.5 A90 F800');
    expect(line.command?.type).toBe('G01');
    if (line.command?.type === 'G01') {
      expect(line.command.params.y).toBeCloseTo(50.5);
      expect(line.command.params.a).toBe(90);
    }
  });

  it('parses G02 clockwise arc', () => {
    const [line] = parseGCode('G02 X5 Y5 I2.5 J0');
    expect(line.command?.type).toBe('G02');
    if (line.command?.type === 'G02') {
      expect(line.command.params.i).toBe(2.5);
      expect(line.command.params.j).toBe(0);
    }
  });

  it('parses G03 counter-clockwise arc', () => {
    const [line] = parseGCode('G03 X5 Y5 I0 J2.5');
    expect(line.command?.type).toBe('G03');
  });

  it('parses standalone F word', () => {
    const [line] = parseGCode('F1200');
    expect(line.command?.type).toBe('F');
    if (line.command?.type === 'F') expect(line.command.value).toBe(1200);
  });

  it('parses M03 spindle on', () => {
    const [line] = parseGCode('M03');
    expect(line.command?.type).toBe('M03');
  });

  it('parses M30 program end', () => {
    const [line] = parseGCode('M30');
    expect(line.command?.type).toBe('M30');
  });

  it('parses G92 work offset', () => {
    const [line] = parseGCode('G92 X0 Y0 Z0 A0');
    expect(line.command?.type).toBe('G92');
  });

  it('handles comment-only line', () => {
    const [line] = parseGCode('(this is a comment)');
    expect(line.command).toBeNull();
    expect(line.comment).toBe('this is a comment');
  });

  it('assigns correct lineIndex', () => {
    const lines = parseGCode('G00 X0\nG01 Y10\nM30');
    expect(lines[0].lineIndex).toBe(0);
    expect(lines[1].lineIndex).toBe(1);
    expect(lines[2].lineIndex).toBe(2);
  });
});

// ── MARK extraction ───────────────────────────────────────────────────────────
// This regex had a regression: "c-sharp-2" was truncated to "c" because
// the pattern stopped at the first "-". Covered explicitly.

describe('parseLine – MARK hole names', () => {
  it('extracts simple note name', () => {
    const [line] = parseGCode('(MARK Hole: c-2)');
    expect(line.mark).toBe('c-2');
  });

  it('extracts sharp note with octave', () => {
    const [line] = parseGCode('(MARK Hole: c-sharp-2 -> some text)');
    expect(line.mark).toBe('c-sharp-2');
  });

  it('extracts flat note', () => {
    const [line] = parseGCode('(MARK Hole: b-flat)');
    expect(line.mark).toBe('b-flat');
  });

  it('extracts natural note', () => {
    const [line] = parseGCode('(MARK Hole: f-natural-1)');
    expect(line.mark).toBe('f-natural-1');
  });

  it('returns null for lines without MARK', () => {
    const [line] = parseGCode('G01 Y10');
    expect(line.mark).toBeNull();
  });

  it('is case-insensitive for MARK keyword', () => {
    const [line] = parseGCode('(mark hole: d-2)');
    expect(line.mark).toBe('d-2');
  });
});

// ── Tool diameter extraction ──────────────────────────────────────────────────

describe('buildMotion – tool diameter from comment', () => {
  it('extracts toolDiam: syntax', () => {
    const lines = parseGCode('(toolDiam: 3.175)\nG01 Y10');
    const result = buildMotion(lines);
    expect(result.toolDiameter).toBeCloseTo(3.175);
  });

  it('extracts toolDiam= syntax', () => {
    const lines = parseGCode('(toolDiam=6)\nG01 Y10');
    const result = buildMotion(lines);
    expect(result.toolDiameter).toBe(6);
  });

  it('extracts tool diameter long form', () => {
    const lines = parseGCode('(tool diameter 1.5)\nG01 Y10');
    const result = buildMotion(lines);
    expect(result.toolDiameter).toBeCloseTo(1.5);
  });

  it('uses default 3.175 when no comment present', () => {
    const lines = parseGCode('G01 Y10');
    const result = buildMotion(lines);
    expect(result.toolDiameter).toBeCloseTo(3.175);
  });
});

// ── Y range (longitudinal axis) ───────────────────────────────────────────────
// Machine Y = longitudinal axis. yRange must track Y, not X.

describe('buildMotion – yRange', () => {
  it('tracks machine Y extent across G01 moves', () => {
    const lines = parseGCode([
      'G00 Y0',
      'G01 Y-50 F800',
      'G01 Y-200',
      'G00 Y0',
    ].join('\n'));
    const { yRange } = buildMotion(lines);
    expect(yRange[0]).toBeCloseTo(-200);
    expect(yRange[1]).toBeCloseTo(0);
  });

  it('returns [0, 200] fallback when no moves', () => {
    const lines = parseGCode('M03\nM30');
    const { yRange } = buildMotion(lines);
    expect(yRange[0]).toBe(0);
    expect(yRange[1]).toBe(200);
  });
});

// ── Machine state tracking ────────────────────────────────────────────────────

describe('buildMotion – machine states', () => {
  it('accumulates absolute Y positions across moves', () => {
    const lines = parseGCode([
      'G00 Y0',
      'G01 Y-100 F600',
      'G01 Y-200',
    ].join('\n'));
    const { machineStates } = buildMotion(lines);
    // State BEFORE each line:
    expect(machineStates[0].y).toBe(0);   // before G00 Y0
    expect(machineStates[1].y).toBe(0);   // before G01 Y-100 (G00 Y0 sets y=0)
    expect(machineStates[2].y).toBeCloseTo(-100); // before G01 Y-200
  });

  it('applies G92 work offset', () => {
    const lines = parseGCode([
      'G01 Y50',
      'G92 Y0',   // reset Y to 0 at current position
      'G01 Y-10',
    ].join('\n'));
    const { machineStates } = buildMotion(lines);
    // After G92 Y0, the position is reset: next machineState.y = 0
    expect(machineStates[2].y).toBe(0);
  });

  it('tracks feed rate F', () => {
    const lines = parseGCode([
      'F1200',
      'G01 Y-10',
    ].join('\n'));
    const { machineStates } = buildMotion(lines);
    expect(machineStates[1].f).toBe(1200);
  });

  it('records marks with correct lineIndex', () => {
    const lines = parseGCode([
      'G00 Y0',
      '(MARK Hole: c-2)',
      'G01 Y-50',
    ].join('\n'));
    const { marks } = buildMotion(lines);
    expect(marks).toHaveLength(1);
    expect(marks[0].name).toBe('c-2');
    expect(marks[0].lineIndex).toBe(1);
  });
});
