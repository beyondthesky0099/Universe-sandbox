import { describe, expect, it } from 'vitest';
import { BUILT_IN_PLACES, decodePlace, encodePlace, PlaceStore, placeSummary, validPlace, type Place } from '../src/ui/places';

const sky: Place = { id: 'a', name: 'Orion from Mauna Kea', created: 1, fov: 40, view: { kind: 'sky', date: '2026-12-01T09:00:00.000Z', lat: 19.82, lon: -155.47, alt: 45, az: 120 } };
const near: Place = { id: 'b', name: 'Near Saturn', created: 2, view: { kind: 'system', scenario: 'Solar System (today)', presetId: 'solar', follow: 'Saturn', camera: [2, 1, 2], target: [0, 0, 0] } };

function memory(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('places', () => {
  it('round-trips a place through a link', () => {
    for (const p of [sky, near]) {
      const back = decodePlace(encodePlace(p))!;
      expect(back.name).toBe(p.name);
      expect(back.view).toEqual(p.view);
    }
    expect(encodePlace(near)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('rejects broken or hostile places', () => {
    expect(decodePlace('not base64 json')).toBeUndefined();
    expect(validPlace({ name: 'x', view: { kind: 'system', scenario: 's', camera: [1, 2], target: [0, 0, 0] } })).toBe(false);
    expect(validPlace({ name: 'x', view: { kind: 'sky', date: 'never', lat: 0, lon: 0, alt: 0, az: 0 } })).toBe(false);
    expect(validPlace({ name: 'x', view: { kind: 'sky', date: '2026-01-01', lat: 95, lon: 0, alt: 0, az: 0 } })).toBe(false);
    expect(validPlace({ name: 'x', view: { kind: 'rm -rf' } })).toBe(false);
    expect(validPlace({ name: '', view: { kind: 'cosmos', camera: [0, 0, 1], target: [0, 0, 0] } })).toBe(false);
    for (const p of BUILT_IN_PLACES) expect(validPlace(p)).toBe(true);
  });

  it('keeps places in storage, newest first', () => {
    const storage = memory();
    const store = new PlaceStore(storage);
    store.add(sky);
    store.add(near);
    expect(new PlaceStore(storage).places.map((p) => p.id)).toEqual(['b', 'a']);
    store.rename('a', '  Orion  ');
    store.remove('b');
    expect(new PlaceStore(storage).places.map((p) => p.name)).toEqual(['Orion']);
    // Corrupt storage starts empty.
    storage.data.set('astrarium.places', '{oops');
    expect(new PlaceStore(storage).places).toEqual([]);
  });

  it('describes places', () => {
    expect(placeSummary(near)).toBe('Sandbox · near Saturn');
    expect(placeSummary(sky)).toContain('19.8°, -155.5°');
  });
});
