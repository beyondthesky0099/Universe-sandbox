import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LESSONS } from '../src/game/lessons';
import { CHALLENGES } from '../src/game/challenges';
import { parseClusters } from '../src/sim/clusters';
import { parseCatalog } from '../src/sim/exoplanets';
import { namedFromSurvey, type LocalGalaxy } from '../src/sim/galaxies';
import { parseNebulae } from '../src/sim/nebulae';
import { PRESETS } from '../src/sim/presets';
import { normalize, SearchIndex, type SearchEntry } from '../src/ui/search';
import {
  activityEntries, clusterEntries, compactEntries, exoplanetEntries, galacticObjectEntries, galaxyEntries, inSkyAction, nebulaEntries, pulsarEntries, skyBodyEntries, starEntries, structureEntries,
} from '../src/ui/searchSources';
import { flattenObjects } from '../src/sim/galacticObjects';
import { universeEntries } from '../src/sim/galaxies';
import { parsePulsars } from '../src/sim/pulsars';

const data = (f: string) => JSON.parse(readFileSync(`public/data/${f}`, 'utf8'));
const named = data('galaxies-named.json');
const index = new SearchIndex();
index.add(skyBodyEntries());
index.add(starEntries(data('stars-bright.json').stars, data('stars-near.json').stars));
index.add(nebulaEntries(parseNebulae(data('nebulae.json'))));
index.add(clusterEntries(parseClusters(data('clusters.json'))));
index.add(compactEntries(data('compact-objects.json').objects));
index.add(exoplanetEntries(parseCatalog(data('exoplanets.json'))));
index.add(galaxyEntries([...(data('galaxies-local.json').galaxies as LocalGalaxy[]), ...namedFromSurvey(named.galaxies, named.H0), ...universeEntries(data('universe-objects.json'))]));
index.add(pulsarEntries(parsePulsars(data('pulsars.json'))));
index.add(galacticObjectEntries(flattenObjects(data('galactic-objects.json'))));
index.add(structureEntries());
index.add(
  activityEntries({
    presets: PRESETS, lessons: LESSONS, challenges: CHALLENGES,
    gw: data('gw-events.json').events, flybys: data('flybys.json').flybys ?? data('flybys.json'), voyager: data('voyager-encounters.json').encounters ?? [], eclipses: data('eclipses.json').eclipses ?? [],
  }),
);
const top = (q: string): SearchEntry => index.search(q)[0];

describe('search everything', () => {
  it('indexes every catalogue: tens of thousands of things', () => {
    expect(index.size).toBeGreaterThan(20000);
  });

  it('normalises names: case, spaces, punctuation, accents, Greek letters, "Messier"', () => {
    expect(normalize('NGC 2070')).toBe('ngc2070');
    expect(normalize('Messier 42')).toBe('m42');
    expect(normalize('Barnard’s Star')).toBe('barnardsstar');
    expect(normalize('α Centauri')).toBe('alphacentauri');
  });

  it('finds the famous objects first, each with the right place to go', () => {
    const cases: [string, string, string][] = [
      ['orion nebula', 'Orion Nebula (M42)', 'map'],
      ['orion', 'Orion Nebula (M42)', 'map'],
      ['m42', 'Orion Nebula (M42)', 'map'],
      ['horsehead', 'Horsehead Nebula (B33)', 'map'],
      ['pleiades', 'Pleiades (M45)', 'map'],
      ['omega cen', 'Omega Centauri', 'map'],
      ['crab', 'Crab Nebula (M1)', 'map'],
      ['sirius', 'Sirius', 'map'],
      ['betelgeuse', 'Betelgeuse', 'map'],
      ['jupiter', 'Jupiter', 'sky'],
      ['andromeda', 'Andromeda Galaxy (M31)', 'galaxy'],
      ['virgo cluster', 'Virgo Cluster', 'cosmos'],
      ['trappist', 'TRAPPIST-1', 'exo'],
      ['cygnus x-1', 'Cygnus X-1', 'map'],
      ['supernova zoo', 'Supernova Zoo', 'preset'],
      ['gw150914', 'GW150914', 'gw'],
    ];
    for (const [q, name, type] of cases) {
      const r = top(q);
      expect(r?.name, q).toBe(name);
      expect(r.action.type, q).toBe(type);
    }
  });

  it('in the Sky tab, turns to a star where it really is in the sky', () => {
    const bright = data('stars-bright.json').stars as [number, number, number, number, number, string, number][];
    for (const [q, name] of [['sirius', 'Sirius'], ['betelguese', 'Betelgeuse'], ['rigel', 'Rigel']]) {
      const r = top(q);
      expect(r.name, q).toBe(name);
      const a = inSkyAction(r.action, r.kind === 'Star');
      expect(a.type, q).toBe('sky');
      if (a.type !== 'sky') continue;
      const row = bright.find((s) => s[5] === name)!;
      // The same direction as the catalogue's own unit vector, to within 0.01° (the file rounds it to four decimals).
      const dot = (a.v[0] * row[0] + a.v[1] * row[1] + a.v[2] * row[2]) / Math.hypot(row[0], row[1], row[2]);
      expect(Math.acos(Math.min(1, dot)) * (180 / Math.PI), q).toBeLessThan(0.01);
      expect(a.radiusDeg, q).toBeUndefined();
    }
    // A nebula is framed by its size; a galaxy is still a Universe-tab trip.
    const m42 = inSkyAction(top('orion nebula').action, false);
    expect(m42.type).toBe('sky');
    if (m42.type === 'sky') expect(m42.radiusDeg).toBeGreaterThan(0.05);
    expect(inSkyAction(top('andromeda').action, false).type).toBe('galaxy');
  });

  it('finds catalogue designations and planets: NGC numbers, Lynds clouds, exoplanet names', () => {
    expect(index.search('ngc 7293').some((r) => /Helix/.test(r.name))).toBe(true);
    expect(index.search('LDN 1689').some((r) => /1689/.test(r.name))).toBe(true);
    const planet = index.search('trappist-1 e').find((r) => r.kind === 'Exoplanet');
    expect(planet?.action).toEqual({ type: 'exo', host: 'TRAPPIST-1' });
  });

  it('matches word starts ("car neb" → Carina Nebula) and ranks the current scene first', () => {
    expect(index.search('car neb')[0].name).toBe('Carina Nebula');
    expect(index.search('barnard').some((r) => r.name === "Barnard's Star")).toBe(true);
    const scene: SearchEntry[] = [{ name: 'Jupiter', kind: 'In this scene', rank: 100, action: { type: 'body', id: 5 } }];
    expect(index.search('jupiter', 5, scene)[0].kind).toBe('In this scene');
  });

  it('is fast enough to run on every keystroke', () => {
    const t0 = performance.now();
    for (const q of ['o', 'or', 'ori', 'orio', 'orion']) index.search(q);
    expect((performance.now() - t0) / 5).toBeLessThan(60);
  });
});

