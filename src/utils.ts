import type { FlutePartGeometry } from './types';

// Format a raw MARK hole name into a compact musical label.
// "c-sharp-2" → "C♯2",  "b-flat" → "B♭",  "c-2" → "C2"
export function formatNoteName(raw: string): string {
  return raw
    .replace(/-sharp/i, '♯')
    .replace(/-flat/i,  '♭')
    .replace(/-natural/i, '♮')
    .replace(/^([a-g])/i, (_, l: string) => l.toUpperCase())
    .replace(/-(\d+)$/, '$1');   // strip hyphen before trailing number
}

// Find best-matching part for a GCode filename, e.g. "0015-footer.nc" → "footer"
export function matchPart(parts: FlutePartGeometry[], filename: string): FlutePartGeometry {
  const lower = filename.toLowerCase();
  return parts.find(p => lower.includes(p.name.toLowerCase())) ?? parts[0];
}
