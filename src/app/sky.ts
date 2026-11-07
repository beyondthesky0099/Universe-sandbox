import { moonPhaseName, skyAt } from '../sim/sky';
import { dateToJdTT, eclipsePath, greatestEclipse, jdTTToDate, loadEclipses, localCircumstances, shadowAt, topocentric, type Eclipse } from '../sim/eclipse';
import { $, toast } from '../ui/dom';
import { prefs } from '../ui/galaxyStore';
import { SKY_PLACES } from './shared';
import type { App } from '../app';

/** The Sky view (planetarium): time, place, the list of what is up, and eclipses. */
export class SkyUI {
  constructor(private readonly app: App) {}

  async openSky(): Promise<void> {
    if (this.app.view === 'sky') return;
    this.app.skyDate = new Date();
    this.setSkyTimeInput();
    this.app.sky.setTime(this.app.skyDate);
    this.renderSkyList();
    await this.app.switchView('sky');
  }

  tickSky(dt: number): void {
    this.app.skyDate = new Date(this.app.skyDate.getTime() + dt * 1000 * this.app.skySpeed);
    this.app.sky.setTime(this.app.skyDate);
    this.app.sky.update();
    this.app.renderView(this.app.sky.scene, this.app.sky.camera, []);
    if (this.app.frames % 15 === 0) {
      $('stats').textContent = `${Math.round(this.app.fps)} fps`;
      this.renderSkyList();
      this.drawEclipseMap();
      if (document.activeElement !== $('sky-time')) this.setSkyTimeInput();
    }
  }

