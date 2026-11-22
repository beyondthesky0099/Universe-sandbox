/**
 * How accreting white-dwarf binaries change with time (headless): dwarf-nova outbursts and nova
 * eruptions, for the Sandbox scenes of sim/massTransfer.ts.
 *
 * Dwarf novae. The disc can't pass gas inwards as fast as the donor supplies it, so it fills up
 * until hydrogen in it ionizes, its viscosity jumps, and it drains onto the white dwarf in a few
 * days: an outburst (the disc-instability model; Osaki 1996, Lasota 2001). Recurrence times are
 * typical for each subtype (Warner 1995, Cataclysmic Variable Stars, ch. 3), and the amplitude
 * follows the Kukarkin–Parenago relation, A = 0.7 + 1.9 log₁₀ Tₙ (days). SU UMa stars add longer,
 * brighter superoutbursts; WZ Sge stars have only those, decades apart. Over a whole cycle the disc
 * swallows what the donor supplies, which fixes its peak accretion rate.
 *
 * Novae. Hydrogen piles up on the white dwarf until the pressure at the base of the layer reaches
 * about 2 × 10¹⁹ dyn/cm² and it ignites (Fujimoto 1982; Truran & Livio 1986): the ignition mass is
 * ΔM = 4πR⁴P/(GM), so a massive, small white dwarf erupts after a far thinner layer. The eruption
 * reaches the catalogue's peak brightness, fades by 3 magnitudes in t₃, and throws off a shell at
 * about half the emission lines' full width.
 */

export type DwarfNovaKind = 'UG' | 'ZC' | 'SU' | 'ER' | 'WZ';

export interface DwarfNovaCycle {
  kind: DwarfNovaKind;
  /** Days between normal outbursts, and between superoutbursts (SU UMa, ER UMa, WZ Sge). */
  recurrenceDays: number;
  superDays?: number;
  /** Amplitudes (magnitudes) of normal outbursts and superoutbursts. */
  amplitude: number;
  superAmplitude?: number;
  /** Rise (days), plateau of a normal outburst and of a superoutburst (days), decline (magnitudes a day). */
  riseDays: number;
  plateauDays: number;
  superPlateauDays: number;
  declinePerDay: number;
  /** Simulation time (years) of the first outburst's start. */
  startYears: number;
  /** The disc's accretion rate at an outburst's peak (M☉/yr), from the cycle's mass budget. */
  peakRate: number;
}

/** Kukarkin–Parenago: the outburst amplitude (mag) for a recurrence time in days. */
export function kukarkinParenago(days: number): number {
  return 0.7 + 1.9 * Math.log10(days);
}

/**
 * The dwarf-nova subtype of a cataclysmic variable from its Ritter & Kolb codes, if it is one.
 * Superoutbursts need a disc big enough to reach the 3:1 tidal resonance, so a small mass ratio:
 * in practice periods under about 3 hours. Longer-period systems flagged SU (U Gem itself) are
 * treated as ordinary U Gem stars.
 */
export function dwarfNovaKind(types: readonly string[] | undefined, periodDays?: number): DwarfNovaKind | undefined {
  if (!types) return undefined;
  const short = periodDays === undefined || periodDays * 24 < 3.2;
  if (short && types.includes('WZ')) return 'WZ';
  if (short && types.includes('ER')) return 'ER';
  if (short && types.includes('SU')) return 'SU';
  if (types.includes('ZC')) return 'ZC';
  if (types.some((t) => t === 'DN' || t === 'UG' || t === 'SS' || t === 'SU' || t === 'WZ' || t === 'ER')) return 'UG';
  return undefined;
}

/** Typical recurrence times (days) by subtype: normal outbursts and supercycles. */
const TYPICAL: Record<DwarfNovaKind, { tn: number; ts?: number }> = {
  UG: { tn: 50 },
  ZC: { tn: 20 },
  SU: { tn: 20, ts: 250 },
  ER: { tn: 4, ts: 45 },
  WZ: { tn: 11000, ts: 11000 },
};

/**
 * A dwarf nova's cycle. `transferRate` is the donor's (M☉/yr); `startYears` when the first
 * outburst begins.
 */
