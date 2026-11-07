import { $, escapeHtml, toast } from '../ui/dom';
import { prefs } from '../ui/galaxyStore';
import { CHALLENGES, dailyChallenge, newChallengeState, type Challenge } from '../game/challenges';
import { LESSONS, type Lesson } from '../game/lessons';
import { SPAWN_TYPES } from './shared';
import type { App } from '../app';

/** Interactive lessons and challenges. */
export class LearningUI {
  constructor(private readonly app: App) {}

  openLessonMenu(): void {
    $('lesson-list').innerHTML = LESSONS.map((l) => {
      const done = prefs.get<boolean>(`lesson:${l.id}`, false);
      return `<div class="card"><h3>${done ? '✓ ' : ''}${escapeHtml(l.title)}</h3><p>${escapeHtml(l.summary)}</p><div class="row"><span class="muted small" style="flex:1">${l.steps.length} steps</span><button class="primary" data-lesson="${l.id}">Start</button></div></div>`;
    }).join('');
    $('lesson-menu').classList.remove('hidden');
  }

  startLesson(def: Lesson): void {
    $('lesson-menu').classList.add('hidden');
    if (this.app.challenge) this.quitChallenge();
    if (this.app.view !== 'system') this.app.setView('system');
    this.app.lesson = { def, step: 0, events: [], done: new Set() };
    document.body.classList.add('lesson-active');
    $('lesson-card').classList.remove('hidden');
    this.showLessonStep(0);
  }

  exitLesson(): void {
    this.app.lesson = undefined;
    document.body.classList.remove('lesson-active');
    $('lesson-card').classList.add('hidden');
  }

  showLessonStep(i: number): void {
    const l = this.app.lesson;
    if (!l) return;
    if (i >= l.def.steps.length) {
      prefs.set(`lesson:${l.def.id}`, true);
      toast(`Lesson complete: ${l.def.title}`);
      this.exitLesson();
      return;
    }
    l.step = Math.max(0, i);
    const step = l.def.steps[l.step];
    if (step.setup) {
      const setup = step.setup;
      this.app.loadScenario({ name: l.def.title, description: l.def.summary, load: () => setup(this.app.sim) }, { undoable: false, lesson: true });
      this.app.setRunning(true);
      l.events = [];
    }
    if (step.select) {
      const b = this.app.sim.bodies.find((x) => x.name === step.select);
      if (b) {
        this.app.selectBody(b);
        this.app.system.follow(b.id);
      }
    }
    if (step.graph) this.app.graphUI.openGraph(step.graph);
    $('lesson-step').textContent = `${l.def.title} · step ${l.step + 1} of ${l.def.steps.length}`;
    $('lesson-title').textContent = step.title;
    $('lesson-text').innerHTML = step.text
      .split('\n\n')
      .map((p) => `<p>${escapeHtml(p)}</p>`)
      .join('');
    $<HTMLButtonElement>('lesson-back').disabled = l.step === 0;
    $('lesson-next').textContent = l.step === l.def.steps.length - 1 ? 'Finish' : 'Next';
    this.renderLessonTask();
  }

  renderLessonTask(): void {
    const l = this.app.lesson;
    if (!l) return;
    const step = l.def.steps[l.step];
    const el = $('lesson-task');
    el.classList.toggle('hidden', !step.task);
    if (!step.task) return;
    const done = l.done.has(l.step);
    el.className = `alert ${done ? 'good' : 'warn'}`;
    el.textContent = `${done ? '✓' : '→'} ${step.task}`;
  }

  checkLesson(): void {
    const l = this.app.lesson;
    if (!l) return;
    const step = l.def.steps[l.step];
    if (!step.check || l.done.has(l.step)) return;
    const ok = step.check({
      sim: this.app.sim,
      selected: this.app.selectedBody(),
      events: l.events,
      flags: { habitableZones: this.app.system.habitableZones, lagrange: this.app.system.lagrangeEnabled, relativity: this.app.sim.relativity, graphMetric: this.app.graphOpen ? this.app.graphMetric : undefined },
    });
    if (ok) {
      l.done.add(l.step);
      this.renderLessonTask();
      this.app.audio.play('ignite', 0.05);
      toast('✓ Nice! Press Next to continue.');
    }
  }

  // ---------------------------------------------------------------------------
  // Challenges

