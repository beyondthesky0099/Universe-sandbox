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
  activityEntries, clusterEntries, compactEntries, exoplanetEntries, galaxyEntries, nebulaEntries, skyBodyEntries, starEntries, structureEntries,
} from '../src/ui/searchSources';

const data = (f: string) => JSON.parse(readFileSync(`public/data/${f}`, 'utf8'));
const named = data('galaxies-named.json');
const index = new SearchIndex();
index.add(skyBodyEntries());
index.add(starEntries(data('stars-bright.json').stars, data('stars-near.json').stars));
index.add(nebulaEntries(parseNebulae(data('nebulae.json'))));
index.add(clusterEntries(parseClusters(data('clusters.json'))));
index.add(compactEntries(data('compact-objects.json').objects));
index.add(exoplanetEntries(parseCatalog(data('exoplanets.json'))));
index.add(galaxyEntries([...(data('galaxies-local.json').galaxies as LocalGalaxy[]), ...namedFromSurvey(named.galaxies, named.H0)]));
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
      ['sirius', 'Sirius', 'sky'],
      ['betelgeuse', 'Betelgeuse', 'sky'],
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
