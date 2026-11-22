import * as THREE from 'three';
import { $, toast } from '../ui/dom';
import { angleDiff, deviceQuaternion, trueAlpha } from '../render/devicePointing';
import type { App } from '../app';

type OrientationReading = DeviceOrientationEvent & { webkitCompassHeading?: number };
type PermissionRequester = { requestPermission?: () => Promise<'granted' | 'denied'> };

/**
 * Point the phone at the sky: the Sky view follows the device's orientation, so whatever the phone
 * is aimed at is what the screen shows. Uses the compass for north where the device has one
 * (Android's absolute orientation, the iPhone's compass heading); a sideways drag corrects the
 * heading. While on, the sky runs in real time at the observer's location, and the screen is kept
 * awake.
 */
export class PointSkyUI {
  private on = false;
  private readonly target = new THREE.Quaternion();
  private readonly current = new THREE.Quaternion();
  private started = false;
  /** iPhone: the difference between the compass's true alpha and the event's relative alpha, smoothed. */
  private compassOffset?: number;
  private haveNorth = false;
  private wakeLock?: { release: () => Promise<void> };
  private readonly onAbsolute = (e: Event) => this.reading(e as OrientationReading, true);
  private readonly onRelative = (e: Event) => this.reading(e as OrientationReading, false);
  private absoluteSeen = false;

  constructor(private readonly app: App) {}

  /** Phones and tablets with an orientation sensor get the button. */
  static supported(): boolean {
    return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window && matchMedia('(pointer: coarse)').matches;
  }

  wire(): void {
    if (PointSkyUI.supported()) document.body.classList.add('can-point');
    $('btn-sky-point').addEventListener('click', () => void (this.on ? this.stop() : this.start()));
  }

  /** Leaving the Sky view stops pointing. */
  onView(view: string): void {
    if (view !== 'sky' && this.on) this.stop();
  }

  async start(): Promise<void> {
    // iPhone and iPad ask first, from the tap itself.
    const req = (window.DeviceOrientationEvent as unknown as PermissionRequester).requestPermission;
    if (typeof req === 'function') {
      try {
        if ((await req()) !== 'granted') return toast('Motion access was not allowed, so the sky can’t follow the phone.');
      } catch {
        return toast('Motion access was not allowed, so the sky can’t follow the phone.');
      }
    }
    this.on = true;
    this.started = false;
    this.compassOffset = undefined;
    this.haveNorth = false;
    this.absoluteSeen = false;
    this.app.sky.headingOffset = 0;
    window.addEventListener('deviceorientationabsolute', this.onAbsolute);
    window.addEventListener('deviceorientation', this.onRelative);
    $('btn-sky-point').classList.add('on');
    $('btn-sky-point').textContent = '✋ Stop pointing';
    // The sky as it is now, here.
    this.app.skyDate = new Date();
    this.app.skySpeed = 1;
    $<HTMLSelectElement>('sky-speed').value = '1';
    this.app.skyUI.setSkyTimeInput();
    if (navigator.geolocation)
      navigator.geolocation.getCurrentPosition(
        (pos) => this.app.skyUI.setSkyPlace(pos.coords.latitude, pos.coords.longitude),
        () => toast(`Using ${$<HTMLSelectElement>('sky-place').selectedOptions[0]?.text ?? 'the chosen place'}: set your location in the Where pane for an exact sky.`),
        { timeout: 10000, maximumAge: 600000 },
      );
    try {
      this.wakeLock = await (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen');
    } catch {
      // Not available or refused: the screen may dim as usual.
    }
    toast('Hold the phone up to the sky. If the stars don’t line up, drag sideways to correct the compass.');
    // No sensor reading at all within two seconds: this device can't do it.
    setTimeout(() => {
      if (this.on && !this.started) {
        void this.stop();
        toast('No motion sensor readings came in, so the sky can’t follow this device.');
      }
    }, 2000);
  }

  async stop(): Promise<void> {
    this.on = false;
    window.removeEventListener('deviceorientationabsolute', this.onAbsolute);
    window.removeEventListener('deviceorientation', this.onRelative);
    this.app.sky.setPointing(undefined);
    $('btn-sky-point').classList.remove('on');
    $('btn-sky-point').textContent = '📱 Point at the sky';
    try {
      await this.wakeLock?.release();
    } catch {
      // Already released.
    }
    this.wakeLock = undefined;
  }

  private reading(e: OrientationReading, absoluteEvent: boolean): void {
    if (!this.on || e.alpha === null || e.beta === null || e.gamma === null) return;
    // Prefer the absolute stream when the device has one (Android); ignore the relative duplicate.
    if (absoluteEvent) this.absoluteSeen = true;
    else if (this.absoluteSeen) return;
    let alpha = e.alpha;
    const north = trueAlpha(e, absoluteEvent);
    if (north !== undefined && !absoluteEvent && !e.absolute) {
      // iPhone: alpha is relative to where the phone pointed at the start; the compass gives true
      // north. Track the offset between them, smoothed, and apply it.
      const off = angleDiff(north, e.alpha);
      this.compassOffset = this.compassOffset === undefined ? off : this.compassOffset + 0.1 * angleDiff(off, this.compassOffset);
      alpha = e.alpha + this.compassOffset;
      this.haveNorth = true;
    } else if (north !== undefined) {
      alpha = north;
      this.haveNorth = true;
    }
    const screen = screen_angle();
    deviceQuaternion(alpha, e.beta, e.gamma, screen, this.target);
    if (!this.started) {
      this.current.copy(this.target);
      this.started = true;
      if (!this.haveNorth) toast('This device doesn’t report a compass heading: drag sideways to line the sky up with a star you know.');
    } else {
      // Smooth out sensor jitter.
      this.current.slerp(this.target, 0.25);
    }
    this.app.sky.setPointing(this.current);
  }
}

function screen_angle(): number {
  const o = (screen as Screen & { orientation?: { angle: number } }).orientation;
  if (o && typeof o.angle === 'number') return o.angle;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === 'number' ? legacy : 0;
}
