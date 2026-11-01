import { stateSize, type SimState } from '../sim/state';

/**
 * Time-travel support:
 *  - a rolling buffer of automatic snapshots for rewinding, bounded by memory;
 *  - undo/redo stacks of snapshots taken before user actions.
 */
export class History {
  private timeline: SimState[] = [];
  private timelineBytes = 0;
  private undoStack: { state: SimState; label: string }[] = [];
  private redoStack: { state: SimState; label: string }[] = [];

  constructor(
    private readonly maxTimelineBytes = 48 * 1024 * 1024,
    private readonly maxTimeline = 240,
    private readonly maxUndo = 40,
  ) {}

  // Rewind timeline --------------------------------------------------------

  record(state: SimState): void {
    const last = this.timeline[this.timeline.length - 1];
    if (last && last.time === state.time) return;
    this.timeline.push(state);
    this.timelineBytes += stateSize(state);
    while (this.timeline.length > this.maxTimeline || (this.timelineBytes > this.maxTimelineBytes && this.timeline.length > 2)) {
      this.timelineBytes -= stateSize(this.timeline.shift()!);
    }
  }

  /** Pop the most recent snapshot strictly before `time`. */
  rewind(time: number): SimState | undefined {
    while (this.timeline.length) {
      const s = this.timeline.pop()!;
      this.timelineBytes -= stateSize(s);
      if (s.time < time - 1e-9) return s;
    }
    return undefined;
  }

  get canRewind(): boolean {
    return this.timeline.length > 0;
  }

  clearTimeline(): void {
    this.timeline = [];
    this.timelineBytes = 0;
  }

  // Undo / redo ------------------------------------------------------------

  /** Remember the state before a user action. */
  push(state: SimState, label: string): void {
    this.undoStack.push({ state, label });
    if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(current: SimState): { state: SimState; label: string } | undefined {
    const entry = this.undoStack.pop();
    if (entry) this.redoStack.push({ state: current, label: entry.label });
    return entry;
  }

  redo(current: SimState): { state: SimState; label: string } | undefined {
    const entry = this.redoStack.pop();
    if (entry) this.undoStack.push({ state: current, label: entry.label });
    return entry;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
