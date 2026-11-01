import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

/**
 * Plain-English → scene builder. Claude returns a structured scene spec (validated
 * against this schema by the SDK); the browser turns it into simulated bodies.
 */

export const MODEL = 'claude-opus-5-5';

const BodySpec = z.object({
  name: z.string().describe('Unique, evocative name for this body'),
  kind: z.enum(['rocky', 'gas', 'star', 'giant', 'whitedwarf', 'neutron', 'blackhole']).describe('giant = red giant star'),
  mass: z.number().describe('Mass in massUnit'),
  massUnit: z.enum(['earth', 'jupiter', 'sun']),
  orbits: z.string().describe('Name of the body this one orbits, or "" for a free body placed by x/z'),
  a: z.number().describe('Semi-major axis in AU (ignored when orbits is "")'),
  e: z.number().describe('Eccentricity, 0 to 0.9'),
  inclinationDeg: z.number().describe('Orbital inclination in degrees, usually 0–10'),
  phaseDeg: z.number().describe('Starting angle around the orbit, 0–360'),
  x: z.number().describe('Position in AU for free bodies (orbits ""), else 0'),
  z: z.number().describe('Position in AU for free bodies (orbits ""), else 0'),
  vx: z.number().describe('Extra velocity in km/s added on top of the orbit (usually 0)'),
  vz: z.number().describe('Extra velocity in km/s added on top of the orbit (usually 0)'),
  color: z.string().describe('Hex colour like "#7fa0c8" for planets, or "" for the default'),
});

export const SceneSpec = z.object({
  title: z.string().describe('Short title for the scene'),
  summary: z.string().describe('One or two sentences describing what will happen'),
  timeScale: z.number().describe('Suggested simulation speed in years per second (0.01–5)'),
  cameraDistance: z.number().describe('Suggested camera distance in AU to frame the scene'),
  relativity: z.boolean().describe('Enable general-relativistic effects (only for compact-object scenes)'),
  bodies: z.array(BodySpec).describe('Bodies in dependency order: a body appears after the body it orbits'),
});

export type SceneSpecT = z.infer<typeof SceneSpec>;

export const SYSTEM_PROMPT = `You design scenes for Astrarium, a browser N-body gravity sandbox. Turn the user's description into a scene spec.

Physics and units:
- Distances are AU, times are years, masses use massUnit (earth / jupiter / sun). G = 4π² AU³/(M☉ yr²).
- Orbits are Keplerian elements around the body named in "orbits"; list every parent before its children. Use "" for free bodies and give them x/z (AU) and optional extra velocity vx/vz (km/s).
- Kinds: rocky (asteroids, rocky planets, moons), gas (gas giants), star, giant (red giant star), whitedwarf, neutron, blackhole.

Game-scale constraints (bodies are drawn larger than real, and they collide at those sizes):
- A star of mass M has a radius of about 0.15·M^0.6 AU (minimum 0.08). Keep planets at least ~4 star radii out, and never put planets inside another body.
- Gas giants have radius ~0.07 AU. Moons of gas giants should orbit between 0.2 AU and 40% of the planet's Hill radius (a·∛(m/3M)). Rocky planets cannot hold moons at these sizes.
- Keep neighbouring orbits well separated (period ratio ≥ 1.5) unless the user wants chaos or collisions.
- Black hole radius ≈ 0.04·M^0.4 AU. Stars passing within R·∛(M_bh/M_star) of a black hole are torn apart.
- Use at most 40 bodies. Prefer realistic masses (Earth = 1 earth, Jupiter = 1 jupiter, Sun = 1 sun).

Choose timeScale so the fastest important orbit takes a few seconds (orbital period in years ≈ √(a³/M)), and cameraDistance ≈ 1.5–2.5× the outermost orbit.
If the request is not about space or astronomy, build a small, pleasant star system loosely inspired by it.`;

export class SceneError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Clamp a model-produced scene to safe, simulator-friendly values. */
export function sanitizeScene(scene: SceneSpecT): SceneSpecT {
  const finite = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
  const clamp = (v: number, lo: number, hi: number, fallback: number) => Math.min(hi, Math.max(lo, finite(v, fallback)));
  const seen = new Set<string>();
  const bodies = scene.bodies.slice(0, 60).flatMap((b) => {
    const name = (b.name || 'Body').slice(0, 40);
    if (seen.has(name)) return [];
    seen.add(name);
    return [
      {
        ...b,
        name,
        mass: clamp(b.mass, 1e-9, 1e6, 1),
        orbits: seen.has(b.orbits) && b.orbits !== name ? b.orbits : '',
        a: clamp(b.a, 0.001, 1e5, 1),
        e: clamp(b.e, 0, 0.95, 0),
        inclinationDeg: clamp(b.inclinationDeg, -180, 180, 0),
        phaseDeg: clamp(b.phaseDeg, -360, 720, 0),
        x: clamp(b.x, -1e6, 1e6, 0),
        z: clamp(b.z, -1e6, 1e6, 0),
        vx: clamp(b.vx, -1e5, 1e5, 0),
        vz: clamp(b.vz, -1e5, 1e5, 0),
        color: /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : '',
      },
    ];
  });
  return {
    title: (scene.title || 'Untitled scene').slice(0, 80),
    summary: (scene.summary || '').slice(0, 400),
    timeScale: clamp(scene.timeScale, 0.001, 50, 0.5),
    cameraDistance: clamp(scene.cameraDistance, 0.01, 1e6, 10),
    relativity: !!scene.relativity,
    bodies,
  };
}

/** The subset of the Anthropic client this module uses (lets tests inject a fake). */
export interface SceneClient {
  beta: { messages: { parse: Anthropic['beta']['messages']['parse'] } };
}

export async function describeScene(client: SceneClient, prompt: string): Promise<SceneSpecT> {
  const text = prompt.trim();
  if (!text) throw new SceneError(400, 'Describe a scene first.');
  if (text.length > 800) throw new SceneError(400, 'Please keep descriptions under 800 characters.');
  try {
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // Server-side refusal fallback: if this model declines, the API retries on a suitable fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      output_config: { effort: 'medium', format: betaZodOutputFormat(SceneSpec) },
      messages: [{ role: 'user', content: text }],
    });
    if (response.stop_reason === 'refusal') throw new SceneError(422, "Claude couldn't build that scene. Try describing it differently.");
    if (response.stop_reason === 'max_tokens') throw new SceneError(502, 'The scene was too large to finish. Try something smaller.');
    const scene = response.parsed_output;
    if (!scene) throw new SceneError(502, 'Claude returned a scene that could not be read.');
    const clean = sanitizeScene(scene);
    if (!clean.bodies.length) throw new SceneError(502, 'The scene had no bodies.');
    return clean;
  } catch (err) {
    if (err instanceof SceneError) throw err;
    if (err instanceof Anthropic.RateLimitError) throw new SceneError(429, 'The scene builder is busy. Try again in a minute.');
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
      throw new SceneError(503, 'The scene builder is not configured on this server.');
    if (err instanceof Anthropic.BadRequestError) throw new SceneError(400, `The request was rejected: ${err.message}`);
    if (err instanceof Anthropic.APIError) throw new SceneError(502, 'The scene builder failed. Try again shortly.');
    throw err;
  }
}