  setSkyTimeInput(): void {
    const d = this.app.skyDate;
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    $<HTMLInputElement>('sky-time').value = local;
    $('sky-utc').textContent = `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  }

  setSkyPlace(lat: number, lon: number, name?: string): void {
    lat = Math.max(-90, Math.min(90, lat));
    lon = ((((lon + 180) % 360) + 360) % 360) - 180;
    $<HTMLInputElement>('sky-lat').value = lat.toFixed(2);
    $<HTMLInputElement>('sky-lon').value = lon.toFixed(2);
    const select = $<HTMLSelectElement>('sky-place');
    const i = SKY_PLACES.findIndex((p) => p[0] === name);
    select.value = i >= 0 ? String(i) : '';
    prefs.set('skyPlace', { lat, lon, name: name ?? '' });
    this.app.sky.setTime(this.app.skyDate, { lat, lon });
    this.renderSkyList();
    this.updateEclipseInfo();
  }

  selectEclipse(e: Eclipse | undefined): void {
    this.app.eclipse = e ? { e, path: eclipsePath(e), greatest: greatestEclipse(e) } : undefined;
    this.app.sky.setEclipse(e);
    $('eclipse-map').classList.toggle('hidden', !e);
    if (e && !this.app.earthMap) {
      const img = new Image();
      img.onload = () => this.drawEclipseMap();
      img.src = `${import.meta.env.BASE_URL}textures/earth.jpg`;
      this.app.earthMap = img;
    }
    this.drawEclipseMap();
    this.updateEclipseInfo();
  }

  watchEclipse(): void {
    const ec = this.app.eclipse;
    if (!ec) return;
    const place = ec.greatest.shadow.centre!;
    this.setSkyPlace(place.lat, place.lon);
    const local = localCircumstances(ec.e, place.lat, place.lon);
    this.app.skyDate = jdTTToDate(ec.e, local.maxJdTT - (local.centralSec / 2 + 75) / 86400);
    this.app.skySpeed = 10;
    $<HTMLSelectElement>('sky-speed').value = '10';
    this.setSkyTimeInput();
    const t = topocentric(ec.e, local.maxJdTT, place.lat, place.lon);
    this.app.sky.lookAt(t.sun.alt, t.sun.az);
    this.app.sky.setFov(3);
    this.app.sky.setTime(this.app.skyDate);
    this.updateEclipseInfo();
    if (this.app.view !== 'sky') void this.app.switchView('sky');
  }

  updateEclipseInfo(): void {
    const ec = this.app.eclipse;
    if (!ec) {
      $('eclipse-info').textContent = '';
      return;
    }
    const { e } = ec;
    const { lat, lon } = this.app.sky.observer;
    const local = localCircumstances(e, lat, lon);
    const utc = (jd: number) => jdTTToDate(e, jd).toISOString().slice(11, 19);
    const sunAlt = topocentric(e, local.maxJdTT, lat, lon).sun.alt;
    const fmt = (sec: number) => `${Math.floor(sec / 60)} min ${Math.round(sec % 60)} s`;
    let here: string;
    if (local.obscuration <= 0) here = 'Not visible from here.';
    else if (sunAlt < -0.5) here = 'From here it happens with the Sun below the horizon.';
    else if (local.central !== 'none')
      here = `From here: ${local.central === 'total' ? 'totality' : 'a ring of fire'} for ${fmt(local.centralSec)}, centred on ${utc(local.maxJdTT)} UTC, with the Sun ${Math.round(sunAlt)}° up.`;
    else here = `From here: partial, up to ${Math.round(local.obscuration * 100)}% of the Sun covered at ${utc(local.maxJdTT)} UTC, Sun ${Math.round(sunAlt)}° up.`;
    const ns = (v: number, p: string, n: string) => `${Math.abs(v)}°${v >= 0 ? p : n}`;
    $('eclipse-info').textContent = `${here} NASA: greatest eclipse at ${e.greatestTD.slice(11, 16)} TD, ${ns(e.lat, 'N', 'S')} ${ns(e.lon, 'E', 'W')}, ${e.type === 'annular' ? 'annularity' : 'totality'} ${fmt(e.durationSec)}${e.widthKm ? `, path ${e.widthKm} km wide` : ''}. Click the map to watch from anywhere.`;
  }

  drawEclipseMap(): void {
    const ec = this.app.eclipse;
    const canvas = $<HTMLCanvasElement>('eclipse-map');
    if (!ec || canvas.classList.contains('hidden')) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    const xy = (p: { lat: number; lon: number }): [number, number] => [((p.lon + 180) / 360) * W, ((90 - p.lat) / 180) * H];
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, W, H);
    if (this.app.earthMap?.complete && this.app.earthMap.naturalWidth) {
      ctx.globalAlpha = 0.75;
      ctx.drawImage(this.app.earthMap, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    const line = (pts: { lat: number; lon: number }[], color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      let prev: [number, number] | undefined;
      for (const p of pts) {
        const q = xy(p);
        if (!prev || Math.abs(q[0] - prev[0]) > W / 2) ctx.moveTo(q[0], q[1]);
        else ctx.lineTo(q[0], q[1]);
        prev = q;
      }
      ctx.stroke();
    };
    const withLimits = ec.path.filter((p) => p.limits);
    line(withLimits.map((p) => p.limits![0]), 'rgba(255,200,90,0.9)', 1.5);
    line(withLimits.map((p) => p.limits![1]), 'rgba(255,200,90,0.9)', 1.5);
    line(ec.path.map((p) => p.centre), 'rgba(255,120,60,0.9)', 1);
    // The shadow now.
    const jd = dateToJdTT(ec.e, this.app.skyDate);
    const sh = shadowAt(ec.e, jd);
    if (sh.centre) {
      const [x, y] = xy(sh.centre);
      const kmPerPx = 40075 / W;
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(x, y, sh.penumbraKm / kmPerPx / Math.max(0.2, Math.cos((sh.centre.lat * Math.PI) / 180)), sh.penumbraKm / kmPerPx, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(3, Math.abs(sh.umbraKm) / kmPerPx), 0, Math.PI * 2);
      ctx.fill();
    }
    const [ox, oy] = xy(this.app.sky.observer);
    ctx.strokeStyle = '#7fdcff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ox - 6, oy);
    ctx.lineTo(ox + 6, oy);
    ctx.moveTo(ox, oy - 6);
    ctx.lineTo(ox, oy + 6);
    ctx.stroke();
  }

  wireSkyPanel(): void {
    const select = $<HTMLSelectElement>('sky-place');
    select.innerHTML = `<option value="">Custom place</option>${SKY_PLACES.map((p, i) => `<option value="${i}">${p[0]}</option>`).join('')}`;
    const saved = prefs.get<{ lat: number; lon: number; name: string } | null>('skyPlace', null);
    if (saved) this.setSkyPlace(saved.lat, saved.lon, saved.name || undefined);
    else this.setSkyPlace(SKY_PLACES[0][1], SKY_PLACES[0][2], SKY_PLACES[0][0]);
    select.addEventListener('change', () => {
      const p = SKY_PLACES[Number(select.value)];
      if (select.value !== '' && p) this.setSkyPlace(p[1], p[2], p[0]);
    });
    const typed = () => {
      const lat = Number($<HTMLInputElement>('sky-lat').value), lon = Number($<HTMLInputElement>('sky-lon').value);
      if (Number.isFinite(lat) && Number.isFinite(lon)) this.setSkyPlace(lat, lon);
    };
    $('sky-lat').addEventListener('change', typed);
    $('sky-lon').addEventListener('change', typed);
    $('btn-sky-here').addEventListener('click', () => {
      if (!navigator.geolocation) return toast('Location is not available in this browser.');
      navigator.geolocation.getCurrentPosition(
        (pos) => this.setSkyPlace(pos.coords.latitude, pos.coords.longitude),
        () => toast('Could not get your location.'),
        { timeout: 10000 },
      );
    });
    $('sky-time').addEventListener('change', () => {
      const d = new Date($<HTMLInputElement>('sky-time').value);
      if (!Number.isNaN(d.getTime())) {
        this.app.skyDate = d;
        this.setSkyTimeInput();
      }
    });
    $('btn-sky-now').addEventListener('click', () => {
      this.app.skyDate = new Date();
      this.app.skySpeed = 1;
      $<HTMLSelectElement>('sky-speed').value = '1';
      this.setSkyTimeInput();
    });
    void loadEclipses()
      .then((list) => {
        const select = $<HTMLSelectElement>('eclipse-select');
        select.innerHTML = `<option value="">Choose an eclipse…</option>${list.map((e, i) => `<option value="${i}">${e.date} · ${e.type}</option>`).join('')}`;
        const now = Date.now();
        const next = list.findIndex((e) => Date.parse(e.date) > now);
        select.value = String(next >= 0 ? next : 0);
      })
      .catch(() => ($('eclipse-select').innerHTML = '<option value="">Eclipses unavailable</option>'));
    $('eclipse-select').addEventListener('change', async () => {
      const list = await loadEclipses().catch(() => []);
      this.selectEclipse(list[Number($<HTMLSelectElement>('eclipse-select').value)]);
    });
    $('btn-eclipse').addEventListener('click', async () => {
      const list = await loadEclipses().catch(() => []);
      const e = list[Number($<HTMLSelectElement>('eclipse-select').value)];
      if (!e) return;
      if (this.app.eclipse?.e !== e) this.selectEclipse(e);
      this.watchEclipse();
    });
    $('eclipse-map').addEventListener('click', (ev) => {
      const c = $<HTMLCanvasElement>('eclipse-map');
      const r = c.getBoundingClientRect();
      const me = ev as MouseEvent;
      const lon = ((me.clientX - r.left) / r.width) * 360 - 180;
      const lat = 90 - ((me.clientY - r.top) / r.height) * 180;
      this.setSkyPlace(lat, lon);
      this.drawEclipseMap();
      const ec = this.app.eclipse;
      if (ec) {
        // Point at the Sun as it will be at maximum eclipse here.
        const local = localCircumstances(ec.e, lat, lon);
        const t = topocentric(ec.e, local.maxJdTT, lat, lon);
        if (t.sun.alt > -1) this.app.sky.lookAt(t.sun.alt, t.sun.az);
      }
    });
    $<HTMLInputElement>('opt-sky-nebulae').addEventListener('change', (e) => this.app.sky.setOutlinesVisible('nebulae', (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-sky-clusters').addEventListener('change', (e) => this.app.sky.setOutlinesVisible('clusters', (e.target as HTMLInputElement).checked));
    $('sky-speed').addEventListener('change', () => (this.app.skySpeed = Number($<HTMLSelectElement>('sky-speed').value)));
    $('sky-list').addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-sky]');
      const o = li && this.app.sky.snapshot?.objects.find((x) => x.name === li.dataset.sky);
      if (!o) return;
      this.app.skyPicked = o.name;
      this.app.sky.lookAt(Math.max(o.alt, 5), o.az);
      this.renderSkyList();
    });
  }

  renderSkyList(): void {
    const snap = this.app.sky.snapshot;
    if (!snap) return;
    const compass = (az: number) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(az / 22.5) % 16];
    const where = (o: { alt: number; az: number }) => (o.alt > 0 ? `${Math.round(o.alt)}° up, ${compass(o.az)}` : 'below the horizon');
    const sun = snap.objects.find((o) => o.name === 'Sun')!;
    const moon = snap.objects.find((o) => o.name === 'Moon')!;
    // Waxing while the lit fraction grows.
    const waxing = skyAt(new Date(this.app.skyDate.getTime() + 3600000), this.app.sky.observer).moonIllumination >= snap.moonIllumination;
    const phase = `${moonPhaseName(snap.moonIllumination, waxing)}, ${Math.round(snap.moonIllumination * 100)}% lit`;
    const sky = sun.alt > -0.833 ? 'Daytime' : sun.alt > -6 ? 'Civil twilight' : sun.alt > -12 ? 'Nautical twilight' : sun.alt > -18 ? 'Astronomical twilight' : 'Night';
    const rows = [
      { name: 'Sun', text: `${sky}: ${where(sun)}` },
      { name: 'Moon', text: `${phase}; ${where(moon)}` },
      ...snap.objects
        .filter((o) => o.kind === 'planet')
        .sort((a, b) => b.alt - a.alt)
        .map((o) => ({ name: o.name, text: where(o), up: o.alt > 0 })),
    ];
    $('sky-list').innerHTML = rows
      .map((r) => `<li data-sky="${r.name}" tabindex="0" class="${'up' in r && !r.up ? 'muted' : ''}${r.name === this.app.skyPicked ? ' active' : ''}"><b>${r.name}</b> <span class="small">${r.text}</span></li>`)
      .join('');
    const picked = this.app.skyPicked && snap.objects.find((o) => o.name === this.app.skyPicked);
    $('sky-info').textContent = picked
      ? `${picked.name}: altitude ${picked.alt.toFixed(1)}°, azimuth ${picked.az.toFixed(1)}°, ${picked.km > 1e7 ? `${(picked.km / 149597870.7).toFixed(2)} AU` : `${Math.round(picked.km).toLocaleString('en-US')} km`} away, ${(picked.diameter * 60).toFixed(picked.diameter * 60 < 1 ? 2 : 1)}′ across.`
      : 'Positions are geometric (no atmospheric refraction), accurate to about an arcminute.';
  }
}
