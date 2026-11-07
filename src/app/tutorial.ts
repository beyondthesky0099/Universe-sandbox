import { prefs } from '../ui/galaxyStore';
import type { App } from '../app';

/** The guided tour. */
export class TutorialUI {
  constructor(private readonly app: App) {}

  openTutorial(): void {
    this.app.tutorial.open(() => prefs.set('tutorialDone', true));
  }

  tutorialSteps() {
    const toSystem = () => {
      if (this.app.view !== 'system') this.app.setView('system');
    };
    return [
      {
        title: 'Welcome to Astrarium',
        body: 'A universe sandbox: explore a procedurally generated galaxy, then drop into any star system and play with real N-body gravity. This quick tour shows you around. Press ? at any time to see it again.',
      },
      {
        title: 'The galaxy map',
        body: 'Thirty thousand explorable star systems. Search by name, filter for habitable worlds, bookmark favourites, and zoom right into a star to warp into its system.',
        target: '#tab-galaxy',
      },
      {
        title: 'Scenarios',
        body: 'Pick a ready-made scenario such as a giant impact, a ring-forming moon, a supernova or a 2,000-star cluster. Save scenes to a file or copy a share link.',
        target: '#section-scenario',
        enter: toSystem,
      },
      {
        title: 'Spawn things',
        body: 'Choose the Spawn tool, pick an object, then click to place it and drag to set its velocity. Auto-orbit gives it a circular orbit, and the dashed line previews its path.',
        target: '#section-tools',
        enter: toSystem,
      },
      {
        title: 'Control time',
        body: 'Pause, hold ⏪ (or R) to rewind, and undo or redo any change with Ctrl+Z / Ctrl+Shift+Z.',
        target: '#topbar .clock',
        enter: toSystem,
      },
      {
        title: 'Physics',
        body: 'Change simulation speed and gravity, and toggle collisions, shattering impacts and tidal breakup. Large scenes switch to a Barnes–Hut tree automatically.',
        target: '#section-sim',
        enter: toSystem,
      },
      {
        title: 'Inspect anything',
        body: 'Click a body to see its temperature, habitability and orbit, plus warnings about upcoming close approaches and collisions. Double-click to follow it. Massive stars get a supernova button.',
      },
      {
        title: 'Play, learn, create',
        body: 'The top-right buttons open challenges and a daily puzzle (🏆), interactive lessons (📚), a live graph (📈), multiplayer rooms (👥), the community gallery (🌐) and a scripting console (⌨). Type a scene into “Create with Claude” to have it built for you.',
        target: '#btn-console',
      },
      {
        title: 'Display',
        body: 'Show habitable zones, orbit paths and trails (relative to the followed body if you like). Graphics quality is under Settings, and 🔇 turns on sound.',
        target: '#section-display',
        enter: toSystem,
      },
    ];
  }
}
