import * as THREE from 'three';
import { equatorialToGalactic } from '../procgen/galaxy';
import { galacticToCosmos } from '../sim/galaxies';
import { comovingDistance } from '../sim/cosmology';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { textSprite } from './galaxyView';
import { dotTexture } from './textures';
import { greatWallCount, HCB, inGreatWall, type Grb } from '../sim/grbs';
import { bootesVoid, voidCensus } from '../sim/voids';
import type { WebGalaxy } from '../sim/galaxies';

/**
 * Shapes in the Universe view that labels alone can't show:
 *
 * - The Zone of Avoidance: within about 10° of the Milky Way's plane its dust and stars hide the
 *   galaxies behind (Kraan-Korteweg & Lahav 2000), so every galaxy survey has a gap there. Drawn as
 *   the wedge |b| < 10°, out to 600 Mpc.
 * - The Quipu superstructure (Böhringer et al. 2025, A&A 695, A59): 68 galaxy clusters at z ≈ 0.043
 *   along a 428 Mpc chain. Its northern 20 clusters have a mean right ascension of 45.5°, its
 *   southern 48 of 89.3°, from Dec +51.7° to −69.8°; the line follows those means, so it is a
 *   sketch of its run, not each cluster.
 * - The Big Ring (Lopez et al. 2024, JCAP 07, 055): a ring of Mg II absorbers ~400 Mpc across at
 *   z ≈ 0.80, near Boötes, about RA 208°, Dec 51° (read off the paper's figures).
 * - The Giant Arc (Lopez, Clowes & Williger 2022, MNRAS 516, 1557): an arc ~1 Gpc long at z ≈ 0.80,
 *   12° from the Big Ring, about RA 212.5°, Dec 39°, running west–east. Drawn as a gentle arc.
 * Both arcs are debated: they are traced by absorbers in quasar spectra, and some argue they are
 * chance alignments. The labels say "claimed".
 * - The Hercules–Corona Borealis Great Wall (claimed; sim/grbs.ts): the region where Horváth et al.
 *   found an excess of gamma-ray bursts, 45° around RA 255°, Dec +27.75°, between redshift 1.6
 *   and 2.1, outlined; and every burst with a measured redshift, the Wall's in gold. No survey maps
 *   its galaxies (it is ~10 billion light-years away): its only tracers are those bursts, so its
 *   shape is drawn from them, joined by their minimum spanning tree and wrapped in their convex
 *   hull, with the largest distance between two of them.
 */
function eq(raDeg: number, decDeg: number, dMpc: number): THREE.Vector3 {
  const [l, b] = equatorialToGalactic(raDeg, decDeg);
  return new THREE.Vector3(...galacticToCosmos(l, b, dMpc));
}

/** Unit vectors east and north on the sky at (RA, Dec), in the Universe frame. */
function skyBasis(raDeg: number, decDeg: number): { east: THREE.Vector3; north: THREE.Vector3 } {
  const c = eq(raDeg, decDeg, 1);
  const e = eq(raDeg + 0.01, decDeg, 1).sub(c).normalize();
  const n = eq(raDeg, decDeg + 0.01, 1).sub(c).normalize();
  return { east: e, north: n };
}

function glowLine(points: THREE.Vector3[], color: number): THREE.Line {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  line.frustumCulled = false;
  return line;
}

/** A smooth curve through a few points (centripetal Catmull–Rom). */
function smooth(points: THREE.Vector3[], n = 160): THREE.Vector3[] {
  return new THREE.CatmullRomCurve3(points, false, 'centripetal').getPoints(n);
}

interface Shape {
  obj: THREE.Object3D;
  /** Camera distances (Mpc, from the shape's centre) over which it shows. */
  near: number;
  far: number;
  centre: THREE.Vector3;
  strength: number;
}

/** Prim's minimum spanning tree of the points, as line-segment pairs: the shortest links joining them all. */
function spanningTree(p: THREE.Vector3[]): THREE.Vector3[] {
  const inTree = [0];
  const links: THREE.Vector3[] = [];
  while (inTree.length < p.length) {
    let best = Infinity, from = -1, to = -1;
    for (const i of inTree)
      for (let j = 0; j < p.length; j++) {
        if (inTree.includes(j)) continue;
        const d = p[i].distanceTo(p[j]);
        if (d < best) [best, from, to] = [d, i, j];
      }
    links.push(p[from], p[to]);
    inTree.push(to);
  }
  return links;
}

