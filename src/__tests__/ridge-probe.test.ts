import { describe, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseGCode, buildMotion } from '../parser/GCodeParser';
import { buildHeadpieceStock, carve } from '../renderer/MaterialSim';
import type { HeadpieceStock } from '../types';

// Headless-Carve exakt im MaterialSim-Modell (Kapsel-Fräser, Surface-Nets-SDF),
// dann eine ENTWICKELTE Tiefenkarte des Anblaslochs: fuer jede (axiale X, Winkel θ)
// die Materialoberflaeche (erster solider Voxel von aussen) -> Graustufen-PGM.
// Zweck: den Grat/Steg im Loch sichtbar und messbar machen, ohne den 3D-Viewer.

const NC = process.env.NC || '/Users/tarek/git/whistle-tools/nc/trapeztest-headpiece.nc';
const OUT = process.env.OUT || '/tmp/ridge';

// b-0019-headpiece.yaml
const stock: HeadpieceStock = {
  name: 'b-0019',
  blankR: 31.70 / 2,
  boreR: 17.16 / 2,
  crownR: 22.9 / 2,
  lowerR: 24 / 2,
  headLength: 175.59,
  crownRingWidth: 4,
  lowerRingWidth: 7.12,
};
const toolDiam = 3.175;

// Anblasloch-Kontext
const tBlow = 175.59 - 110.35;        // 65.24
const xHole = -tBlow;                 // world X der Lochmitte
const RES = 0.1;

