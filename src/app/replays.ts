import { captureState, restoreState } from '../sim/state';
import { formatTime } from '../sim/units';
import { $, toast } from '../ui/dom';
import { ReplayPlayer, VideoRecorder } from '../ui/replay';
import type { App } from '../app';

/** Recording and playing back replays, and exporting video. */
export class ReplaysUI {
  constructor(private readonly app: App) {}

  toggleRecording(): void {
    if (this.app.recorder.recording) return this.stopRecording();
    if (this.app.player) return;
    this.app.recorder.start(this.app.scenario.name);
    $('btn-record').classList.add('recording');
    toast('Recording a replay… press ⏺ again to stop.');
  }

  stopRecording(): void {
    const replay = this.app.recorder.stop();
    $('btn-record').classList.remove('recording');
    if (!replay) return void toast('Recording was too short.');
    this.startReplay(new ReplayPlayer(replay));
  }

  startReplay(player: ReplayPlayer): void {
    this.app.preReplay = captureState(this.app.sim);
    this.app.wasRunningBeforeRewind = this.app.running;
    this.app.setRunning(false);
    this.app.player = player;
    this.app.system.clearTrails();
    $('replay-bar').classList.remove('hidden');
    $('replay-play').textContent = '⏸';
  }

  exitReplay(): void {
    if (!this.app.player) return;
    this.app.player = undefined;
    $('replay-bar').classList.add('hidden');
    if (this.app.preReplay) {
      restoreState(this.app.sim, this.app.preReplay);
      this.app.host.commit();
    }
    this.app.system.clearTrails();
  }

  updateReplayBar(): void {
    const p = this.app.player;
    if (!p) return;
    $<HTMLInputElement>('replay-seek').value = String(Math.round((p.position / Math.max(1, p.replay.frames.length - 1)) * 1000));
    $('replay-time').textContent = `${p.time.toFixed(1)} / ${p.duration.toFixed(1)} s · ${formatTime(this.app.sim.time)}`;
    $('replay-play').textContent = p.playing ? '⏸' : '▶';
    if (!p.playing && this.app.video.active) void this.finishVideo();
  }

  async toggleVideo(): Promise<void> {
    if (!VideoRecorder.supported()) return void toast('Video recording is not supported in this browser.');
    if (this.app.video.active) return this.finishVideo();
    this.app.video.start(this.app.canvas);
    $('btn-video').textContent = '⏹ Stop video';
    toast('Recording video… press Stop video when done.');
  }

  async finishVideo(): Promise<void> {
    if (!this.app.video.active) return;
    const blob = await this.app.video.stop();
    $('btn-video').textContent = '🎥 Video';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `astrarium-${this.app.scenario.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Video saved');
  }
}
