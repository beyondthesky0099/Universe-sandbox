import { isHabitable, bodyTemperature } from '../sim/climate';
import { addOrbiting, PRESETS, type SceneSetup } from '../sim/presets';
import type { Body } from '../sim/body';
import type { SimEvent, Simulation } from '../sim/simulation';
import { EARTH_MASS, G, JUPITER_MASS } from '../sim/units';
import type { MetricId } from '../ui/graph';

/** What a lesson step can observe to decide whether its task is done. */
export interface LessonContext {
  sim: Simulation;
  selected?: Body;
  events: SimEvent[];
  flags: { habitableZones: boolean; lagrange: boolean; relativity: boolean; graphMetric?: MetricId };
}

export interface LessonStep {
  title: string;
  /** Explanation shown to the learner (plain text; blank lines separate paragraphs). */
  text: string;
  /** Short action for the learner; ticks when `check` passes. */
  task?: string;
  check?: (ctx: LessonContext) => boolean;
  /** Load a fresh scene for this step. */
  setup?: (sim: Simulation) => SceneSetup;
  /** Select (and follow) a body by name after setup. */
  select?: string;
  /** Open the live graph on this metric. */
  graph?: MetricId;
}

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  steps: LessonStep[];
}

const preset = (id: string) => (sim: Simulation) => PRESETS.find((p) => p.id === id)!.load(sim);
const selectedIs = (name: string) => (ctx: LessonContext) => ctx.selected?.name === name;

const kepler: Lesson = {
  id: 'kepler',
  title: 'Kepler’s three laws',
  summary: 'Why orbits are ellipses, why planets speed up near the Sun, and how period depends on distance.',
  steps: [
    {
      title: '1 · Orbits are ellipses',
      text: 'Every orbit is an ellipse with the star at one focus, not the centre. How stretched it is, its eccentricity, runs from 0 (a circle) up to nearly 1.\n\nThis comet has eccentricity 0.6: its distance from the Sun swings a long way.',
      setup(sim) {
        const sun = sim.addBody({ name: 'Sun', kind: 'star', mass: 1 });
        addOrbiting(sim, sun, { name: 'Comet', mass: 1e-4 * EARTH_MASS, kind: 'rocky', color: 0xcfe6ff }, { a: 2, e: 0.6, nu: Math.PI });
        return { cameraDistance: 7, timeScale: 0.5, elevation: 1.3 };
      },
      select: 'Comet',
      graph: 'distance',
      task: 'Watch the graph: the distance rises and falls once per orbit.',
    },
    {
      title: '2 · Equal areas in equal times',
      text: 'A line from the Sun to the comet sweeps out equal areas in equal times. Near the Sun the line is short, so the comet must move fast; far away it crawls.\n\nThe graph now shows speed: it peaks at the closest point (perihelion).',
      graph: 'speed',
      task: 'Compare the speed peaks with the distance dips.',
    },
    {
      title: '3 · The harmonic law',
      text: 'The square of a planet’s period is proportional to the cube of its distance: T² ∝ a³. In years and AU, T² = a³ for anything orbiting the Sun.\n\nMars sits at 1.52 AU, so 1.52³ = 3.5 and its year is √3.5 = 1.88 Earth years.',
      setup: preset('solar'),
      task: 'Select Mars and check its period in the info panel.',
      check: selectedIs('Mars'),
    },
  ],
};

const escape: Lesson = {
  id: 'escape',
  title: 'Escape velocity',
  summary: 'How fast do you need to go to leave a star behind for good?',
  steps: [
    {
      title: 'Bound or free?',
      text: 'An object is bound when its kinetic energy is less than the energy needed to climb out of the gravity well. Escape speed is √2 times the circular orbit speed: about 42 km/s at Earth’s distance from the Sun.',
      setup(sim) {
        sim.addBody({ name: 'Sun', kind: 'star', mass: 1 });
        return { cameraDistance: 8, timeScale: 0.5, elevation: 1.3 };
      },
    },
    {
      title: 'Launch something out',
      text: 'Choose the Spawn tool and an asteroid. Click about 1 AU from the Sun with Auto-orbit on, and drag forward along the orbit so the speed exceeds escape speed.\n\nThe info panel says “Unbound (escaping)” when you succeed.',
      task: 'Launch a body that escapes the Sun and gets beyond 6 AU.',
      check: ({ sim }) => {
        const sun = sim.bodies.find((b) => b.name === 'Sun');
        if (!sun) return false;
        return sim.bodies.some((b) => {
          if (b === sun) return false;
          const r = Math.hypot(b.x - sun.x, b.y - sun.y, b.z - sun.z);
          const v2 = (b.vx - sun.vx) ** 2 + (b.vy - sun.vy) ** 2 + (b.vz - sun.vz) ** 2;
          return r > 6 && v2 / 2 - (G * sun.mass) / r > 0;
        });
      },
    },
  ],
};