export function dwarfNovaCycle(kind: DwarfNovaKind, transferRate: number, startYears: number): DwarfNovaCycle {
  const t = TYPICAL[kind];
  const onlySuper = kind === 'WZ';
  const amplitude = kukarkinParenago(t.tn);
  const cycle: DwarfNovaCycle = {
    kind,
    recurrenceDays: t.tn,
    superDays: t.ts,
    amplitude,
    // Superoutbursts peak about 0.7 mag above normal ones (Warner 1995).
    superAmplitude: t.ts ? (onlySuper ? amplitude : amplitude + 0.7) : undefined,
    riseDays: 1,
    plateauDays: 2,
    superPlateauDays: onlySuper ? 20 : 12,
    declinePerDay: 1,
    startYears,
    peakRate: 0,
  };
  // Mass budget: the mean disc rate over a (super)cycle equals the transfer rate.
  const span = (t.ts ?? t.tn) / 365.25;
  let mean = 0;
  const n = 4000;
  for (let k = 0; k < n; k++) mean += Math.pow(10, -0.4 * magnitudeBelowPeak(cycle, startYears + (span * (k + 0.5)) / n));
  mean /= n;
  cycle.peakRate = transferRate / mean;
  return cycle;
}

/** Days since the latest outburst began, and whether it is a superoutburst. */
function outburstPhase(c: DwarfNovaCycle, tYears: number): { days: number; superOutburst: boolean } | undefined {
  const days = (tYears - c.startYears) * 365.25;
  if (days < 0) return undefined;
  if (c.kind === 'WZ') return { days: days % c.recurrenceDays, superOutburst: true };
  const k = Math.floor(days / c.recurrenceDays);
  const perSuper = c.superDays ? Math.max(1, Math.round(c.superDays / c.recurrenceDays)) : 0;
  return { days: days - k * c.recurrenceDays, superOutburst: perSuper > 0 && k % perSuper === 0 };
}

/**
 * Magnitudes below the outburst peak at a time: the amplitude in quiescence, 0 at the peak. A
 * superoutburst's plateau fades slowly (0.1 mag a day) before the final drop.
 */
export function magnitudeBelowPeak(c: DwarfNovaCycle, tYears: number): number {
  const sup = c.superAmplitude ?? c.amplitude;
  const quiet = Math.max(sup, c.amplitude);
  const ph = outburstPhase(c, tYears);
  if (!ph) return quiet;
  const amp = ph.superOutburst ? sup : c.amplitude;
  const peakOffset = quiet - amp;
  const plateau = ph.superOutburst ? c.superPlateauDays : c.plateauDays;
  const d = ph.days;
  if (d < c.riseDays) return quiet - amp * (d / c.riseDays);
  if (d < c.riseDays + plateau) return peakOffset + (ph.superOutburst ? 0.1 * (d - c.riseDays) : 0);
  const end = peakOffset + (ph.superOutburst ? 0.1 * plateau : 0);
  return Math.min(quiet, end + c.declinePerDay * (d - c.riseDays - plateau));
}

/** The disc's accretion rate (M☉/yr) at a time: the peak rate dimmed by the magnitudes below the peak. */
export function discRate(c: DwarfNovaCycle, tYears: number): number {
  return c.peakRate * Math.pow(10, -0.4 * magnitudeBelowPeak(c, tYears));
}

// --- Novae ---------------------------------------------------------------------------------

const G = 6.674e-8;
const MSUN = 1.989e33;
const RSUN = 6.957e10;
/** Pressure at the base of the accreted layer that sets off the runaway (dyn/cm²). */
export const IGNITION_PRESSURE = 2e19;

/** White-dwarf radius (R☉) from Nauenberg's (1972) mass–radius relation, shrinking to zero at the Chandrasekhar mass. */
export function nauenbergRadius(mass: number): number {
  const x = Math.min(mass, 1.43) / 1.44;
  return 0.0112 * Math.sqrt(Math.pow(x, -2 / 3) - Math.pow(x, 2 / 3));
}

/** Hydrogen (M☉) a white dwarf must gather before it erupts: ΔM = 4πR⁴P/(GM). */
export function ignitionMass(mass: number): number {
  const r = nauenbergRadius(mass) * RSUN;
  return (4 * Math.PI * r ** 4 * IGNITION_PRESSURE) / (G * mass * MSUN) / MSUN;
}

export interface NovaEruption {
  /** When it starts (simulation years), its peak absolute magnitude, days to fade 3 magnitudes. */
  startYears: number;
  peakMag: number;
  t3Days: number;
  /** Ejecta speed (km/s), ejected mass (M☉), and the eruption's year if catalogued. */
  ejectaKms: number;
  ejectaMass: number;
  year?: number;
  recurrent: boolean;
  /** Years between eruptions at this transfer rate (classical novae), or the rate a recurrence of a few decades needs (recurrent). */
  recurrenceYears?: number;
  requiredRate?: number;
  /** Which values the catalogue didn't give. */
  assumed: string[];
}

/** Rise to the peak (days): novae climb the last magnitudes in about a day. */
const RISE_DAYS = 1;

