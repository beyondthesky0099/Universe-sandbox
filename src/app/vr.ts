import { $, toast } from '../ui/dom';
import { tabletopStep, VrRig } from '../render/vr';
import type { App } from '../app';

/** Virtual reality: the tabletop Sandbox and flying through the other views (render/vr.ts). */
export class VrUI {
  constructor(private readonly app: App) {}

  async detectVR(): Promise<void> {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) return;
    try {
      if (await xr.isSessionSupported('immersive-vr')) $('btn-vr').classList.remove('hidden');
    } catch {
      // not supported
    }
  }

  async enterVR(): Promise<void> {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) return;
    const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    this.app.renderer.xr.setReferenceSpaceType('local-floor');
    await this.app.renderer.xr.setSession(session);
    if (this.app.view !== 'system') {
      this.enterImmersiveVR(session);
      return;
    }
    // Tabletop scale: the whole scene fits in about a metre, at waist height in front of you.
    const scene = this.app.system.scene;
    scene.scale.setScalar(0.6 / this.app.system.sceneExtent());
    scene.position.set(0, 1.0, -1.0);
    const controllers = [0, 1].map((i) => this.app.renderer.xr.getController(i));
    const onSelect = () => this.app.setRunning(!this.app.running);
    for (const c of controllers) {
      c.addEventListener('select', onSelect);
      scene.add(c);
    }
    session.addEventListener('end', () => {
      scene.scale.setScalar(1);
      scene.position.set(0, 0, 0);
      for (const c of controllers) {
        c.removeEventListener('select', onSelect);
        scene.remove(c);
      }
    });
    toast('VR: pull the trigger to pause or resume; left stick turns the table, right stick resizes it.');
  }

  /** Galaxy Map, Universe or Sky in VR: stand where the camera was and fly with the thumbsticks (render/vr.ts). */
  enterImmersiveVR(session: XRSession): void {
    const view = this.app.view === 'galaxy' ? this.app.galaxy : this.app.view === 'cosmos' ? this.app.cosmos : undefined;
    const camera = view ? view.camera : this.app.sky.camera;
    // Flying speed from how far away the camera was looking; the sky is a sphere around you, so no flying there.
    const scale = view ? Math.max(1e-6, view.camera.position.distanceTo(view.controls.target) * 0.05) : 0;
    this.app.vrRig = new VrRig(camera, scale);
    this.app.vrBase = this.app.renderer.xr.getReferenceSpace() ?? undefined;
    if (view) view.controls.enabled = false;
    session.addEventListener('end', () => {
      this.app.vrRig = undefined;
      this.app.vrBase = undefined;
      if (view) {
        view.controls.enabled = true;
        view.controls.update();
      }
    });
    toast(view ? 'VR: left stick flies where you look; right stick turns (left/right) and changes speed (up/down).' : 'VR: look around the sky.');
  }

  /** Per frame while a headset is on. */
  tickVR(dt: number): void {
    const session = this.app.renderer.xr.getSession();
    if (this.app.view === 'system') {
      tabletopStep(this.app.system.scene, session, dt);
    } else if (this.app.vrRig && this.app.vrBase) {
      const camera = this.app.view === 'galaxy' ? this.app.galaxy.camera : this.app.view === 'cosmos' ? this.app.cosmos.camera : this.app.sky.camera;
      if (this.app.vrRig.scale > 0) this.app.vrRig.update(session, camera, dt);
      this.app.renderer.xr.setReferenceSpace(this.app.vrRig.space(this.app.vrBase));
    }
  }
}