const resonance: Lesson = {
  id: 'resonance',
  title: 'Orbital resonance',
  summary: 'When orbital periods form simple ratios, planets tug each other in rhythm.',
  steps: [
    {
      title: 'A 2:1 rhythm',
      text: 'The inner planet goes around exactly twice for every orbit of the outer one. They line up at the same spot every time, so their small tugs add up instead of averaging out.\n\nResonances shape the Kirkwood gaps in the asteroid belt, Neptune and Pluto, and Jupiter’s moons Io, Europa and Ganymede (1:2:4).',
      setup(sim) {
        const star = sim.addBody({ name: 'Star', kind: 'star', mass: 1 });
        addOrbiting(sim, star, { name: 'Inner', mass: 3 * JUPITER_MASS, kind: 'gas', color: 0xd8b48a }, { a: 2 });
        addOrbiting(sim, star, { name: 'Outer', mass: 1.5 * JUPITER_MASS, kind: 'gas', color: 0x6fa8c9 }, { a: 2 * Math.cbrt(4), nu: 1 });
        return { cameraDistance: 9, timeScale: 1, elevation: 1.4 };
      },
      task: 'Select the outer planet: the info panel reports the resonance.',
      check: selectedIs('Outer'),
    },
    {
      title: 'Feel the tug',
      text: 'Watch the outer planet’s eccentricity: it slowly oscillates as the inner planet kicks it at the same place every two orbits.',
      select: 'Outer',
      graph: 'eccentricity',
    },
  ],
};

const roche: Lesson = {
  id: 'roche',
  title: 'Tides and the Roche limit',
  summary: 'Why Saturn has rings, and how close a moon can get before it is torn apart.',
  steps: [
    {
      title: 'Stretched by tides',
      text: 'Gravity pulls harder on a moon’s near side than its far side. Far away the difference is tiny, but inside the Roche limit (about 1.5 to 2.5 planet radii for typical densities) it beats the moon’s own gravity and tears it apart.',
      setup: preset('rings'),
      select: 'Doomed Moon',
      graph: 'distance',
      task: 'Watch the eccentric moon dive inside the Roche limit.',
      check: ({ events }) => events.some((e) => e.type === 'disrupt'),
    },
    {
      title: 'A ring is born',
      text: 'The debris spreads along the orbit. Inner pieces orbit faster than outer ones, so the clump shears out into an arc and then a ring. Saturn’s rings may be the remains of a moon that met this fate.',
    },
  ],
};

const lagrange: Lesson = {
  id: 'lagrange',
  title: 'Lagrange points',
  summary: 'Five places where a small body can ride along with a planet.',
  steps: [
    {
      title: 'Five balance points',
      text: 'Around any planet and its star there are five points where the combined gravity and orbital motion balance. L1 and L2 sit either side of the planet (home of telescopes like JWST); L3 is opposite; L4 and L5 lead and trail by 60°.',
      setup(sim) {
        const sun = sim.addBody({ name: 'Sun', kind: 'star', mass: 1 });
        addOrbiting(sim, sun, { name: 'Jupiter', mass: JUPITER_MASS, kind: 'gas', color: 0xd8b48a }, { a: 5.2 });
        for (let i = 0; i < 12; i++) {
          const lead = (i < 6 ? 1 : -1) * (Math.PI / 3) + (Math.random() - 0.5) * 0.25;
          addOrbiting(sim, sun, { name: `Trojan ${i + 1}`, mass: 1e-8, kind: 'rocky', color: 0x8a8f99 }, { a: 5.2 + (Math.random() - 0.5) * 0.15, nu: lead });
        }
        return { cameraDistance: 16, timeScale: 1, elevation: 1.4 };
      },
      select: 'Jupiter',
      task: 'Turn on Display → Lagrange points.',
      check: ({ flags }) => flags.lagrange,
    },
    {
      title: 'Trojans',
      text: 'L4 and L5 are stable. Jupiter has thousands of “Trojan” asteroids clustered there. The grey asteroids here wobble around those points (tadpole orbits) but stay with Jupiter, lap after lap.',
    },
  ],
};

