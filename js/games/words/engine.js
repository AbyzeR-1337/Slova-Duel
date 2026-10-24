import { Timers } from '../../core/util.js';
import { LEVELS, MAX_LEVEL, MAX_HINTS, pickWords, scramble, wordPoints, rank, parseWords } from './logic.js';

export const COUNTDOWN_MS = 3000;
const WINDOW_MS = 4000; // сколько ещё ждём остальных после первого правильного ответа
const NEXT_LEVEL_MS = 12000; // итоги уровня, потом следующий начнётся сам

const LOADERS = {
  ru: () => import('../../lang/words-ru.js'),
  en: () => import('../../lang/words-en.js'),
  uk: () => import('../../lang/words-uk.js'),
  es: () => import('../../lang/words-es.js'),
  de: () => import('../../lang/words-de.js'),
};

export async function loadWords(lang) {
  const mod = await (LOADERS[lang] || LOADERS.ru)();
  return parseWords(mod.default);
}

export async function createGame(ctx) {
  return new WordsGame(ctx, await loadWords(ctx.lang));
}

// Ведущий «Слов». Каждый игрок сам замеряет, за сколько мс собрал слово, —
// так задержка сети не решает, кто был быстрее.
export class WordsGame {
  constructor(ctx, pool, { timeScale = 1, rng = Math.random } = {}) {
    this.ctx = ctx;
    this.pool = pool;
    this.timeScale = timeScale;
    this.rng = rng;
    this.timers = new Timers();
    this.ids = ctx.seats.map((s) => s.id);
    this.scores = Object.fromEntries(this.ids.map((id) => [id, 0]));
    this.used = new Set();
    this.first = Math.min(MAX_LEVEL, Math.max(1, ctx.settings.start | 0 || 1));
    this.last = Math.min(MAX_LEVEL, this.first + Math.max(1, ctx.settings.count | 0 || 5) - 1);
    this.lateMs = ctx.remote ? 1000 : 0;
    this.grace = ctx.remote ? 600 : 0;
    this.lastMsg = { level: null, phase: null };
  }

  ms(x) {
    return Math.round(x * this.timeScale);
  }

  emit(d) {
    if (d.t === 'level') {
      this.lastMsg.level = d;
      this.lastMsg.phase = null;
    } else if (d.t !== 'prog') {
      this.lastMsg.phase = d;
    }
    this.ctx.broadcast(d);
  }

  start() {
    this.startLevel(this.first);
  }

  startLevel(n) {
    this.timers.clear();
    const cfg = LEVELS[n - 1];
    this.level = n;
    this.phase = 'countdown';
    this.levelScores = Object.fromEntries(this.ids.map((id) => [id, 0]));
    this.history = [];
    this.words = pickWords(this.pool, n, this.used, this.rng).map((w) => ({ ...w, letters: scramble(w.word, this.rng) }));
    const countdown = this.ms(COUNTDOWN_MS);
    this.emit({
      t: 'level',
      level: n,
      tier: cfg.tier,
      total: this.words.length,
      time: cfg.time,
      len: cfg.len,
      first: this.first,
      last: this.last,
      scores: { ...this.scores },
      countdown,
    });
    this.timers.later(() => this.nextRound(0), countdown);
  }

  nextRound(i) {
    if (i >= this.words.length) return this.endLevel();
    const w = this.words[i];
    const dur = this.ms(LEVELS[this.level - 1].time * 1000);
    this.phase = 'round';
    this.round = { i, word: w.word, dur, startedAt: Date.now(), claims: {}, windowId: null };
    this.emit({ t: 'round', i, total: this.words.length, word: w.word, clue: w.clue, letters: w.letters, dur, scores: { ...this.scores } });
    this.round.endId = this.timers.later(() => this.resolve(), dur + this.lateMs);
  }

  action(pid, a) {
    if (a.t === 'solve') return this.claim(pid, a);
    if (a.t === 'prog') {
      if (this.phase === 'round' && a.i === this.round.i) this.ctx.broadcast({ t: 'prog', p: pid, i: a.i, n: Math.max(0, a.n | 0) });
      return;
    }
    if (a.t === 'next' && pid === this.ctx.hostId && this.phase === 'levelEnd') this.startLevel(this.level + 1);
  }

  claim(pid, { i, ms, hints }) {
    const r = this.round;
    if (this.phase !== 'round' || !r || i !== r.i || r.claims[pid]) return;
    ms = Number(ms);
    if (!Number.isFinite(ms) || ms < 0 || ms > r.dur + 250) return;
    hints = Math.max(0, Math.min(MAX_HINTS, Math.floor(Number(hints) || 0)));
    r.claims[pid] = { ms: Math.min(ms, r.dur), hints };
    const n = Object.keys(r.claims).length;
    if (n === this.ids.length) return this.resolve();
    if (n === 1) {
      // Остальным даём ещё немного времени (но не дольше конца раунда).
      const left = r.dur - (Date.now() - r.startedAt) + this.lateMs;
      r.windowId = this.timers.later(() => this.resolve(), Math.max(0, Math.min(left, this.ms(WINDOW_MS) + this.grace)));
      this.ctx.broadcast({ t: 'first', i, p: pid });
    }
  }

  resolve() {
    const r = this.round;
    if (this.phase !== 'round' || !r) return;
    this.timers.cancel(r.endId);
    this.timers.cancel(r.windowId);
    const order = Object.entries(r.claims)
      .sort((a, b) => a[1].ms - b[1].ms)
      .map(([id, c], place) => {
        const pts = wordPoints(this.level, c.ms, r.dur, c.hints, place);
        this.scores[id] += pts;
        this.levelScores[id] += pts;
        return { id, ms: c.ms, pts };
      });
    this.history.push({ word: r.word, winner: order[0]?.id ?? null, pts: order[0]?.pts ?? 0 });
    this.phase = 'reveal';
    this.emit({ t: 'result', i: r.i, word: r.word, order, scores: { ...this.scores } });
    this.timers.later(() => this.nextRound(r.i + 1), this.ms(LEVELS[this.level - 1].pause));
  }

  endLevel() {
    const final = this.level >= this.last;
    if (final) {
      this.phase = 'over';
      this.timers.later(() => this.ctx.end(this.finish()), this.ms(1200));
      return;
    }
    this.phase = 'levelEnd';
    const left = this.ms(NEXT_LEVEL_MS);
    this.levelEndAt = Date.now() + left;
    this.emit({
      t: 'levelEnd',
      level: this.level,
      levelScores: { ...this.levelScores },
      scores: { ...this.scores },
      history: this.history.slice(),
      next: this.level + 1,
      left,
    });
    this.timers.later(() => this.startLevel(this.level + 1), left);
  }

  finish() {
    return { ranking: rank(this.scores).map((r) => ({ ...r, label: `${r.score}` })) };
  }

  snapshot() {
    if (!this.lastMsg.level) return [];
    const out = [{ ...this.lastMsg.level, countdown: 0 }];
    const ph = this.lastMsg.phase;
    if (ph?.t === 'round') out.push({ ...ph, elapsed: Date.now() - this.round.startedAt });
    else if (ph?.t === 'levelEnd') out.push({ ...ph, left: Math.max(0, this.levelEndAt - Date.now()) });
    else if (ph) out.push(ph);
    return out;
  }

  stop() {
    this.timers.clear();
  }
}