describe('ridge probe', () => {
  it('depth map', () => {
    const text = readFileSync(NC, 'utf8');
    const { segments } = buildMotion(parseGCode(text));

    // kleines Gitter nur um das Loch
    const xLo = xHole - 13, xHi = xHole + 13;
    const g = buildHeadpieceStock(stock, xLo, xHi, RES);
    const radiusFn = () => stock.blankR;
    carve(g, segments, toolDiam / 2, radiusFn, stock.blankR);

    // Oberflaeche samplen: fuer (ix, θ) Radius r von aussen nach innen, erster
    // Voxel mit field<0. θ um 0 (Loch-Scheitel bei +Z, worldY=0).
    const thetaHalf = 70 * Math.PI / 180;   // ±70°
    const nTh = 400;
    const nx = g.nx;
    const rOuter = stock.blankR + 0.3;
    const rInner = 4;
    const depth = new Float32Array(nx * nTh);
    let dmin = 1e9, dmax = -1e9;

    // trilineare Feldabfrage
    const sample = (wx: number, wy: number, wz: number): number => {
      const fx = (wx - g.ox) / g.res, fy = (wy - g.oy) / g.res, fz = (wz - g.oz) / g.res;
      const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
      if (ix < 0 || iy < 0 || iz < 0 || ix >= g.nx - 1 || iy >= g.ny - 1 || iz >= g.nz - 1) return 1;
      const tx = fx - ix, ty = fy - iy, tz = fz - iz;
      const f = g.field; const nxx = g.nx, nyy = g.ny;
      const I = (a: number, b: number, c: number) => a + nxx * (b + nyy * c);
      const c000 = f[I(ix, iy, iz)], c100 = f[I(ix + 1, iy, iz)];
      const c010 = f[I(ix, iy + 1, iz)], c110 = f[I(ix + 1, iy + 1, iz)];
      const c001 = f[I(ix, iy, iz + 1)], c101 = f[I(ix + 1, iy, iz + 1)];
      const c011 = f[I(ix, iy + 1, iz + 1)], c111 = f[I(ix + 1, iy + 1, iz + 1)];
      const c00 = c000 * (1 - tx) + c100 * tx, c10 = c010 * (1 - tx) + c110 * tx;
      const c01 = c001 * (1 - tx) + c101 * tx, c11 = c011 * (1 - tx) + c111 * tx;
      const c0 = c00 * (1 - ty) + c10 * ty, c1 = c01 * (1 - ty) + c11 * ty;
      return c0 * (1 - tz) + c1 * tz;
    };

    for (let ix = 0; ix < nx; ix++) {
      const wx = g.ox + ix * g.res;
      for (let it = 0; it < nTh; it++) {
        const th = -thetaHalf + (2 * thetaHalf) * it / (nTh - 1);
        // r von aussen nach innen, feiner Schritt
        let surf = rInner;
        for (let r = rOuter; r >= rInner; r -= RES * 0.5) {
          const wy = r * Math.sin(th), wz = r * Math.cos(th);
          if (sample(wx, wy, wz) < 0) { surf = r; break; }
        }
        const d = stock.blankR - surf;   // Tiefe unter Rohradius
        depth[ix * nTh + it] = d;
        if (d < dmin) dmin = d; if (d > dmax) dmax = d;
      }
    }

    // Messung: axiale Laenge der Lochoeffnung je θ-Seite. Das Labium ist die
    // LAENGERE Kante (xDimLabium > xDimLowerLip) -> die θ-Seite mit groesserer
    // axialer Ausdehnung ist das Labium. Korrekt (Realitaet) = Labium bei +worldY
    // = θ>0 (worldZ>0 am Loch -> sign(θ)=sign(worldY)).
    const axLen = (itLo: number, itHi: number): number => {
      let best = 0;
      for (let it = itLo; it < itHi; it++) {
        let lo = -1, hi = -1;
        for (let ix = 0; ix < nx; ix++) {
          if (depth[ix * nTh + it] > 1.0) { if (lo < 0) lo = ix; hi = ix; }
        }
        if (lo >= 0) best = Math.max(best, (hi - lo) * g.res);
      }
      return best;
    };
    const mid = Math.floor(nTh / 2);
    const axNeg = axLen(0, mid);        // θ<0  (−worldY)
    const axPos = axLen(mid, nTh);      // θ>0  (+worldY)
    const labiumSide = axPos > axNeg ? '+worldY (θ>0, =+X, KORREKT)' : '-worldY (θ<0, =-X, GESPIEGELT)';
    writeFileSync(`${OUT}_orient.txt`,
      `ASIGN=${process.env.ASIGN ?? -1} MIRRORY=${process.env.MIRRORY ?? -1}\n`
      + `axiale Laenge θ>0 (+worldY) = ${axPos.toFixed(2)} mm ; θ<0 (−worldY) = ${axNeg.toFixed(2)} mm\n`
      + `-> laengere (Labium-)Kante liegt bei ${labiumSide}\n`);

    // PGM schreiben, Graustufen auf eine Randzone [0, CLAMP] geklemmt, damit die
    // feine Rim-Struktur (Fase, Grat) sichtbar wird statt am Durchbruch zu saettigen.
    const W = nTh, H = nx;
    const writeClamped = (file: string, clamp: number) => {
      const buf = Buffer.alloc(W * H);
      for (let ix = 0; ix < H; ix++) {
        for (let it = 0; it < W; it++) {
          let d = depth[ix * nTh + it];
          if (d > clamp) d = clamp;
          if (d < 0) d = 0;
          buf[ix * W + it] = 255 - Math.round(255 * d / clamp);
        }
      }
      writeFileSync(file, Buffer.concat([Buffer.from(`P5\n${W} ${H}\n255\n`, 'ascii'), buf]));
    };
    writeClamped(`${OUT}.pgm`, 2.5);
    writeClamped(`${OUT}_rim.pgm`, 1.1);

    // --- Querschnitte (θ, r) an mehreren axialen Positionen -------------------
    // Rasterisiert die (θ, r)-Ebene bei festem X: solid=dunkel. Zeigt beide
    // Unterschneidungswaende + Boden + einen etwaigen Steg direkt im Profil.
    const CW = 360, CH = 220;                 // Breite θ, Hoehe r
    const thC = 55 * Math.PI / 180;           // ±55°
    const rTop = stock.blankR + 0.2, rBot = 6;
    const slicesX = [-7, -5, -3, 0, 3, 5, 7].map(d => xHole + d);  // um die Lochmitte
    const gap = 6;
    const MW = CW, MH = (CH + gap) * slicesX.length;
    const mont = Buffer.alloc(MW * MH, 230);
    slicesX.forEach((wx, si) => {
      const y0 = si * (CH + gap);
      for (let iy = 0; iy < CH; iy++) {
        const r = rTop - (rTop - rBot) * iy / (CH - 1);   // oben=aussen
        for (let it = 0; it < CW; it++) {
          const th = -thC + 2 * thC * it / (CW - 1);
          const val = sample(wx, r * Math.sin(th), r * Math.cos(th));
          mont[(y0 + iy) * MW + it] = val < 0 ? 40 : 235;   // solid dunkel
        }
      }
    });
    writeFileSync(`${OUT}_xsec.pgm`,
      Buffer.concat([Buffer.from(`P5\n${MW} ${MH}\n255\n`, 'ascii'), mont]));

    // --- Axiale Querschnitte (X, r) bei festem θ ------------------------------
    // Zeigt die STIRNWAENDE (axiale Enden) und einen Steg dort, wo Labium- und
    // Unterlippen-Eckbogen an der Stirnseite zusammenstossen.
    const AW = 320, AH = 200;                  // Breite X, Hoehe r
    const xW = 11;                              // ±11mm axial um die Lochmitte
    const thetas = [40, 20, 0, -20, -40];       // deg; + = eine Umfangsseite
    const amont = Buffer.alloc(AW * ((AH + gap) * thetas.length), 230);
    thetas.forEach((thDeg, si) => {
      const th = thDeg * Math.PI / 180;
      const y0 = si * (AH + gap);
      for (let iy = 0; iy < AH; iy++) {
        const r = rTop - (rTop - rBot) * iy / (AH - 1);
        for (let it = 0; it < AW; it++) {
          const wx = xHole - xW + 2 * xW * it / (AW - 1);
          const val = sample(wx, r * Math.sin(th), r * Math.cos(th));
          amont[(y0 + iy) * AW + it] = val < 0 ? 40 : 235;
        }
      }
    });
    writeFileSync(`${OUT}_axsec.pgm`,
      Buffer.concat([Buffer.from(`P5\n${AW} ${(AH + gap) * thetas.length}\n255\n`, 'ascii'), amont]));
    writeFileSync(`${OUT}.txt`,
      `depth range ${dmin.toFixed(3)}..${dmax.toFixed(3)} mm, grid ${g.nx}x${g.ny}x${g.nz}, img ${W}x${H}\n`
      + `xLo..xHi ${xLo.toFixed(2)}..${xHi.toFixed(2)} (axial=Hoehe, oben=xLo), theta ±${(thetaHalf*180/Math.PI).toFixed(0)}° (=Breite, Mitte=Loch-Scheitel)\n`);
  }, 120000);
});
