import * as THREE from 'three';
import type { Laniakea } from '../sim/laniakea';
import { textSprite } from './galaxyView';

/**
 * Laniakea in the Universe view (sim/laniakea.ts): the flow lines of the CosmicFlows-4 velocity
 * field, gold where they start inside our supercluster and blue around it, brightening as they
 * run together towards the attractors; Laniakea's surface as a faint golden skin; and the Milky
 * Way marked near its edge. Additive, like light, so where many flows meet they glow.
 */
const LINE_VERTEX = /* glsl */ `
  attribute float along;
  attribute vec3 tint;
  varying float vAlong;
  varying vec3 vTint;
  void main() {
    vAlong = along;
    vTint = tint;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const LINE_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying float vAlong;
  varying vec3 vTint;
  void main() {
    // Faint where a flow starts, bright where it arrives.
    float k = 0.18 + 0.82 * vAlong * vAlong;
    gl_FragColor = vec4(vTint * k * uOpacity, 1.0);
  }
`;
const SKIN_VERTEX = /* glsl */ `
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const SKIN_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.5);
    gl_FragColor = vec4(vec3(1.0, 0.74, 0.34) * (0.008 + 0.32 * rim) * uOpacity, 1.0);
  }
`;

const GOLD = [1.0, 0.78, 0.4];
const BLUE = [0.2, 0.32, 0.62];

export class LaniakeaView {
  readonly group = new THREE.Group();
  private readonly lineMaterial: THREE.ShaderMaterial;
  private readonly skinMaterial: THREE.ShaderMaterial;
  private readonly here: THREE.Sprite;
  private readonly hereLabel: THREE.Sprite;
  /** Where the flows converge (Mpc) and Laniakea's rough radius, for fading with distance. */
  readonly attractor: THREE.Vector3;
  private readonly radius: number;

  constructor(data: Laniakea, dotTexture: THREE.Texture) {
    // Flow lines as segments, each vertex knowing how far along its line it is.
    let segs = 0;
    for (const len of data.lineLengths) segs += len - 1;
    const pos = new Float32Array(segs * 6);
    const along = new Float32Array(segs * 2);
    const tint = new Float32Array(segs * 6);
    let p = 0;
    let s = 0;
    data.lineLengths.forEach((len, line) => {
      const col = data.lineInside[line] ? GOLD : BLUE;
      for (let i = 0; i < len - 1; i++) {
        for (const k of [i, i + 1]) {
          pos.set(data.points.subarray((p + k) * 3, (p + k) * 3 + 3), s * 3);
          along[s] = k / (len - 1);
          tint.set(col, s * 3);
          s++;
        }
      }
      p += len;
    });
    const lines = new THREE.BufferGeometry();
    lines.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    lines.setAttribute('along', new THREE.BufferAttribute(along, 1));
    lines.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
    this.lineMaterial = new THREE.ShaderMaterial({
      vertexShader: LINE_VERTEX,
      fragmentShader: LINE_FRAGMENT,
      uniforms: { uOpacity: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const flow = new THREE.LineSegments(lines, this.lineMaterial);
    flow.frustumCulled = false;
    this.group.add(flow);

    // The skin.
    const skin = new THREE.BufferGeometry();
    skin.setAttribute('position', new THREE.BufferAttribute(data.vertices, 3));
    skin.setIndex(new THREE.BufferAttribute(data.triangles, 1));
    skin.computeVertexNormals();
    this.skinMaterial = new THREE.ShaderMaterial({
      vertexShader: SKIN_VERTEX,
      fragmentShader: SKIN_FRAGMENT,
      uniforms: { uOpacity: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(skin, this.skinMaterial);
    mesh.renderOrder = -1;
    this.group.add(mesh);

    // You are here.
    this.here = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture, color: 0xff3b30, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false }));
    this.here.scale.setScalar(0.022);
    this.hereLabel = textSprite('Milky Way: you are here', '#ff8a80', 0.9);
    // Above every other label in the Universe view's declutter (labelDeclutter.ts).
    this.hereLabel.userData.priority = 1e6;
    this.hereLabel.center.set(-0.05, 0.5);
    this.group.add(this.here, this.hereLabel);

    this.attractor = new THREE.Vector3(...data.attractor);
    skin.computeBoundingSphere();
    this.radius = skin.boundingSphere?.radius ?? 100;
  }

  /** Fade in once the camera is out at Laniakea's scale, and out again at the cosmic web's. */
  update(camera: THREE.Camera): void {
    const d = camera.position.distanceTo(this.attractor);
    const r = this.radius;
    const k = THREE.MathUtils.smoothstep(d, r * 0.35, r * 1.2) * (1 - THREE.MathUtils.smoothstep(d, r * 12, r * 30));
    this.lineMaterial.uniforms.uOpacity.value = 0.4 * k;
    this.skinMaterial.uniforms.uOpacity.value = k;
    const show = k > 0.05;
    this.here.visible = this.hereLabel.visible = show;
    (this.here.material as THREE.SpriteMaterial).opacity = k;
    // (The label's opacity belongs to the declutter, which fades it in and out.)
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.Sprite) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
