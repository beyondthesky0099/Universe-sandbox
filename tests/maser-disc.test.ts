import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { agnFor, agnLocalToScene, agnParams, AU_PER_PC, describeAgn, DISC_TILT } from '../src/sim/agn';
import { markActiveHosts, type LocalGalaxy, type UniverseObjects } from '../src/sim/galaxies';
import { SPIN_AXIS } from '../src/sim/kerr';
import {
  auPerMas,
  discAxes,
  earthDirection,
  maserDiscFor,
  maserSpots,
  NGC4258_MASERS as M,
  orbitalSpeed,
  pcPerMas,
  skyPosition,
  skyToLocal,
  skyVelocity,
  warpAt,
} from '../src/sim/maserDisc';
import { loadActiveNucleus } from '../src/sim/presets';
import { Simulation } from '../src/sim/simulation';

const DEG = Math.PI / 180;
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('the warped maser disc of NGC 4258', () => {
  it('uses the measured warp (Humphreys et al. 2013)', () => {
    expect(maserDiscFor('NGC 4258')).toBe(M);
    expect(maserDiscFor('NGC4258')).toBe(M);
    expect(maserDiscFor('MESSIER106')).toBe(M);
    expect(maserDiscFor('NGC 1068')).toBeUndefined();
    // 1 mas at 7.6 Mpc is 0.0368 pc, about 7,600 AU.
    expect(pcPerMas(M)).toBeCloseTo(0.03685, 4);
    expect(auPerMas(M)).toBeGreaterThan(7550);
    expect(auPerMas(M)).toBeLessThan(7650);
    // The systemic masers at 0.14 pc, where the disc is tilted 81° to us (Herrnstein et al. 2005).
    expect(M.systemicMas * pcPerMas(M)).toBeCloseTo(0.14, 1);
    expect(warpAt(M, M.systemicMas).i / DEG).toBeCloseTo(81.3, 0);
    // Past about 7.3 mas the outer disc turns beyond edge-on.
    expect(warpAt(M, M.outerMas).i / DEG).toBeGreaterThan(90);
  });

  it('puts the masers where they are seen, moving as they are measured', () => {
    // Orbital speed at the systemic radius, from 4.0 × 10⁷ M☉: about 1,100 km/s, falling off as r^−½.
    expect(orbitalSpeed(M, M.systemicMas)).toBeGreaterThan(1050);
    expect(orbitalSpeed(M, M.systemicMas)).toBeLessThan(1120);
    expect(orbitalSpeed(M, 4 * M.systemicMas) / orbitalSpeed(M, M.systemicMas)).toBeCloseTo(0.5, 9);
    // Positions and velocities are perpendicular (circular orbits) and the motion is about +n.
    for (const [r, phi] of [[4, 0.3], [6, 2], [8, -1.2]]) {
      const p = skyPosition(M, r, phi), v = skyVelocity(M, r, phi);
      expect(dot(p, v)).toBeCloseTo(0, 6);
      const { n } = discAxes(M, r);
      const L = [p[1] * v[2] - p[2] * v[1], p[2] * v[0] - p[0] * v[2], p[0] * v[1] - p[1] * v[0]];
      expect(dot(L, n) / Math.hypot(...L)).toBeCloseTo(1, 9);
      expect(Math.hypot(...p)).toBeCloseTo(r, 9);
    }
    const spots = maserSpots(M);
    const reds = spots.filter((s) => s.kind === 'red'), blues = spots.filter((s) => s.kind === 'blue'), sys = spots.filter((s) => s.kind === 'systemic');
    expect(reds.length).toBeGreaterThan(blues.length);
    const sky = (s: (typeof spots)[number]) => skyPosition(M, s.rMas, s.phi);
    // Redshifted masers east of the hole, blueshifted ones west, at the velocities observed
    // (Humphreys et al. 2013, Table 1: 1,227.5 to 1,647.5 and −516.5 to −280.5 km/s), to within
    // the few degrees the spots scatter off the midline.
    for (const s of reds) {
      expect(sky(s)[0]).toBeGreaterThan(2.5);
      expect(s.vObs).toBeGreaterThan(1227.5 - 5);
      expect(s.vObs).toBeLessThan(1647.5 + 1);
    }
    for (const s of blues) {
      expect(sky(s)[0]).toBeLessThan(-4);
      expect(s.vObs).toBeGreaterThan(-516.5 - 1);
      expect(s.vObs).toBeLessThan(-280.5 + 5);
    }
    // Systemic masers in front of the hole (towards us), within the observed 382.5 to 577.5 km/s.
    for (const s of sys) {
      expect(sky(s)[2]).toBeLessThan(0);
      expect(s.vObs).toBeGreaterThan(382.5);
      expect(s.vObs).toBeLessThan(577.5);
      // A few hundredths of a parsec in front: about 0.14 pc × sin 81°.
      expect(-sky(s)[2] * pcPerMas(M)).toBeGreaterThan(0.12);
    }
  });

  it('places the disc in the nucleus frame, seen from Earth', () => {
    // The local frame: +z is the disc's normal at the systemic masers.
    const { n } = discAxes(M, M.systemicMas);
    const loc = skyToLocal(M, n);
    expect(loc[2]).toBeCloseTo(1, 9);
    // Earth is 180° − 81.3° from the angular momentum: we see the disc's underside, nearly edge-on.
    const e = earthDirection(M);
    expect(Math.acos(e[2]) / DEG).toBeCloseTo(180 - 81.3, 0);
    // agnLocalToScene is the renderer's turn about x by −π/2 + DISC_TILT.
    const rot = new THREE.Euler(-Math.PI / 2 + DISC_TILT, 0, 0);
    for (const v of [[0, 0, 1], [1, 0, 0], [0, 1, 0], [0.3, -0.5, 0.8]] as [number, number, number][]) {
      const t = new THREE.Vector3(...v).applyEuler(rot);
      const s = agnLocalToScene(v);
      expect(s[0]).toBeCloseTo(t.x, 9);
      expect(s[1]).toBeCloseTo(t.y, 9);
      expect(s[2]).toBeCloseTo(t.z, 9);
    }
    const z = agnLocalToScene([0, 0, 1]);
    for (let a = 0; a < 3; a++) expect(z[a]).toBeCloseTo(SPIN_AXIS[a], 9);
  });

  it('builds the nucleus scene with the maser disc in place of a torus', () => {
    const raw: UniverseObjects = JSON.parse(readFileSync(new URL('../public/data/universe-objects.json', import.meta.url), 'utf8'));
    const local: LocalGalaxy[] = JSON.parse(readFileSync(new URL('../public/data/galaxies-local.json', import.meta.url), 'utf8')).galaxies;
    markActiveHosts(local, raw);
    const g = local.find((x) => x.name === 'NGC4258')!;
    const p = agnParams(g, 'NGC 4258');
    expect(p.maser).toBe(M);
    expect(p.mass).toBe(4.0e7);
    expect(p.luminosityMeasured).toBe(true);
    expect(p.eddington).toBeLessThan(1e-3); // highly sub-Eddington (Herrnstein et al. 2005)
    expect(p.torusInnerAu / AU_PER_PC).toBeCloseTo(0.1, 1);
    expect(p.torusOuterAu / AU_PER_PC).toBeCloseTo(0.31, 1);
    expect(p.viewAngle / DEG).toBeCloseTo(98.7, 0);
    expect(describeAgn(p)).toContain('Humphreys et al. 2013');

    const sim = new Simulation();
    const setup = loadActiveNucleus(sim, g, 'NGC 4258');
    expect(agnFor('NGC 4258')?.maser).toBe(M);
    expect(sim.particles.count).toBe(700 + 1600);
    // The camera starts where Earth is.
    const e = agnLocalToScene(earthDirection(M));
    expect(setup.viewFrom).toEqual(e);
    expect(setup.cameraDistance).toBeGreaterThan(p.jetLengthAu);
    // The gas keeps the warp as it orbits: inner and outer rings' planes differ by about 20°.
    const hole = sim.bodies.find((b) => b.kind === 'blackhole')!;
    const normalAt = (lo: number, hi: number) => {
      const sum = [0, 0, 0];
      const P = sim.particles;
      for (let k = 700; k < P.count; k++) {
        const x = [P.pos[3 * k] - hole.x, P.pos[3 * k + 1] - hole.y, P.pos[3 * k + 2] - hole.z];
        const v = [P.vel[3 * k] - hole.vx, P.vel[3 * k + 1] - hole.vy, P.vel[3 * k + 2] - hole.vz];
        const r = Math.hypot(...x) / auPerMas(M);
        if (r < lo || r > hi) continue;
        const L = [x[1] * v[2] - x[2] * v[1], x[2] * v[0] - x[0] * v[2], x[0] * v[1] - x[1] * v[0]];
        const l = Math.hypot(...L);
        for (let a = 0; a < 3; a++) sum[a] += L[a] / l;
      }
      const s = Math.hypot(...sum);
      return sum.map((c) => c / s);
    };
    const before = [normalAt(2.8, 3.4), normalAt(7.7, 8.3)];
    const angle = (a: number[], b: number[]) => Math.acos(Math.min(1, dot(a, b))) / DEG;
    const expected = angle(agnLocalToScene(skyToLocal(M, discAxes(M, 3.1).n)), agnLocalToScene(skyToLocal(M, discAxes(M, 8).n)));
    expect(angle(before[0], before[1])).toBeCloseTo(expected, 0);
    expect(expected).toBeGreaterThan(15);
    // Circular speeds: about 1,200 km/s at the inner edge.
    const k = 700;
    const r = Math.hypot(sim.particles.pos[3 * k] - hole.x, sim.particles.pos[3 * k + 1] - hole.y, sim.particles.pos[3 * k + 2] - hole.z);
    const v = Math.hypot(sim.particles.vel[3 * k] - hole.vx, sim.particles.vel[3 * k + 1] - hole.vy, sim.particles.vel[3 * k + 2] - hole.vz);
    expect(v * v * r / (4 * Math.PI * Math.PI * hole.mass)).toBeCloseTo(1, 2);
  });
});
