import * as THREE from 'three';
import { equatorialToGalactic, galacticToMap, UNITS_PER_KPC } from '../procgen/galaxy';
import { cartesianToGalactic, NANOGRAV_15YR, type GalacticExtras } from '../sim/galacticExtras';
import type { PulsarRecord } from '../sim/pulsars';
import { textSprite } from './galaxyView';

/**
 * Real structures on the Milky Way map (sim/galacticExtras.ts), each its own layer:
 *
 * - "neighbourhood": the Local Bubble, the cavity of hot gas ~150 pc around the Sun blown by
 *   supernovae (its shell's inner surface, Pelgrims et al. 2020), and the Radcliffe Wave, a
 *   2.7 kpc wave of star-forming clouds (Konietzka et al. 2024's model, coloured by its vertical
 *   motion: rising red, sinking blue).
 * - "hypervelocity": stars leaving the Galaxy (Brown et al. 2012), each with an arrow outward from
 *   the Galactic Centre as long as its speed; S5-HVS1's path traced back to Sgr A* (Koposov et al.
 *   2020).
 * - "nanograv": the 68 millisecond pulsars of the NANOGrav 15-year data set, ringed; their
 *   timing revealed the gravitational-wave background.
 */
const VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;
const FRAGMENT = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    #include <logdepthbuf_fragment>
    float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.5);
    gl_FragColor = vec4(vec3(1.0, 0.45, 0.6) * (0.02 + 0.4 * rim), 1.0);
  }
