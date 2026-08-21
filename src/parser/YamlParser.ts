import yaml from 'js-yaml';
import type { FlutePartGeometry, FluteHole, BlowholeStock } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseHole(h: any): FluteHole {
  return {
    name: h.name ?? '?',
    // Support both the older (centerX/diamX) and newer (centerY/diamAxial) field names.
    centerX: h.centerX ?? h.centerY ?? 0,
    alpha: h.alpha ?? 0,
    diameter: h.diamX ?? h.diamAxial ?? h.diam ?? 8,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePart(p: any): FlutePartGeometry {
  const holes: FluteHole[] = (p.holes ?? [])
    .filter((h: any) => h.enabled !== false && h.enabled !== 'false')
    .map(parseHole);

  return {
    name: p.name ?? 'part',
    boreLen: p.boreLen ?? 200,
    radiusAtZero: (p.tubeDiamAtBoreZero ?? 28) / 2,
    radiusAtEnd: (p.tubeDiamAtBoreLowerEnd ?? 26) / 2,
    tenonAtZero: p.tenonAtZero
      ? { length: p.tenonAtZero.length ?? 25, radius: (p.tenonAtZero.diam ?? 24) / 2 }
      : undefined,
    tenonAtLowerEnd: p.tenonAtLowerEnd
      ? { length: p.tenonAtLowerEnd.length ?? 20, radius: (p.tenonAtLowerEnd.diam ?? 22) / 2 }
      : undefined,
    holes,
  };
}

// A blowhole YAML is recognised by its hole-footprint fields (xDim/yDim) together
// with a wall spec (outer/inner tube), and the absence of a `parts` list.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isBlowholeDoc(doc: any): boolean {
  return !!doc && doc.parts == null &&
    doc.xDim != null && doc.yDim != null &&
    (doc.outerTubeDiam != null || doc.innerTubeDiam != null);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseBlowhole(doc: any): BlowholeStock {
  return {
    name: doc.serialNo != null ? String(doc.serialNo) : 'blowhole',
    outerR: (doc.outerTubeDiam ?? 28) / 2,
    innerR: (doc.innerTubeDiam ?? 17) / 2,
    xDim: doc.xDim ?? 12,
    yDim: doc.yDim ?? 10,
    toolDiam: doc.toolDiam,
  };
}

export type YamlKind = 'flute' | 'blowhole';

export interface YamlParseResult {
  kind: YamlKind;
  parts: FlutePartGeometry[];
  blowhole?: BlowholeStock;
  safetyBetweenHoleAndTenon?: number;
}

export function parseYaml(text: string): YamlParseResult {
  const doc = yaml.load(text) as any;
  if (!doc) return { kind: 'flute', parts: [] };

  if (isBlowholeDoc(doc)) {
    return { kind: 'blowhole', parts: [], blowhole: parseBlowhole(doc) };
  }

  const parts = (doc.parts ?? [doc]).map(parsePart);
  const safetyBetweenHoleAndTenon =
    typeof doc.safetyBetweenHoleAndTenon === 'number'
      ? doc.safetyBetweenHoleAndTenon
      : undefined;
  return { kind: 'flute', parts, safetyBetweenHoleAndTenon };
}