export function novaEruption(o: { vmag?: number; t3?: number; fwhm?: number; year?: number; recurrent?: boolean }, wdMass: number, transferRate: number, startYears: number): NovaEruption {
  const assumed: string[] = [];
  if (o.vmag === undefined) assumed.push('the peak brightness');
  if (!o.t3) assumed.push('the fading time');
  if (!o.fwhm) assumed.push('the ejecta speed');
  const ejectaMass = ignitionMass(wdMass);
  const recurrent = !!o.recurrent;
  return {
    startYears,
    peakMag: o.vmag ?? -7.5,
    t3Days: o.t3 ?? 30,
    ejectaKms: o.fwhm ? o.fwhm / 2 : 1000,
    ejectaMass,
    year: o.year,
    recurrent,
    // A recurrent nova repeats within decades (the ten known in the Galaxy: 10–80 years).
    ...(recurrent ? { requiredRate: ejectaMass / 30 } : { recurrenceYears: ejectaMass / transferRate }),
    assumed,
  };
}

/** The eruption's absolute magnitude at a time (undefined before it starts or once it has faded by 6 mag). */
export function novaMagnitude(e: NovaEruption, tYears: number): number | undefined {
  const d = (tYears - e.startYears) * 365.25;
  if (d < 0) return undefined;
  // From 6 mag below the peak up to it in about a day, then 3 mag per t₃.
  const m = d < RISE_DAYS ? e.peakMag + 6 * (1 - d / RISE_DAYS) : e.peakMag + (3 * (d - RISE_DAYS)) / e.t3Days;
  return m > e.peakMag + 6 ? undefined : m;
}

/** The eruption's luminosity (erg/s) from its absolute magnitude (bolometric correction ignored). */
export function novaLuminosity(e: NovaEruption, tYears: number): number {
  const m = novaMagnitude(e, tYears);
  return m === undefined ? 0 : 3.828e33 * Math.pow(10, -0.4 * (m - 4.74));
}

/** The ejected shell's radius (AU) at a time. */
export function shellRadius(e: NovaEruption, tYears: number): number {
  const dt = tYears - e.startYears;
  return dt > 0 ? (e.ejectaKms / 4.7406) * dt : 0;
}

/**
 * How much of the disc survives (0–1): the ejecta blow it away as they pass, and it builds up
 * again over a few weeks (illustrative: e-folding in 20 days).
 */
export function discSurvival(e: NovaEruption, tYears: number): number {
  const d = (tYears - e.startYears) * 365.25;
  if (d < 0) return 1;
  if (d < 0.3) return 1 - 0.95 * (d / 0.3);
  return 1 - 0.95 * Math.exp(-(d - 0.3) / 20);
}

function sci(x: number): string {
  const e = Math.floor(Math.log10(x));
  const m = x / 10 ** e;
  return `${m.toFixed(m < 2 ? 1 : 0)} × 10^${e}`;
}

export function describeDwarfNova(c: DwarfNovaCycle): string {
  const sup = c.superDays && c.kind !== 'WZ' ? ` Every ${c.superDays} days or so comes a longer, brighter superoutburst.` : '';
  const when =
    c.kind === 'WZ'
      ? `It stays quiet for decades between outbursts (WZ Sge: 1913, 1946, 1978, 2001), then brightens about ${c.amplitude.toFixed(0)} magnitudes for a few weeks.`
      : `Every ${c.recurrenceDays} days or so (typical for its type) the disc switches to a hot, viscous state and drains onto the white dwarf, the disc brightening about ${c.amplitude.toFixed(1)} magnitudes for a few days.${sup}`;
  return `${when} Watch the disc heat up and turn blue-white; the live graph (📈 → Brightness) draws the light curve in visible light, where the steady donor softens the rise. The scene starts just before an outburst.`;
}

export function describeNovaEruption(e: NovaEruption): string {
  const yr = e.year ? `its ${Math.floor(e.year)} eruption` : 'an eruption';
  const next = e.recurrent
    ? ` It is a recurrent nova, erupting again within decades; to do that it must pile up its ${sci(e.ejectaMass)} M☉ trigger layer at about ${sci(e.requiredRate!)} M☉ a year.`
    : ` It erupts once about ${sci(e.ejectaMass)} M☉ of hydrogen has piled up; at today's transfer rate the next eruption is about ${sci(e.recurrenceYears!)} years away.`;
  const assumed = e.assumed.length ? ` Not catalogued, so typical values are used for ${e.assumed.join(', ')}.` : '';
  return `The scene replays ${yr}: the hydrogen on the white dwarf ignites, it flares to absolute magnitude ${e.peakMag.toFixed(1)} and fades 3 magnitudes in ${Math.round(e.t3Days)} days (speed up time to follow it), throwing off a shell at ${Math.round(e.ejectaKms).toLocaleString('en-US')} km/s that blows the disc away for a while.${next}${assumed}`;
}
