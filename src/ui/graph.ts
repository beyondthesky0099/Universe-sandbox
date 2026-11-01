import type { Body } from '../sim/body';
import type { Simulation } from '../sim/simulation';
import { AU_PER_YEAR_IN_KMS } from '../sim/units';

export type MetricId = 'distance' | 'speed' | 'energy' | 'eccentricity' | 'periapsis' | 'temperature';

export interface MetricInfo {
  id: MetricId;
  label: string;
  unit: string;
  /** Needs a selected body. */
  perBody: boolean;
}

export const METRICS: MetricInfo[] = [
  { id: 'distance', label: 'Distance to parent', unit: 'AU', perBody: true },
  { id: 'speed', label: 'Orbital speed', unit: 'km/s', perBody: true },
  { id: 'eccentricity', label: 'Eccentricity', unit: '', perBody: true },
  { id: 'periapsis', label: 'Periapsis direction', unit: '°', perBody: true },
  { id: 'energy', label: 'Total energy (system)', unit: 'M☉·AU²/yr²', perBody: false },
];

/** Value of a metric right now (undefined when not applicable). */
export function measure(sim: Simulation, metric: MetricId, body?: Body): number | undefined {
  if (metric === 'energy') return sim.bodies.length <= 400 ? sim.totalEnergy() : undefined;
  if (!body) return undefined;
  const parent = sim.parentOf(body);
  if (!parent) return undefined;
  const rx = body.x - parent.x, ry = body.y - parent.y, rz = body.z - parent.z;
  const vx = body.vx - parent.vx, vy = body.vy - parent.vy, vz = body.vz - parent.vz;
  const r = Math.hypot(rx, ry, rz);
  const v2 = vx * vx + vy * vy + vz * vz;
  switch (metric) {
    case 'distance':
      return r;
    case 'speed':
      return Math.sqrt(v2) * AU_PER_YEAR_IN_KMS;
    case 'eccentricity':
    case 'periapsis': {
      const mu = sim.effectiveG * (parent.mass + body.mass);
      if (mu <= 0) return undefined;
      const rv = rx * vx + ry * vy + rz * vz;
      const k = v2 - mu / r;
      const ex = (k * rx - rv * vx) / mu, ez = (k * rz - rv * vz) / mu, ey = (k * ry - rv * vy) / mu;
      if (metric === 'eccentricity') return Math.hypot(ex, ey, ez);
      return (Math.atan2(-ez, ex) * 180) / Math.PI;
    }
    default:
      return undefined;
  }
}

export interface Series {
  label: string;
  color: string;
  points: [number, number][];
  dashed?: boolean;
}

/** Minimal auto-scaling line chart on a canvas. */
export class LineChart {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  draw(series: Series[], xLabel: string, yLabel: string): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 46, r: 8, t: 8, b: 22 };
    const all = series.flatMap((s) => s.points);
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#8b96b0';
    if (all.length < 2) {
      ctx.fillText('Waiting for data… (the simulation must be running)', pad.l, h / 2);
      return;
    }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of all) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (x1 - x0 < 1e-12) x1 = x0 + 1;
    if (y1 - y0 < Math.abs(y1) * 1e-9 + 1e-12) {
      y0 -= Math.abs(y0) * 0.01 + 1e-9;
      y1 += Math.abs(y1) * 0.01 + 1e-9;
    }
    const ypad = (y1 - y0) * 0.08;
    y0 -= ypad;
    y1 += ypad;
    const X = (x: number) => pad.l + ((x - x0) / (x1 - x0)) * (w - pad.l - pad.r);
    const Y = (y: number) => h - pad.b - ((y - y0) / (y1 - y0)) * (h - pad.t - pad.b);

    // Grid and labels.
    ctx.strokeStyle = 'rgba(140,180,255,0.12)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = y0 + ((y1 - y0) * i) / 4;
      ctx.beginPath();
      ctx.moveTo(pad.l, Y(y));
      ctx.lineTo(w - pad.r, Y(y));
      ctx.stroke();
      ctx.fillText(formatTick(y), 2, Y(y) + 3);
    }
    ctx.fillText(`${xLabel}: ${formatTick(x0)} → ${formatTick(x1)}`, pad.l, h - 6);
    ctx.textAlign = 'right';
    ctx.fillText(yLabel, w - pad.r, 10);
    ctx.textAlign = 'left';

    for (const s of series) {
      if (s.points.length < 2) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.6;
      ctx.setLineDash(s.dashed ? [5, 4] : []);
      ctx.beginPath();
      s.points.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Legend.
    let lx = pad.l + 4;
    for (const s of series) {
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, pad.t + 2, 10, 3);
      ctx.fillStyle = '#c8d2e8';
      ctx.fillText(s.label, lx + 14, pad.t + 7);
      lx += ctx.measureText(s.label).width + 30;
    }
  }
}

function formatTick(v: number): string {
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(1);
  return Number(v.toPrecision(3)).toString();
}