  blockedInChallenge(what: string): boolean {
    if (!this.app.challenge || this.app.challenge.result) return false;
    toast(`${what} isn't available during a challenge`);
    return true;
  }

  openChallengeMenu(): void {
    const daily = dailyChallenge();
    const cards = [daily, ...CHALLENGES].map((c) => {
      const best = prefs.get<number>(`stars:${c.id}`, 0);
      const stars = '★'.repeat(best) + '☆'.repeat(3 - best);
      return `<div class="card${c === daily ? ' daily' : ''}"><h3>${escapeHtml(c.title)}</h3><p>${escapeHtml(c.summary)}</p><div class="row"><span class="stars" style="flex:1">${stars}</span><button class="primary" data-challenge="${c.id}">Play</button></div></div>`;
    });
    $('challenge-list').innerHTML = cards.join('');
    $('challenge-menu').classList.remove('hidden');
  }

  findChallenge(id: string): Challenge | undefined {
    const daily = dailyChallenge();
    return id === daily.id ? daily : CHALLENGES.find((c) => c.id === id);
  }

  startChallenge(def: Challenge): void {
    $('challenge-menu').classList.add('hidden');
    $('challenge-result').classList.add('hidden');
    if (this.app.lesson) this.exitLesson();
    if (this.app.view !== 'system') this.app.setView('system');
    this.app.challenge = { def, st: newChallengeState(this.app.sim) };
    this.app.loadScenario({ name: def.title, description: def.goal, load: () => def.setup(this.app.sim) }, { undoable: false, challenge: true });
    this.app.challenge.st = newChallengeState(this.app.sim);
    // Start paused so the player can read the goal and plan.
    this.app.setRunning(false);
    setTimeout(() => toast('Paused: read the goal, plan your move, then press ▶ (Space).'), 400);
    this.app.setTool(def.rules.pushes ? 'nudge' : 'select');
    const allowed = def.rules.spawns ? def.rules.spawnTypes ?? [] : [];
    $('spawn-palette').querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('hidden', !allowed.includes(b.dataset.type!)));
    $<HTMLButtonElement>('tool-spawn').disabled = !allowed.length;
    if (allowed.length) {
      const t = SPAWN_TYPES.find((s) => s.id === allowed[0]);
      if (t) this.app.spawnType = t;
    }
    $('hud-title').textContent = def.title;
    $('hud-goal').textContent = def.goal;
    $('hud-progress').textContent = '';
    $('challenge-hud').classList.remove('hidden');
    this.app.updateUndoButtons();
  }

  quitChallenge(): void {
    this.app.challenge = undefined;
    $('challenge-hud').classList.add('hidden');
    $('challenge-result').classList.add('hidden');
    $('spawn-palette').querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.remove('hidden'));
    $<HTMLButtonElement>('tool-spawn').disabled = false;
  }

  evaluateChallenge(): void {
    const c = this.app.challenge;
    if (!c || c.result) return;
    const res = c.def.evaluate(this.app.sim, c.st);
    const rules = c.def.rules;
    const extras: string[] = [];
    if (rules.pushes) extras.push(`pushes ${c.st.pushes}/${rules.pushes}`);
    if (rules.spawns) extras.push(`spawns ${c.st.spawns}/${rules.spawns}`);
    $('hud-progress').textContent = [res.progress, ...extras].filter(Boolean).join(' · ');
    if (res.status === 'playing') return;
    c.result = res;
    this.app.setRunning(false);
    const best = prefs.get<number>(`stars:${c.def.id}`, 0);
    if (res.status === 'won' && (res.stars ?? 0) > best) prefs.set(`stars:${c.def.id}`, res.stars);
    $('result-stars').textContent = res.status === 'won' ? '★'.repeat(res.stars ?? 1) + '☆'.repeat(3 - (res.stars ?? 1)) : '';
    $('result-title').textContent = res.status === 'won' ? 'Challenge complete!' : 'Not this time';
    $('result-text').textContent = res.status === 'won' ? res.progress : (res.reason ?? '');
    $('result-share').classList.toggle('hidden', res.status !== 'won');
    $('challenge-result').classList.remove('hidden');
    this.app.audio.play(res.status === 'won' ? 'ignite' : 'collapse', 0.1);
  }
}