describe('search by kind', () => {
  const objects = flattenObjects(data('galactic-objects.json'));
  const names = (kinds: string[]) => new Set(objects.filter((o) => kinds.includes(o.kind)).map((o) => o.name));

  it('lists the famous members of a kind, ranked, for singular and plural queries', () => {
    const pulsars = index.search('pulsars');
    expect(pulsars.length).toBeGreaterThan(10);
    expect(pulsars.slice(0, 10).every((r) => /Pulsar|Magnetar/.test(r.kind))).toBe(true);
    expect(pulsars.slice(0, 10).some((r) => /Crab|Vela|B1919|J0437/.test(r.name))).toBe(true);
    // The singular also matches the scenarios named after pulsars; the pulsars themselves follow.
    expect(index.search('pulsar').slice(0, 4).some((r) => /Pulsar/.test(r.kind))).toBe(true);
    const agn = index.search('agn');
    expect(agn.length).toBeGreaterThan(10);
    expect(agn.slice(0, 10).every((r) => /Quasar|Seyfert|LINER|Blazar|BL Lac|nucleus/i.test(r.kind))).toBe(true);
    expect(agn.slice(0, 10).some((r) => /3C 273|M87|M77|Centaurus A/.test(r.name))).toBe(true);
    expect(index.search('quasars')[0].kind).toBe('Quasar');
    expect(index.search('seyfert')[0].kind).toMatch(/Seyfert|nucleus/);
    // "novae" and "cataclysmic variables" both give the white-dwarf binaries, famous ones first.
    const cvs = names(['nova', 'cv']);
    expect(index.search('novae').slice(0, 8).every((r) => cvs.has(r.name))).toBe(true);
    expect(index.search('novae').slice(0, 8).some((r) => /T CrB|RS Oph|GK Per|SS Cyg|V1500 Cyg/.test(r.name))).toBe(true);
    expect(index.search('cataclysmic variables').slice(0, 8).every((r) => cvs.has(r.name))).toBe(true);
    // (The challenge "Black Hole Snack" matches by name and may lead.)
    expect(index.search('black holes').slice(0, 6).filter((r) => /Black hole/.test(r.kind)).length).toBeGreaterThanOrEqual(4);
    expect(index.search('cepheids')[0].kind).toBe('Cepheid');
    expect(names(['cep']).has(index.search('cepheids')[0].name.replace(/ \(.*\)$/, ''))).toBe(true);
    expect(index.search('masers')[0].kind).toBe('Maser');
    // A name still beats a kind: "crab" is the nebula, not a list of pulsars.
    expect(index.search('crab')[0].name).toBe('Crab Nebula (M1)');
  });
});
