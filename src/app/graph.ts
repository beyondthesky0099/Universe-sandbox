import { $ } from '../ui/dom';
import { LineChart, measure, METRICS, type MetricId, type Series } from '../ui/graph';
import type { App } from '../app';

/** The live graph panel. */
export class GraphUI {
  constructor(private readonly app: App) {}

  openGraph(metric?: MetricId): void {
    if (metric) this.app.graphMetric = metric;
    this.app.graphOpen = true;
    $<HTMLSelectElement>('graph-metric').value = this.app.graphMetric;
    if (this.app.view === 'system') $('graph-panel').classList.remove('hidden');
    this.app.chart ??= new LineChart($<HTMLCanvasElement>('graph-canvas'));
    this.resetGraph();
  }

  closeGraph(): void {
    this.app.graphOpen = false;
    $('graph-panel').classList.add('hidden');
  }

  resetGraph(): void {
    this.app.graphSeries = [];
    this.app.graphStart = this.app.sim.time;
    this.app.graphLastTime = NaN;
    this.app.graphBodyId = this.app.system.selectedId;
  }

  sampleGraph(dt: number): void {
    const info = METRICS.find((m) => m.id === this.app.graphMetric)!;
    if (info.perBody && this.app.system.selectedId !== this.app.graphBodyId) this.resetGraph();
    this.app.graphTimer -= dt;
    if (this.app.graphTimer > 0) return;
    this.app.graphTimer = 0.1;
    const body = this.app.selectedBody();
    const note = info.perBody && !body ? 'Select a body to graph it.' : info.perBody ? `${body!.name} · x: years since the graph started` : 'Whole system · x: years';
    $('graph-note').textContent = note;
    if (this.app.sim.time !== this.app.graphLastTime) {
      this.app.graphLastTime = this.app.sim.time;
      let v = measure(this.app.sim, this.app.graphMetric, body);
      if (v !== undefined && Number.isFinite(v)) {
        const last = this.app.graphSeries[this.app.graphSeries.length - 1];
        // Keep angles continuous instead of wrapping at ±180°.
        if (this.app.graphMetric === 'periapsis' && last) while (v - last[1] > 180) v -= 360;
        if (this.app.graphMetric === 'periapsis' && last) while (v - last[1] < -180) v += 360;
        this.app.graphSeries.push([this.app.sim.time - this.app.graphStart, v]);
        if (this.app.graphSeries.length > 1200) this.app.graphSeries.splice(0, this.app.graphSeries.length - 1200);
      }
    }
    const series: Series[] = [{ label: 'This run', color: '#5ea7ff', points: this.app.graphSeries }];
    if (this.app.graphRef) series.push(this.app.graphRef);
    this.app.chart!.draw(series, 'years', `${info.label}${info.unit ? ` (${info.unit})` : ''}`);
  }
}