`;

function label(text: string, color: string, at: THREE.Vector3, priority = 300): THREE.Sprite {
  const s = textSprite(text, color, 0.8);
  s.position.copy(at);
  s.userData.priority = priority;
  return s;
}

export class GalaxyExtras {
  readonly layers = { neighbourhood: new THREE.Group(), hypervelocity: new THREE.Group(), nanograv: new THREE.Group() };
  readonly group = new THREE.Group();

  constructor() {
    this.group.add(this.layers.neighbourhood, this.layers.hypervelocity, this.layers.nanograv);
  }

  setData(d: GalacticExtras): void {
    this.buildNeighbourhood(d);
    this.buildHypervelocity(d);
  }

  private buildNeighbourhood(d: GalacticExtras): void {
    const g = this.layers.neighbourhood;
    // The Local Bubble: a surface through its shell's inner radius in every direction.
    const { nLon, nLat, rPc } = d.localBubble;
    const pos: number[] = [];
    for (let j = 0; j < nLat; j++) {
      const b = -90 + (180 * j) / (nLat - 1);
      for (let i = 0; i <= nLon; i++) {
        const l = (360 * (i % nLon)) / nLon;
        pos.push(...galacticToMap(l, b, rPc[j * nLon + (i % nLon)] / 1000));
      }
    }
    const index: number[] = [];
    const w = nLon + 1;
    for (let j = 0; j < nLat - 1; j++)
      for (let i = 0; i < nLon; i++) {
        const a = j * w + i;
        index.push(a, a + 1, a + w, a + 1, a + w + 1, a + w);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const bubble = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    bubble.renderOrder = -1;
    g.add(bubble, label('Local Bubble: hot gas blown out by supernovae; the Sun is inside', '#ff9ab8', new THREE.Vector3(...galacticToMap(90, 50, 0.25))));
    // The Radcliffe Wave, coloured by its vertical velocity.
    const pts = d.radcliffeWave.map(([x, y, z]) => {
      const { l, b, dKpc } = cartesianToGalactic(x, y, z);
      return new THREE.Vector3(...galacticToMap(l, b, dKpc));
    });
    const col: number[] = [];
    for (const [, , , vz] of d.radcliffeWave) {
      const k = Math.max(-1, Math.min(1, vz / 10));
      col.push(...(k >= 0 ? [1, 0.55 - 0.35 * k, 0.35 - 0.25 * k] : [0.35 + 0.25 * k, 0.6 + 0.1 * k, 1]));
    }
    const lg = new THREE.BufferGeometry().setFromPoints(pts);
    lg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const wave = new THREE.Line(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
    wave.frustumCulled = false;
    g.add(wave, label('Radcliffe Wave: 9,000 light-years of star-forming clouds, waving', '#ffd0a0', pts[Math.floor(pts.length * 0.62)].clone()));
  }

  private buildHypervelocity(d: GalacticExtras): void {
    const g = this.layers.hypervelocity;
    const centre = new THREE.Vector3(0, 0, 0);
    const colors = { unbound: 0xff6b5a, bound: 0xffc46b, possible: 0xc9c9c9 };
    const segs: THREE.Vector3[] = [];
    const segCol: number[] = [];
    for (const h of d.hypervelocity) {
      const p = new THREE.Vector3(...galacticToMap(h.l, h.b, h.dKpc));
      const dot = new THREE.Sprite(new THREE.SpriteMaterial({ color: colors[h.kind], sizeAttenuation: false, depthWrite: false, transparent: true }));
      dot.scale.setScalar(0.012);
      dot.position.copy(p);
      g.add(dot);
      // Heading straight out from the Galactic Centre; 1,000 km/s ≈ 10 kpc of arrow.
      const out = p.clone().sub(centre).normalize().multiplyScalar((Math.abs(h.vKms) / 100) * UNITS_PER_KPC);
      segs.push(p, p.clone().add(out));
      const c = new THREE.Color(colors[h.kind]);
      segCol.push(c.r, c.g, c.b, c.r * 0.2, c.g * 0.2, c.b * 0.2);
      if (h.fromSgrA) {
        // S5-HVS1: its path traced back to Sgr A*, 4.8 million years ago.
        const back = new THREE.Line(new THREE.BufferGeometry().setFromPoints([centre, p]), new THREE.LineDashedMaterial({ color: 0xff6b5a, dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.8 }));
        back.computeLineDistances();
        g.add(back, label('S5-HVS1: flung from the black hole at 1,755 km/s', '#ff9a8a', p, 600));
      } else if (['US708', 'HE0437-5439'].includes(h.name.trim())) g.add(label(`${h.name.trim()} · ${Math.round(h.vKms)} km/s`, '#ffb3a8', p, 400));
    }
    const lg = new THREE.BufferGeometry().setFromPoints(segs);
    lg.setAttribute('color', new THREE.Float32BufferAttribute(segCol, 3));
    const arrows = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
    arrows.frustumCulled = false;
    g.add(arrows);
  }

  /** Ring the NANOGrav pulsars found in the map's pulsar catalogue. */
  setPulsars(list: PulsarRecord[]): void {
    const g = this.layers.nanograv;
    g.clear();
    const names = new Set(NANOGRAV_15YR);
    let found = 0;
    for (const p of list) {
      if (!names.has(p.jname) && !(p.bname && names.has(p.bname))) continue;
      const [l, b] = equatorialToGalactic(p.raDeg, p.decDeg);
      const at = new THREE.Vector3(...galacticToMap(l, b, p.distanceKpc));
      const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), color: 0x7fffd4, sizeAttenuation: false, depthWrite: false, transparent: true }));
      ring.scale.setScalar(0.03);
      ring.position.copy(at);
      g.add(ring);
      found++;
    }
    g.add(label(`NANOGrav: timing these ${found} pulsars revealed the gravitational-wave background (2023)`, '#7fffd4', new THREE.Vector3(...galacticToMap(0, 60, 1.2)), 500));
  }

  /** Each layer on or off; all off away from the Milky Way. */
  setVisible(layer: keyof GalaxyExtras['layers'], on: boolean): void {
    this.layers[layer].visible = on;
  }
}

let ring: THREE.Texture | undefined;
function ringTexture(): THREE.Texture {
  if (ring) return ring;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(32, 32, 24, 0, 2 * Math.PI);
  ctx.stroke();
  ring = new THREE.CanvasTexture(c);
  return ring;
}
