import { $ } from '../ui/dom';
import { ACCELERATION_START_A, ageAtScale, compositionAt, decelerationAt, hubbleAt, LAST_SCATTERING_Z, scaleFactorAtAge, UNIVERSE_AGE_GYR } from '../sim/cosmology';
import type { App } from '../app';

/**
 * Cosmic history in the Universe view: a time slider from the afterglow to the far future. The map
 * shrinks and grows with the scale factor (Planck 2018 ΛCDM, sim/cosmology.ts), and the panel
 * says how old, how big, how fast and what the universe is made of at that moment.
 */
interface Epoch {
  name: string;
  ageGyr: number;
  about: string;
}

const AGE_FIRST_STARS = 0.18;
const EPOCHS: Epoch[] = [
  { name: 'Afterglow', ageGyr: ageAtScale(1 / (1 + LAST_SCATTERING_Z)), about: 'The universe cools enough for atoms to form and light to fly free: the cosmic microwave background, still arriving today. No stars yet.' },
  { name: 'Dark Ages', ageGyr: 0.05, about: 'Hydrogen and helium gas, slowly gathering into clumps of dark matter. Nothing shines yet.' },
  { name: 'First stars', ageGyr: AGE_FIRST_STARS, about: 'The first stars light up, around 100–200 million years after the Big Bang (when exactly is still being measured, by JWST among others).' },
  { name: 'Reionization', ageGyr: ageAtScale(1 / 7), about: 'By redshift 6, about a billion years in, the light of the first galaxies has split the gas between them back into ions.' },
  { name: 'Cosmic noon', ageGyr: ageAtScale(1 / 3), about: 'Around redshift 2, galaxies are making stars faster than ever before or since.' },
  { name: 'Speeding up', ageGyr: ageAtScale(ACCELERATION_START_A), about: 'Dark energy starts to win over the pull of matter: from here on the expansion speeds up instead of slowing down.' },
  { name: 'Sun forms', ageGyr: UNIVERSE_AGE_GYR - 4.57, about: 'The Sun and its planets form, 4.57 billion years ago.' },
  { name: 'Today', ageGyr: UNIVERSE_AGE_GYR, about: 'Now, 13.8 billion years after the Big Bang.' },
  { name: 'Far future', ageGyr: 30, about: 'If dark energy stays as it is, the expansion keeps speeding up: distant galaxies slip out of sight and the Local Group is left alone.' },
];

const T0 = EPOCHS[0].ageGyr;
const STEPS = 1000;
const NOW_STEP = 900;

/** Slider position → age: logarithmic up to today, linear into the future. */
function ageOf(step: number): number {
  if (step <= NOW_STEP) return Math.exp(Math.log(T0) + (Math.log(UNIVERSE_AGE_GYR) - Math.log(T0)) * (step / NOW_STEP));
  return UNIVERSE_AGE_GYR + ((step - NOW_STEP) / (STEPS - NOW_STEP)) * (30 - UNIVERSE_AGE_GYR);
}
function stepOf(age: number): number {
  if (age <= UNIVERSE_AGE_GYR) return Math.round((NOW_STEP * (Math.log(age) - Math.log(T0))) / (Math.log(UNIVERSE_AGE_GYR) - Math.log(T0)));
  return Math.round(NOW_STEP + ((age - UNIVERSE_AGE_GYR) / (30 - UNIVERSE_AGE_GYR)) * (STEPS - NOW_STEP));
}

function formatAge(gyr: number): string {
  if (gyr < 0.001) return `${(Math.round(gyr * 1e6) * 1000).toLocaleString("en-US")} years`;
  if (gyr < 1) return `${Math.round(gyr * 1000)} million years`;
  return `${gyr.toFixed(gyr < 10 ? 2 : 1)} billion years`;
}

export class CosmicTimeUI {
  private playing = 0;

  constructor(private readonly app: App) {}

  wire(): void {
    const slider = $<HTMLInputElement>('cosmos-time');
    slider.max = String(STEPS);
    slider.value = String(NOW_STEP);
    slider.addEventListener('input', () => this.show(ageOf(Number(slider.value))));
    $('cosmos-epochs').innerHTML = EPOCHS.map((e, i) => `<button data-epoch="${i}">${e.name}</button>`).join('');
    $('cosmos-epochs').addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-epoch]');
      if (!b) return;
      const e = EPOCHS[Number(b.dataset.epoch)];
      slider.value = String(stepOf(e.ageGyr));
      this.show(e.ageGyr);
    });
    $('btn-cosmos-play').addEventListener('click', () => this.play());
    $('btn-cosmos-now').addEventListener('click', () => {
      cancelAnimationFrame(this.playing);
      slider.value = String(NOW_STEP);
      this.reset();
    });
    this.write(UNIVERSE_AGE_GYR);
  }

  /** From the afterglow to today in about 20 seconds. */
  private play(): void {
    cancelAnimationFrame(this.playing);
    const slider = $<HTMLInputElement>('cosmos-time');
    let step = Number(slider.value) >= NOW_STEP ? 0 : Number(slider.value);
    let last = performance.now();
    const tick = (now: number) => {
      step = Math.min(NOW_STEP, step + ((now - last) / 1000) * (NOW_STEP / 20));
      last = now;
      slider.value = String(Math.round(step));
      this.show(ageOf(step));
      if (step < NOW_STEP) this.playing = requestAnimationFrame(tick);
    };
    this.playing = requestAnimationFrame(tick);
  }

  private show(age: number): void {
    const a = scaleFactorAtAge(age);
    this.app.cosmos.setScaleFactor(Math.abs(a - 1) < 1e-3 ? undefined : a, age < AGE_FIRST_STARS);
    this.write(age, a);
  }

  reset(): void {
    this.app.cosmos.setScaleFactor(undefined);
    this.write(UNIVERSE_AGE_GYR);
  }

  private write(age: number, a = 1): void {
    const z = 1 / a - 1;
    const c = compositionAt(a);
    const pct = (x: number) => (x < 0.001 ? '<0.1' : (100 * x).toFixed(x < 0.1 ? 1 : 0));
    const epoch = [...EPOCHS].reverse().find((e) => age >= e.ageGyr * 0.999) ?? EPOCHS[0];
    const size = a < 0.999 ? `Everything was ${(1 / a).toLocaleString('en-US', { maximumFractionDigits: 1 })} times closer together than today` : a > 1.001 ? `Everything is ${a.toFixed(2)} times farther apart than today` : 'Distances as they are today';
    $('cosmos-time-info').innerHTML = `
      <b>${formatAge(age)}</b> after the Big Bang${z > 0.001 ? ` · redshift ${z < 10 ? z.toFixed(2) : Math.round(z).toLocaleString('en-US')}` : ''}<br>
      ${size}.<br>
      Space expanding at ${Math.round(hubbleAt(a)).toLocaleString('en-US')} km/s per megaparsec, and ${decelerationAt(a) > 0 ? 'slowing down' : 'speeding up'}.<br>
      Made of: matter ${pct(c.matter)}% · dark energy ${pct(c.darkEnergy)}% · radiation ${pct(c.radiation)}%.<br>
      <span class="muted">${epoch.name}: ${epoch.about}</span>`;
  }
}
