import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sampleRingRadii, type RingGap, type SaturnRing } from '../src/sim/solarSystemData';
import { mulberry32 } from '../src/procgen/rng';

const data = JSON.parse(readFileSync(new URL('../public/data/saturn-rings.json', import.meta.url), 'utf8')) as { rings: SaturnRing[]; gaps: RingGap[] };

describe("Saturn's ring gaps", () => {
  it('has the named gaps from the IAU table, with widths', () => {
    const gap = (n: string) => data.gaps.find((g) => g.name === n)!;
    // Encke Gap: 325 km wide at 133,570 km; Keeler Gap: 35 km wide at 136,505 km.
    expect(gap('Encke Gap').outer - gap('Encke Gap').inner).toBeCloseTo(325, -1);
    expect((gap('Encke Gap').outer + gap('Encke Gap').inner) / 2).toBeCloseTo(133570, -1);
    expect(gap('Keeler Gap').outer - gap('Keeler Gap').inner).toBeCloseTo(35, -1);
    expect(data.gaps.length).toBeGreaterThanOrEqual(10);
    // Every gap lies within the rings.
    for (const g of data.gaps) expect(data.rings.some((r) => g.inner >= r.inner - 400 && g.outer <= r.outer + 400), g.name).toBe(true);
  });

  it('keeps ring particles out of the gaps', () => {
    const rand = mulberry32(7);
    const samples = sampleRingRadii(data.rings, 20000, rand, data.gaps);
    const inGap = samples.filter(({ r }) => data.gaps.some((g) => r >= g.inner && r <= g.outer));
    expect(inGap).toHaveLength(0);
    // Without the gaps, the Encke Gap would catch some.
    const encke = data.gaps.find((g) => g.name === 'Encke Gap')!;
    const plain = sampleRingRadii(data.rings, 20000, mulberry32(7));
    expect(plain.filter(({ r }) => r >= encke.inner && r <= encke.outer).length).toBeGreaterThan(5);
  });
});
