import * as THREE from 'three';

/**
 * Virtual reality (WebXR).
 *
 * - **Sandbox (tabletop):** the whole system shrinks to fit on a table in front of you. The left
 *   stick turns it, the right stick makes it bigger or smaller, and the trigger pauses.
 * - **Galaxy Map, Universe and Sky (immersive):** you stand where the camera was, inside the
 *   galaxy or among the galaxies. The left stick flies the way you look. The right stick turns
 *   you in 30° steps (left/right) and makes you bigger or smaller (up/down), so you can tower over
 *   the Milky Way or shrink down to the Sun's neighbourhood. Flying speed scales with your size.
 *
 * In the immersive views you move by shifting the headset's reference space (VrRig): the camera
 * stays in world coordinates, so every view keeps working as it does on screen. The right stick
 * changes how far a metre of real movement takes you (how big you are). Stereo depth is the
 * headset's own, so the scale doesn't change how deep the view looks.
 */

/** Dead zone for thumbsticks. */
export const DEAD_ZONE = 0.15;

/** Stick value with the dead zone removed and rescaled to 0…1 beyond it. */
export function deadZone(v: number): number {
  const a = Math.abs(v);
  if (a < DEAD_ZONE) return 0;
  return Math.sign(v) * ((a - DEAD_ZONE) / (1 - DEAD_ZONE));
}

/**
 * How far to fly this frame: along the view (`forward`, pushed up = forwards) and sideways
 * (`right`), at `speed` world units per second at full deflection.
 */
export function flyStep(stickX: number, stickY: number, forward: THREE.Vector3, right: THREE.Vector3, speed: number, dt: number): THREE.Vector3 {
  const x = deadZone(stickX), y = deadZone(stickY);
  // WebXR thumbsticks report up as negative y.
  return new THREE.Vector3().addScaledVector(forward, -y * speed * dt).addScaledVector(right, x * speed * dt);
}

/** Growth factor this frame from a stick (up = bigger), doubling each second at full deflection. */
export function scaleStep(stickY: number, dt: number): number {
  return Math.pow(2, -deadZone(stickY) * dt);
}

/** Snap turning: a 30° turn each time the stick is pushed past 0.7, re-armed once it returns. */
export class SnapTurn {
  private armed = true;

  /** Returns the turn (radians, positive = left) for this frame. */
  update(stickX: number): number {
    if (Math.abs(stickX) < 0.3) {
      this.armed = true;
      return 0;
    }
    if (this.armed && Math.abs(stickX) > 0.7) {
      this.armed = false;
      return stickX > 0 ? -Math.PI / 6 : Math.PI / 6;
    }
    return 0;
  }
}

/** The thumbstick axes of each hand from the session's input sources (xr-standard mapping: axes 2, 3). */
export function readSticks(session: XRSession | null | undefined): { left: [number, number]; right: [number, number] } {
  const out = { left: [0, 0] as [number, number], right: [0, 0] as [number, number] };
  if (!session) return out;
  for (const source of session.inputSources) {
    const axes = source.gamepad?.axes;
    if (!axes || axes.length < 2) continue;
    const pair: [number, number] = axes.length >= 4 ? [axes[2], axes[3]] : [axes[0], axes[1]];
    if (source.handedness === 'left') out.left = pair;
    else out.right = pair;
  }
  return out;
}

/**
 * Where the viewer stands in the world (`position`, the floor under their feet) and which way
 * they face (`yaw`), as the offset WebXR applies to the headset's reference space: the pose in the
 * offset space is the pose relative to that spot. Returns the XRRigidTransform's position and
 * orientation.
 */
export function offsetTransform(position: THREE.Vector3, yaw: number): { position: THREE.Vector3; orientation: THREE.Quaternion } {
  // world = T(position) · R(yaw) · pose  ⇒  offset = (T · R)⁻¹ = R(−yaw) · T(−position)
  const orientation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
  return { position: position.clone().negate().applyQuaternion(orientation), orientation };
}

/**
 * Immersive VR: the viewer starts where the screen's camera was and flies around with the
 * thumbsticks. The camera stays in world coordinates (the views keep working as on screen);
 * only the headset's reference space moves.
 */
export class VrRig {
  readonly position = new THREE.Vector3();
  yaw = 0;
  /** World units per metre of real movement (the flying speed grows and shrinks with it). */
  scale: number;
  private readonly turn = new SnapTurn();

  constructor(camera: THREE.PerspectiveCamera, metresToWorld: number) {
    camera.updateMatrixWorld();
    // Eyes where the camera was: the floor about 1.6 m (in real terms) below.
    this.position.setFromMatrixPosition(camera.matrixWorld);
    this.position.y -= 1.6;
    const dir = camera.getWorldDirection(new THREE.Vector3());
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.scale = metresToWorld;
  }

  /** Per frame: fly the way you look, snap-turn, and change speed, from the thumbsticks. */
  update(session: XRSession | null | undefined, camera: THREE.Camera, dt: number): void {
    const { left, right } = readSticks(session);
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const rightDir = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
    if (rightDir.lengthSq() < 1e-8) rightDir.set(1, 0, 0);
    rightDir.normalize();
    this.position.add(flyStep(left[0], left[1], forward, rightDir, this.scale * 4, dt));
    const turn = this.turn.update(right[0]);
    if (turn) {
      // Turn about the head, not the far-away origin.
      const head = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
      this.position.sub(head).applyAxisAngle(new THREE.Vector3(0, 1, 0), turn).add(head);
      this.yaw += turn;
    }
    this.scale *= scaleStep(right[1], dt);
  }

  /** The offset reference space for this frame. */
  space(base: XRReferenceSpace): XRReferenceSpace {
    const t = offsetTransform(this.position, this.yaw);
    return base.getOffsetReferenceSpace(new XRRigidTransform({ x: t.position.x, y: t.position.y, z: t.position.z }, { x: t.orientation.x, y: t.orientation.y, z: t.orientation.z, w: t.orientation.w }));
  }
}

/** Tabletop: turn the table (left stick x) and scale it (right stick y). */
export function tabletopStep(scene: THREE.Object3D, session: XRSession | null | undefined, dt: number): void {
  const { left, right } = readSticks(session);
  scene.rotation.y += deadZone(left[0]) * dt * 1.2;
  scene.scale.multiplyScalar(scaleStep(right[1], dt));
}
