import { describe, it, expect } from 'vitest';
import { parseYaml } from '../parser/YamlParser';

const MINIMAL_YAML = `
parts:
  - name: lh-part
    boreLen: 208.18
    tubeDiamAtBoreZero: 28.9
    tubeDiamAtBoreLowerEnd: 26.53
    holes:
      - name: c-2
        centerX: -10
        alpha: 0
        diamX: 8
`;

const YAML_WITH_TENONS = `
parts:
  - name: rh-part
    boreLen: 102.5
    tubeDiamAtBoreZero: 27.0
    tubeDiamAtBoreLowerEnd: 25.5
    tenonAtZero:
      length: 28
      diam: 24.5
    tenonAtLowerEnd:
      length: 20
      diam: 22.0
    holes: []
`;

const YAML_WITH_DISABLED_HOLES = `
parts:
  - name: footer
    boreLen: 123.6
    tubeDiamAtBoreZero: 26.0
    tubeDiamAtBoreLowerEnd: 24.0
    holes:
      - name: c-sharp-2
        centerX: -15
        alpha: 45
        diamX: 7.5
        enabled: true
      - name: spare
        centerX: -30
        alpha: 0
        diamX: 6
        enabled: false
`;

describe('parseYaml – basic part', () => {
  it('parses part name and bore length', () => {
    const parts = parseYaml(MINIMAL_YAML);
    expect(parts).toHaveLength(1);
    expect(parts[0].name).toBe('lh-part');
    expect(parts[0].boreLen).toBeCloseTo(208.18);
  });

  it('converts tube diameters to radii', () => {
    const [part] = parseYaml(MINIMAL_YAML);
    expect(part.radiusAtZero).toBeCloseTo(28.9 / 2);
    expect(part.radiusAtEnd).toBeCloseTo(26.53 / 2);
  });

  it('parses holes correctly', () => {
    const [part] = parseYaml(MINIMAL_YAML);
    expect(part.holes).toHaveLength(1);
    expect(part.holes[0].name).toBe('c-2');
    expect(part.holes[0].centerX).toBe(-10);
    expect(part.holes[0].alpha).toBe(0);
    expect(part.holes[0].diameter).toBe(8);
  });
});

describe('parseYaml – tenons', () => {
  it('parses tenonAtZero', () => {
    const [part] = parseYaml(YAML_WITH_TENONS);
    expect(part.tenonAtZero).toBeDefined();
    expect(part.tenonAtZero?.length).toBe(28);
    expect(part.tenonAtZero?.radius).toBeCloseTo(24.5 / 2);
  });

  it('parses tenonAtLowerEnd', () => {
    const [part] = parseYaml(YAML_WITH_TENONS);
    expect(part.tenonAtLowerEnd).toBeDefined();
    expect(part.tenonAtLowerEnd?.length).toBe(20);
    expect(part.tenonAtLowerEnd?.radius).toBeCloseTo(22.0 / 2);
  });

  it('leaves tenons undefined when absent', () => {
    const [part] = parseYaml(MINIMAL_YAML);
    expect(part.tenonAtZero).toBeUndefined();
    expect(part.tenonAtLowerEnd).toBeUndefined();
  });
});

describe('parseYaml – disabled holes', () => {
  it('includes enabled holes', () => {
    const [part] = parseYaml(YAML_WITH_DISABLED_HOLES);
    expect(part.holes.some(h => h.name === 'c-sharp-2')).toBe(true);
  });

  it('excludes holes with enabled: false', () => {
    const [part] = parseYaml(YAML_WITH_DISABLED_HOLES);
    expect(part.holes.some(h => h.name === 'spare')).toBe(false);
    expect(part.holes).toHaveLength(1);
  });
});

describe('parseYaml – multiple parts', () => {
  const MULTI = `
parts:
  - name: lh-part
    boreLen: 208
    tubeDiamAtBoreZero: 29
    tubeDiamAtBoreLowerEnd: 27
    holes: []
  - name: rh-part
    boreLen: 102
    tubeDiamAtBoreZero: 27
    tubeDiamAtBoreLowerEnd: 25
    holes: []
  - name: footer
    boreLen: 124
    tubeDiamAtBoreZero: 25
    tubeDiamAtBoreLowerEnd: 23
    holes: []
`;

  it('returns all parts in order', () => {
    const parts = parseYaml(MULTI);
    expect(parts).toHaveLength(3);
    expect(parts.map(p => p.name)).toEqual(['lh-part', 'rh-part', 'footer']);
  });
});

describe('parseYaml – edge cases', () => {
  it('returns empty array for empty input', () => {
    expect(parseYaml('')).toEqual([]);
  });
});