/** The convex hull of the points as a faint skin, brighter at its edges. */
function hullSkin(p: THREE.Vector3[], rgb: [number, number, number]): THREE.Mesh {
  const skin = new THREE.Mesh(
    new ConvexGeometry(p),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uOpacity: { value: 1 } },
      vertexShader: /* glsl */ `
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
        }`,
      fragmentShader: /* glsl */ `
        #include <logdepthbuf_pars_fragment>
        uniform float uOpacity;
        varying vec3 vN;
        varying vec3 vView;
        void main() {
          #include <logdepthbuf_fragment>
          float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.0);
          gl_FragColor = vec4(vec3(${rgb.map((c) => c.toFixed(3)).join(', ')}) * (0.03 + 0.22 * rim) * uOpacity, 1.0);
        }`,
    }),
  );
  skin.frustumCulled = false;
  return skin;
}

export class CosmicShapes {
  readonly group = new THREE.Group();
  private readonly shapes: Shape[] = [];
  private readonly zoa: THREE.Mesh;
  private readonly zoaLabel: THREE.Sprite;

  constructor() {
    // The Zone of Avoidance: two cones at b = ±10°, faint, fading outwards.
    const R = 600;
    const segs = 128;
    const pos: number[] = [];
    const fade: number[] = [];
    const index: number[] = [];
    for (const b of [10, -10]) {
      const base = pos.length / 3;
      for (let k = 0; k <= segs; k++) {
        const l = (k / segs) * 360;
        pos.push(0, 0, 0, ...galacticToCosmos(l, b, R));
        fade.push(1, 0);
      }
      for (let k = 0; k < segs; k++) {
        const a = base + 2 * k;
        index.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('fade', new THREE.Float32BufferAttribute(fade, 1));
    geo.setIndex(index);
    this.zoa = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uOpacity: { value: 0 } },
        vertexShader: /* glsl */ `
          #include <common>
          #include <logdepthbuf_pars_vertex>
          attribute float fade;
          varying float vFade;
          void main() {
            vFade = fade;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: /* glsl */ `
          #include <logdepthbuf_pars_fragment>
          uniform float uOpacity;
          varying float vFade;
          void main() {
            #include <logdepthbuf_fragment>
            gl_FragColor = vec4(vec3(0.55, 0.12, 0.1) * pow(vFade, 1.5) * uOpacity, 1.0);
          }`,
      }),
    );
    this.zoa.frustumCulled = false;
    this.zoa.renderOrder = -2;
    this.group.add(this.zoa);
    this.zoaLabel = textSprite('Zone of Avoidance: the Milky Way’s dust hides the galaxies here', '#ff9a8a', 0.8);
    this.zoaLabel.position.set(...galacticToCosmos(300, 0, 140));
    this.zoaLabel.userData.priority = 50;
    this.group.add(this.zoaLabel);

    // Quipu: its run through the means of its northern and southern clusters.
    const dq = comovingDistance(0.043);
    const quipu = smooth([eq(45.5, 51.7, dq), eq(45.5, 26, dq), eq(52, 2, dq), eq(80, -16, dq), eq(89.3, -40, dq), eq(89.3, -69.8, dq)]);
    this.add(glowLine(quipu, 0xffb36b), 120, 3000, 0.75);

    // The Big Ring, in the plane of the sky.
    const z8 = comovingDistance(0.802);
    const ring: THREE.Vector3[] = [];
    {
      const c = eq(208, 51, z8);
      const { east, north } = skyBasis(208, 51);
      for (let k = 0; k <= 128; k++) {
        const a = (k / 128) * 2 * Math.PI;
        ring.push(c.clone().addScaledVector(east, 200 * Math.cos(a)).addScaledVector(north, 200 * Math.sin(a)));
      }
    }
    this.add(glowLine(ring, 0x9fc2ff), 500, 20000, 0.8);

    // The Giant Arc: ~1 Gpc west–east, bowed by a sixth of its length.
    {
      const c = eq(212.5, 39, z8);
      const { east, north } = skyBasis(212.5, 39);
      const arc: THREE.Vector3[] = [];
      for (let k = 0; k <= 64; k++) {
        const t = k / 64 - 0.5;
        arc.push(c.clone().addScaledVector(east, 1000 * t).addScaledVector(north, -170 * (1 - 4 * t * t)));
      }
      this.add(glowLine(arc, 0x9fc2ff), 500, 20000, 0.8);
    }

    // The Hubble Ultra Deep Field (RA 53.16°, Dec −27.79°): a sightline 2.4′ wide (a tenth of the
    // full Moon) out to redshift ~11, along which ~10,000 galaxies were counted; JWST's JADES survey
    // looks along it too. Drawn as a line (at true width it would be invisible).
    {
      const far = comovingDistance(11);
      const line = glowLine([eq(53.1625, -27.7914, 30), eq(53.1625, -27.7914, far)], 0xfff2b0);
      this.add(line, 300, 40000, 0.7);
    }

    // The Great Wall's region: its 45° circle at redshift 1.6 and 2.1, joined by radial edges.
    {
      const { east, north } = skyBasis(HCB.raDeg, HCB.decDeg);
      const axis = eq(HCB.raDeg, HCB.decDeg, 1);
      const rim = (d: number) => {
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 96; k++) {
          const a = (k / 96) * 2 * Math.PI;
          const off = east.clone().multiplyScalar(Math.cos(a)).addScaledVector(north, Math.sin(a)).multiplyScalar(Math.sin(HCB.radiusDeg * (Math.PI / 180)));
          pts.push(axis.clone().multiplyScalar(Math.cos(HCB.radiusDeg * (Math.PI / 180))).add(off).multiplyScalar(d));
        }
        return pts;
      };
      const [d0, d1] = [comovingDistance(HCB.zMin), comovingDistance(HCB.zMax)];
      const inner = rim(d0), outer = rim(d1);
      // The region searched (faint): the structure itself is drawn from its bursts (addWallShape).
      this.add(glowLine(inner, 0xffb347), 2000, 40000, 0.25);
      this.add(glowLine(outer, 0xffb347), 2000, 40000, 0.25);
      for (let k = 0; k < 96; k += 12) this.add(glowLine([inner[k], outer[k]], 0xffb347), 2000, 40000, 0.15);
    }
  }

  /** Gamma-ray bursts at their comoving distances; the Great Wall's in gold, with the counts. */
  private grbLayer?: THREE.Group;
  private grbsOn = true;

  setGrbs(bursts: Grb[]): void {
    const at = (b: Grb) => eq(b[1], b[2], comovingDistance(b[3]));
    const points = (list: Grb[], color: number, size: number) => {
      const pts = new THREE.Points(
        new THREE.BufferGeometry().setFromPoints(list.map(at)),
        new THREE.PointsMaterial({ color, size, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      pts.frustumCulled = false;
      return pts;
    };
    this.grbLayer = new THREE.Group();
    const wall = bursts.filter(inGreatWall);
    this.grbLayer.add(points(bursts.filter((b) => !inGreatWall(b)), 0xff7a45, 3), points(wall, 0xffd36b, 7));
    this.addWallShape(wall.map(at));
    const now = greatWallCount(bursts);
    const then = greatWallCount(bursts, 2012);
    // The evidence, in two lines: bursts at redshift 1.6–2.1 in the region against chance.
    [
      `Gold bursts (z 1.6–2.1): ${then.inside} of ${then.total} by 2012, chance ${then.expected.toFixed(0)}`,
      `${now.inside} of ${now.total} today, chance ${now.expected.toFixed(0)}: a wall, or a fluke?`,
    ].forEach((line, k) => {
      const s = textSprite(line, '#ffd36b', 0.7);
      s.userData.priority = 900 - k; // above the other labels in the declutter
      s.position.copy(eq(HCB.raDeg, HCB.decDeg - 10 - 7 * k, comovingDistance(1.85)));
      this.grbLayer!.add(s);
    });
    this.grbLayer.visible = this.grbsOn;
    this.group.add(this.grbLayer);
  }

  /**
   * The Boötes Void (sim/voids.ts): a faint bubble at its published place and size, the few survey
   * galaxies inside it picked out, and how empty it is in the survey against the same distances
   * elsewhere.
   */
  setVoid(galaxies: WebGalaxy[], H0: number): void {
    const { centre, radius } = bootesVoid(H0);
    const c = new THREE.Vector3(...centre);
    const bubble = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 64, 32),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uOpacity: { value: 0 } },
        vertexShader: /* glsl */ `
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
          }`,
        fragmentShader: /* glsl */ `
          #include <logdepthbuf_pars_fragment>
          uniform float uOpacity;
          varying vec3 vN;
          varying vec3 vView;
          void main() {
            #include <logdepthbuf_fragment>
            float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 3.0);
            gl_FragColor = vec4(vec3(0.45, 0.65, 1.0) * rim * uOpacity, 1.0);
          }`,
      }),
    );
    bubble.position.copy(c);
    bubble.frustumCulled = false;
    this.voidBubble = bubble;
    this.voidCentre = c;
    this.voidRadius = radius;
    // The survey's galaxies inside it, picked out.
    const members = galaxies.map((g) => new THREE.Vector3(...galacticToCosmos(g[0], g[1], g[2] / H0))).filter((p) => p.distanceTo(c) < radius);
    const pts = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints(members),
      new THREE.PointsMaterial({ color: 0xcfe2ff, size: 6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }),
    );
    pts.frustumCulled = false;
    this.voidPoints = pts;
    const census = voidCensus(galaxies, H0);
    const label = textSprite(
      `In the survey: ${census.inside} galaxies where an average patch has ${census.expected.toFixed(0)} (${Math.round(census.ratio * 100)}% of normal)`,
      '#b9d4ff',
      0.7,
    );
    label.position.copy(c).add(new THREE.Vector3(0, -radius * 0.55, 0));
    label.userData.priority = 870;
    this.voidLabel = label;
    this.group.add(bubble, pts, label);
  }
  private voidBubble?: THREE.Mesh;
  private voidPoints?: THREE.Points;
  private voidLabel?: THREE.Sprite;
  private voidCentre = new THREE.Vector3();
  private voidRadius = 1;

  /**
   * Fast radio bursts traced to their host galaxies (sim/frbs.ts): millisecond radio flashes, each
   * at its host's distance; the two famous ones named.
   */
  private frbLayer?: THREE.Group;
  setFrbs(bursts: [string, number, number, number, string?][]): void {
    const g = new THREE.Group();
    const pts = bursts.map(([, ra, dec, z]) => eq(ra, dec, comovingDistance(z)));
    const dots = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.PointsMaterial({ color: 0x6ff7ff, size: 7, sizeAttenuation: false, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    dots.frustumCulled = false;
    g.add(dots);
    bursts.forEach(([name, , , z, note], i) => {
      // The DSA team's informal nicknames are lower case; only the famous two get a note.
      if (!note || note[0] === note[0].toLowerCase() && !note.includes(' ')) return;
      const s = textSprite(`${name}: ${note} · redshift ${z}`, '#9ffbff', 0.7);
      s.position.copy(pts[i]);
      s.userData.priority = 700;
      g.add(s);
    });
    this.frbLayer = g;
    g.visible = this.frbsOn;
    this.group.add(g);
  }
  private frbsOn = true;
  setFrbsVisible(on: boolean): void {
    this.frbsOn = on;
    if (this.frbLayer) this.frbLayer.visible = on;
  }

  /** The Wall as its bursts trace it: their minimum spanning tree, convex hull and largest span. */
  private addWallShape(p: THREE.Vector3[]): void {
    if (p.length < 4 || !this.grbLayer) return;
    // The minimum spanning tree: the shortest set of links joining every burst.
    const tree = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(spanningTree(p)),
      new THREE.LineBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    tree.frustumCulled = false;
    // Its skin: the convex hull of the bursts, faintly gold, brighter at its edges.
    const skin = hullSkin(p, [1, 0.78, 0.35]);
    // Its size: the two bursts farthest apart.
    let span = 0;
    for (const a of p) for (const b of p) span = Math.max(span, a.distanceTo(b));
    const centre = p.reduce((c, v) => c.add(v), new THREE.Vector3()).divideScalar(p.length);
    const size = textSprite(`${p.length} bursts, ${(span * 3.2616e-3).toFixed(0)} billion ly end to end (densest part: 7–10 billion)`, '#ffe3a3', 0.65);
    size.position.copy(centre).addScaledVector(centre.clone().normalize(), -900);
    size.userData.priority = 880;
    this.grbLayer.add(skin, tree, size);
  }

  /**
   * The Saraswati Supercluster (sim/saraswati.ts): its galaxy clusters at their redshifts, the
   * five of the bound core larger and gold, joined by their spanning tree inside a faint hull. It
   * shows from a few thousand Mpc away.
   */
  setSaraswati(members: { l: number; b: number; z: number; core: boolean }[]): void {
    if (members.length < 4) return;
    const at = (m: (typeof members)[number]) => new THREE.Vector3(...galacticToCosmos(m.l, m.b, comovingDistance(m.z)));
    const p = members.map(at);
    const points = (list: THREE.Vector3[], color: number, size: number) => {
      const pts = new THREE.Points(
        new THREE.BufferGeometry().setFromPoints(list),
        // Round, soft dots: each a galaxy cluster.
        new THREE.PointsMaterial({ color, size, map: dotTexture(), sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      pts.frustumCulled = false;
      return pts;
    };
    const group = new THREE.Group();
    const tree = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(spanningTree(p)),
      new THREE.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    tree.frustumCulled = false;
    const skin = hullSkin(p, [1, 0.7, 0.35]);
    const centre = p.reduce((c, v) => c.add(v), new THREE.Vector3()).divideScalar(p.length);
    const core = members.filter((m) => m.core).length;
    const label = textSprite(`${members.length} galaxy clusters · gold: the ${core} of its core`, '#ffd59a', 0.65);
    label.position.copy(centre).addScaledVector(centre.clone().normalize(), -60);
    label.userData.priority = 875;
    group.add(skin, tree, points(members.filter((m) => !m.core).map(at), 0xffb067, 10), points(members.filter((m) => m.core).map(at), 0xffe08a, 18), label);
    this.saraswati = { group, centre };
    this.group.add(group);
  }
  private saraswati?: { group: THREE.Group; centre: THREE.Vector3 };

  setGrbsVisible(on: boolean): void {
    this.grbsOn = on;
    if (this.grbLayer) this.grbLayer.visible = on;
  }

  private add(obj: THREE.Object3D, near: number, far: number, strength: number): void {
    const box = new THREE.Box3().setFromObject(obj);
    this.shapes.push({ obj, near, far, centre: box.getCenter(new THREE.Vector3()), strength });
    this.group.add(obj);
  }

  setZoneVisible(on: boolean): void {
    this.zoa.visible = this.zoaLabel.visible = on;
  }

  update(camera: THREE.Camera): void {
    const d0 = camera.position.length();
    (this.zoa.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0.35 * THREE.MathUtils.smoothstep(d0, 15, 60) * (1 - THREE.MathUtils.smoothstep(d0, 2500, 6000));
    this.zoaLabel.visible = this.zoa.visible && d0 > 40 && d0 < 2500;
    if (this.voidBubble) {
      // Shows from a few void-widths away out to the cosmic-web scale.
      const dv = camera.position.distanceTo(this.voidCentre);
      const k = THREE.MathUtils.smoothstep(dv, this.voidRadius * 0.6, this.voidRadius * 1.5) * (1 - THREE.MathUtils.smoothstep(dv, this.voidRadius * 25, this.voidRadius * 60));
      (this.voidBubble.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0.9 * k;
      (this.voidPoints!.material as THREE.PointsMaterial).opacity = k;
      this.voidLabel!.visible = k > 0.4;
    }
    if (this.grbLayer?.visible) {
      // The bursts are billions of light-years away: they show once the view is out that far.
      const g = THREE.MathUtils.smoothstep(d0, 400, 2000);
      for (const o of this.grbLayer.children) {
        if (o instanceof THREE.Points) (o.material as THREE.PointsMaterial).opacity = 0.9 * g;
        else if (o instanceof THREE.LineSegments) (o.material as THREE.LineBasicMaterial).opacity = 0.55 * g;
        else o.visible = g > 0.5;
      }
    }
    if (this.saraswati) {
      const ds = camera.position.distanceTo(this.saraswati.centre);
      const k = 1 - THREE.MathUtils.smoothstep(ds, 2500, 5000);
      for (const o of this.saraswati.group.children) {
        if (o instanceof THREE.Points) (o.material as THREE.PointsMaterial).opacity = 0.95 * k;
        else if (o instanceof THREE.LineSegments) (o.material as THREE.LineBasicMaterial).opacity = 0.6 * k;
        else if (o instanceof THREE.Mesh) ((o.material as THREE.ShaderMaterial).uniforms.uOpacity.value = k);
        else o.visible = k > 0.5;
      }
    }
    for (const s of this.shapes) {
      const d = camera.position.distanceTo(s.centre);
      const k = THREE.MathUtils.smoothstep(d, s.near * 0.5, s.near) * (1 - THREE.MathUtils.smoothstep(d, s.far, s.far * 2));
      ((s.obj as THREE.Line).material as THREE.LineBasicMaterial).opacity = s.strength * k;
    }
  }
}