const assist: Lesson = {
  id: 'assist',
  title: 'Gravity assists',
  summary: 'How spacecraft steal speed from planets.',
  steps: [
    {
      title: 'A free boost',
      text: 'In the planet’s frame a flyby only bends the probe’s path, without changing its speed. But the planet is moving, so in the Sun’s frame the probe can leave much faster than it arrived.\n\nThis probe is aimed to pass just behind a giant planet.',
      setup(sim) {
        const sun = sim.addBody({ name: 'Sun', kind: 'star', mass: 1 });
        addOrbiting(sim, sun, { name: 'Goliath', mass: 10 * JUPITER_MASS, kind: 'gas', color: 0xc99e6b }, { a: 5.2, nu: (97 * Math.PI) / 180 });
        const probe = addOrbiting(sim, sun, { name: 'Probe', mass: 1e-15, kind: 'rocky', tag: 'probe' }, { a: 1 });
        const v = Math.hypot(probe.vx - sun.vx, probe.vz - sun.vz);
        const scale = (v + 9.2 / 4.7406) / v;
        probe.vx = sun.vx + (probe.vx - sun.vx) * scale;
        probe.vz = sun.vz + (probe.vz - sun.vz) * scale;
        const r = Math.hypot(probe.x - sun.x, probe.z - sun.z);
        probe.vx += ((probe.x - sun.x) / r) * (-0.5 / 4.7406);
        probe.vz += ((probe.z - sun.z) / r) * (-0.5 / 4.7406);
        return { cameraDistance: 14, timeScale: 0.6, elevation: 1.4 };
      },
      select: 'Probe',
      graph: 'speed',
      task: 'Watch the speed graph: it falls on the climb out, then jumps at the flyby.',
      check: ({ sim }) => {
        const probe = sim.bodies.find((b) => b.name === 'Probe');
        const sun = sim.bodies.find((b) => b.name === 'Sun');
        return !!probe && !!sun && Math.hypot(probe.x - sun.x, probe.z - sun.z) > 7;
      },
    },
    {
      title: 'Voyager’s grand tour',
      text: 'Voyager 2 used Jupiter, Saturn, Uranus and Neptune in turn, a planetary alignment that happens once every 175 years. Try the Slingshot challenge (🏆) to plan one yourself.',
    },
  ],
};

const habitable: Lesson = {
  id: 'habitable',
  title: 'The habitable zone',
  summary: 'Where liquid water could exist, and why it moves with the star.',
  steps: [
    {
      title: 'Not too hot, not too cold',
      text: 'A planet’s temperature depends on how much starlight it gets, which falls with the square of distance. The habitable zone is the band where an Earth-like planet could keep liquid water. Brighter stars push it outward; dim red dwarfs pull it in close.',
      setup(sim) {
        sim.addBody({ name: 'Star', kind: 'star', mass: 1 });
        return { cameraDistance: 4, timeScale: 0.5, elevation: 1.4 };
      },
      task: 'Turn on Display → Habitable zones.',
      check: ({ flags }) => flags.habitableZones,
    },
    {
      title: 'Make a living world',
      text: 'Use the Spawn tool to place a rocky planet inside the green ring (Auto-orbit keeps it circular). Select it to see its temperature.',
      task: 'Create a habitable rocky planet.',
      check: ({ sim }) => sim.bodies.some((b) => b.kind === 'rocky' && isHabitable(b.kind, b.mass, bodyTemperature(sim.bodies, b))),
    },
    {
      title: 'Bigger star, wider zone',
      text: 'Select the star and double its mass a couple of times. It becomes far brighter, the zone moves outward, and your planet may roast.',
      task: 'Make the star at least 2 M☉.',
      check: ({ sim }) => sim.bodies.some((b) => b.kind === 'star' && b.mass >= 2),
    },
  ],
};

const relativity: Lesson = {
  id: 'relativity',
  title: 'Einstein’s gravity',
  summary: 'Mercury’s precessing orbit and gravitational waves.',
  steps: [
    {
      title: 'Mercury’s anomaly',
      text: 'Mercury’s orbit slowly rotates. Newton’s gravity (plus tugs from the other planets) explains most of this, but not 43 arcseconds per century. General relativity explains exactly that remainder.\n\nHere light is 600× slower, so the effect is huge: the periapsis direction marches steadily on the graph.',
      setup: preset('precession'),
      select: 'Mercury',
      graph: 'periapsis',
      task: 'Turn Relativity off (Simulation panel) and watch the precession stop.',
      check: ({ flags }) => !flags.relativity,
    },
    {
      title: 'Ripples in spacetime',
      text: 'Orbiting masses radiate gravitational waves, losing energy. For two black holes this makes them spiral together faster and faster, ending in a merger. LIGO first detected such a “chirp” in 2015. Turn on sound to hear one.',
      setup: preset('inspiral'),
      select: 'Black Hole A',
      graph: 'distance',
      task: 'Wait for the merger.',
      check: ({ events }) => events.some((e) => e.type === 'gwmerger'),
    },
  ],
};

export const LESSONS: Lesson[] = [kepler, escape, resonance, habitable, roche, lagrange, assist, relativity];

