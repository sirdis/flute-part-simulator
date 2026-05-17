import { describe, it, expect } from 'vitest';
import { machineToWorld } from '../renderer/ToolPath';

// Constant-radius workpiece for simple tests
const flatRadius = (_y: number) => 10;

describe('machineToWorld – axis mapping', () => {
  // Core invariant: machine Y (longitudinal) must map to world X.
  // This was the bug that placed all holes in a column.

  it('machine Y maps to world X', () => {
    const pt = machineToWorld(0, 42, 0, 0, flatRadius);
    expect(pt.x).toBeCloseTo(42);
  });

  it('machine X=0, Z=0, A=0 → tool sits on +Z surface', () => {
    // At A=0: worldY = depth*sin(0) = 0, worldZ = depth*cos(0) = depth = r+mz = 10
    const pt = machineToWorld(0, 0, 0, 0, flatRadius);
    expect(pt.y).toBeCloseTo(0);
    expect(pt.z).toBeCloseTo(10);
  });

  it('A=90° rotates tool to +Y surface', () => {
    const pt = machineToWorld(0, 0, 0, 90, flatRadius);
    expect(pt.y).toBeCloseTo(10);
    expect(pt.z).toBeCloseTo(0, 5);
  });

  it('A=180° rotates tool to -Z surface', () => {
    const pt = machineToWorld(0, 0, 0, 180, flatRadius);
    expect(pt.y).toBeCloseTo(0, 5);
    expect(pt.z).toBeCloseTo(-10);
  });

  it('A=270° rotates tool to -Y surface', () => {
    const pt = machineToWorld(0, 0, 0, 270, flatRadius);
    expect(pt.y).toBeCloseTo(-10);
    expect(pt.z).toBeCloseTo(0, 5);
  });
});

describe('machineToWorld – depth (Z)', () => {
  it('negative Z moves tool toward centre', () => {
    // mz = -3 → depth = 10 - 3 = 7
    const pt = machineToWorld(0, 0, -3, 0, flatRadius);
    expect(pt.z).toBeCloseTo(7);
  });

  it('zero depth when Z equals negative radius', () => {
    // mz = -10 → depth = 0 → tool at workpiece centre
    const pt = machineToWorld(0, 0, -10, 0, flatRadius);
    expect(pt.y).toBeCloseTo(0);
    expect(pt.z).toBeCloseTo(0);
  });
});

describe('machineToWorld – variable radius', () => {
  it('uses radius at the given machine Y position', () => {
    // Linearly varying radius: 5 at Y=0, 15 at Y=100
    const varyingRadius = (y: number) => 5 + y * 0.1;
    const pt = machineToWorld(0, 50, 0, 0, varyingRadius); // r=10 at Y=50
    expect(pt.z).toBeCloseTo(10);
    expect(pt.x).toBeCloseTo(50);
  });
});

describe('machineToWorld – cross axis (machine X)', () => {
  it('machine X shifts tool perpendicular to radius at A=0', () => {
    // At A=0: worldY += machX*cos(0) = machX, worldZ unchanged
    const pt = machineToWorld(3, 0, 0, 0, flatRadius);
    expect(pt.y).toBeCloseTo(3);
    expect(pt.z).toBeCloseTo(10);
  });

  it('machine X shifts perpendicular to radius at A=90', () => {
    // At A=90°: worldZ -= machX*sin(90) = machX
    const pt = machineToWorld(2, 0, 0, 90, flatRadius);
    expect(pt.z).toBeCloseTo(-2);
    expect(pt.y).toBeCloseTo(10);
  });
});
