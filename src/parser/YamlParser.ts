import yaml from 'js-yaml';
import type { FlutePartGeometry, FluteHole } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseHole(h: any): FluteHole {
  return {
    name: h.name ?? '?',
    centerX: h.centerX ?? 0,
    alpha: h.alpha ?? 0,
    diameter: h.diamX ?? h.diam ?? 8,
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

export function parseYaml(text: string): FlutePartGeometry[] {
  const doc = yaml.load(text) as any;
  if (!doc) return [];
  const parts = doc.parts ?? [doc];
  return parts.map(parsePart);
}
