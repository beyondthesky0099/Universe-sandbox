/**
 * Real Milky Way pulsars from the ATNF Pulsar Catalogue (scripts/build-pulsars.mjs): 3,600 with a
 * period, a distance and a position.
 */
import { characteristicAge, dipoleField, formatYears, sci } from './neutronStar';

export interface PulsarRecord {
  jname: string;
  bname?: string;
  /** Spin period (s) and spin-down rate (s/s; 0 if unknown). */
  period: number;
  pdot: number;
  distanceKpc: number;
  raDeg: number;
  decDeg: number;
  magnetar: boolean;
  binary: boolean;
  highEnergy: boolean;
  globular: boolean;
  rrat: boolean;
  /** The supernova remnant it sits in, if any. */
  snr?: string;
  /** Binary orbit: period (days), eccentricity, median companion mass (M☉); 0 when unknown. */
  pbDays: number;
  ecc: number;
  companionMass: number;
}

type Row = [string, string, number, number, number, number, number, string, number, number, number, string?];

export function parsePulsars(raw: { rows: Row[] }): PulsarRecord[] {
  return raw.rows.map(([jname, bname, period, pdot, distanceKpc, raDeg, decDeg, flags, pbDays, ecc, companionMass, snr]) => ({
    jname,
    bname: bname || undefined,
    period,
    pdot,
    distanceKpc,
    raDeg,
    decDeg,
    magnetar: flags.includes('m'),
    binary: flags.includes('b'),
    highEnergy: flags.includes('h'),
    globular: flags.includes('g'),
    rrat: flags.includes('r'),
    snr,
    pbDays,
    ecc,
    companionMass,
  }));
}

/** Millisecond (recycled) pulsars: spun up by a companion, with weak fields and tiny spin-down. */
export function isMillisecond(p: Pick<PulsarRecord, 'period' | 'pdot'>): boolean {
  return p.period < 0.03 && (p.pdot === 0 || p.pdot < 1e-17);
}

/** The name people use: "PSR B0531+21" if it has a B name, else "PSR J…". */
export function pulsarName(p: Pick<PulsarRecord, 'jname' | 'bname'>): string {
  return `PSR ${p.bname ?? p.jname}`;
}

/** One line about it: kind, period, field and age. */
export function describePulsar(p: PulsarRecord): string {
  const kind = p.magnetar ? 'magnetar' : isMillisecond(p) ? 'millisecond pulsar' : p.rrat ? 'rotating radio transient' : 'pulsar';
  const per = p.period < 1 ? `${(p.period * 1000).toPrecision(3)} ms` : `${p.period.toPrecision(3)} s`;
  const parts = [kind, `spins every ${per}`];
  if (p.pdot > 0) {
    const b = dipoleField(p.period, p.pdot);
    parts.push(`field ${sci(b, 'G')}`);
    parts.push(`${formatYears(characteristicAge(p.period, p.pdot))} old`);
  }
  if (p.snr) parts.push(`in the ${p.snr} remnant`);
  if (p.globular) parts.push('in a globular cluster');
  else if (p.binary) parts.push('with a companion');
  return parts.join(' · ');
}

let promise: Promise<PulsarRecord[]> | undefined;

export function loadPulsars(baseUrl = import.meta.env.BASE_URL): Promise<PulsarRecord[]> {
  promise ??= fetch(`${baseUrl}data/pulsars.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`pulsars.json: HTTP ${r.status}`);
      return r.json();
    })
    .then(parsePulsars);
  return promise;
}
