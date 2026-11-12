import { HULSE_TAYLOR as H, orbitalDecay, periastronShift } from '../sim/binaryPulsar';

/**
 * The classic plot: how much earlier each periastron passage arrives than it would if the orbit
 * never changed, year by year since 1975. General relativity's prediction (from the measured
 * masses) and the measured decay rate (Weisberg & Huang 2016) lie on top of each other.
 */
export function hulseTaylorChart(nowYear = new Date().getFullYear()): string {
  const pb = H.pbDays * 86400;
  const gr = orbitalDecay(pb, H.e, H.mp, H.mc);
  const w = 300, h = 170, l = 38, r = 10, t = 12, b = 26;
  const x0 = 1975, x1 = Math.max(2025, nowYear);
  const yMin = Math.floor(periastronShift(x1 - H.since, gr, pb) / 10) * 10;
  const X = (y: number) => l + ((y - x0) / (x1 - x0)) * (w - l - r);
  const Y = (s: number) => t + (s / yMin) * (h - t - b);
  const path = (rate: number) => {
    const pts: string[] = [];
    for (let y = x0; y <= x1; y += 0.5) pts.push(`${X(y).toFixed(1)},${Y(periastronShift(y - H.since, rate, pb)).toFixed(1)}`);
    return pts.join(' ');
  };
  const measured = H.ratio * gr;
  const ticksX = [1980, 1990, 2000, 2010, 2020].filter((y) => y <= x1);
  const ticksY = Array.from({ length: Math.floor(-yMin / 20) + 1 }, (_, i) => -i * 20);
  return `<figure class="ht-chart">
<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Cumulative shift of periastron time of PSR B1913+16: measured decay matches general relativity">
  <g class="axis">
    ${ticksX.map((y) => `<line x1="${X(y)}" x2="${X(y)}" y1="${t}" y2="${h - b}" /><text x="${X(y)}" y="${h - b + 13}" text-anchor="middle">${y}</text>`).join('')}
    ${ticksY.map((v) => `<line x1="${l}" x2="${w - r}" y1="${Y(v)}" y2="${Y(v)}" /><text x="${l - 5}" y="${Y(v) + 3}" text-anchor="end">${v}</text>`).join('')}
    <text x="10" y="${(t + h - b) / 2}" transform="rotate(-90 10 ${(t + h - b) / 2})" text-anchor="middle">shift (s)</text>
  </g>
  <polyline class="gr" points="${path(gr)}" />
  <polyline class="measured" points="${path(measured)}" />
  <circle class="now" cx="${X(nowYear)}" cy="${Y(periastronShift(nowYear - H.since, measured, pb))}" r="3" />
</svg>
<figcaption><span class="key gr"></span>General relativity's prediction <span class="key measured"></span>measured decay (${(H.ratio * 100).toFixed(2)} ± ${(H.ratioError * 100).toFixed(2)}% of it)</figcaption>
</figure>`;
}
