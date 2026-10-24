import { Timers, shuffle, lev } from '../../core/util.js';

const CHOOSE_MS = 12000;
const REVEAL_MS = 5000;
const MAX_POINTS = 30000; // столько точек рисунка храним для переподключившихся
const COLOR_RE = /^#[0-9a-f]{6}$/i;

const LOADERS = {
  ru: () => import('../../lang/croc-ru.js'),
  en: () => import('../../lang/croc-en.js'),
  uk: () => import('../../lang/croc-uk.js'),
  es: () => import('../../lang/croc-es.js'),
  de: () => import('../../lang/croc-de.js'),
};

export async function loadCroc(lang) {
  const mod = await (LOADERS[lang] || LOADERS.ru)();
  const split = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  return { easy: split(mod.default.easy), medium: split(mod.default.medium), hard: split(mod.default.hard) };
}

// Сравниваем ответы без регистра, ударений и точек над буквами.
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function createGame(ctx) {
  return new CrocGame(ctx, await loadCroc(ctx.lang));
}

// «Крокодил»: один рисует слово, остальные угадывают. Рисунок идёт
// штрихами через ведущего ко всем игрокам почти в реальном времени.
export class CrocGame {
  constructor(ctx, words, { rng = Math.random, timeScale = 1 } = {}) {
    this.ctx = ctx;
    this.words = words;
    this.rng = rng;
    this.timeScale = timeScale;
    this.timers = new Timers();
    this.order = ctx.seats.map((s) => s.id);
    this.scores = Object.fromEntries(this.order.map((id) => [id, 0]));
    this.rounds = Math.max(1, Number(ctx.settings.rounds) || 1);
    this.drawMs = (Number(ctx.settings.time) || 80) * 1000;
    this.diff = ctx.settings.diff || 'easy';
    this.used = new Set();
    this.turn = -1;
    this.totalTurns = this.order.length * this.rounds;
    this.phase = 'idle';
    this.strokes = [];
    this.points = 0;
    this.chat = [];
  }

  ms(x) {
    return Math.round(x * this.timeScale);
  }

  start() {
    this.nextTurn();
  }

  stop() {
    this.timers.clear();
  }

  pool() {
    const d = this.diff === 'mix' ? ['easy', 'medium', 'hard'] : [this.diff];
    return d.flatMap((k) => this.words[k] || []);
  }

  nextTurn() {
    this.timers.clear();
    this.turn++;
    if (this.turn >= this.totalTurns) return this.over();
    this.drawer = this.order[this.turn % this.order.length];
    if (!this.ctx.isOnline(this.drawer)) return this.nextTurn();
    const pool = this.pool();
    let fresh = pool.filter((w) => !this.used.has(w));
    if (fresh.length < 3) fresh = pool;
    this.options = shuffle(fresh, this.rng).slice(0, 3);
    this.word = null;
    this.revealed = new Set();
    this.guessed = {};
    this.strokes = [];
    this.points = 0;
    this.chat = [];
    this.phase = 'choose';
    this.deadline = Date.now() + this.ms(CHOOSE_MS);
    this.timers.later(() => this.choose(Math.floor(this.rng() * this.options.length)), this.ms(CHOOSE_MS));
    this.ctx.sendTo(this.drawer, { t: 'options', words: this.options });
    this.ctx.broadcast({ t: 'clear' });
    this.broadcastState();
  }

  choose(i) {
    if (this.phase !== 'choose') return;
    this.timers.clear();
    this.word = this.options[i] ?? this.options[0];
    this.used.add(this.word);
    this.phase = 'draw';
    this.startedAt = Date.now();
    this.deadline = this.startedAt + this.ms(this.drawMs);
    this.ctx.sendTo(this.drawer, { t: 'word', word: this.word });
    this.timers.later(() => this.hint(), this.ms(this.drawMs * 0.5));
    this.timers.later(() => this.hint(), this.ms(this.drawMs * 0.75));
    this.timers.later(() => this.endTurn(), this.ms(this.drawMs));
    this.broadcastState();
  }

  // Подсказка: открываем одну случайную букву (но не больше трети слова).
  hint() {
    if (this.phase !== 'draw') return;
    const letters = [...this.word].map((ch, i) => i).filter((i) => /\p{L}/u.test(this.word[i]) && !this.revealed.has(i));
    if (letters.length <= Math.ceil([...this.word].length * 0.67)) return;
    this.revealed.add(letters[Math.floor(this.rng() * letters.length)]);
    this.broadcastState();
  }

  mask() {
    if (!this.word) return null;
    return [...this.word].map((ch, i) => (/\p{L}/u.test(ch) && !this.revealed.has(i) ? '_' : ch)).join('');
  }

  action(pid, a) {
    if (!a || typeof a.t !== 'string') return;
    if (pid === this.drawer) {
      if (a.t === 'choose') return this.choose(Number(a.i) | 0);
      if (this.phase !== 'draw') return;
      if (a.t === 'stroke') return this.stroke(a);
      if (a.t === 'undo') {
        this.strokes.pop();
        return this.ctx.broadcast({ t: 'undo' });
      }
      if (a.t === 'clear') {
        this.strokes = [];
        this.points = 0;
        return this.ctx.broadcast({ t: 'clear' });
      }
      return;
    }
    if (a.t === 'guess') this.guess(pid, String(a.text || '').slice(0, 40));
  }

  stroke(a) {
    const pts = Array.isArray(a.p) ? a.p.slice(0, 600).map((v) => Math.max(0, Math.min(1000, v | 0))) : [];
    if (!pts.length || pts.length % 2) return;
    const c = COLOR_RE.test(a.c) ? a.c : '#222222';
    const w = Math.max(1, Math.min(80, Number(a.w) || 6));
    const id = String(a.id || '').slice(0, 12);
    let s = this.strokes.find((x) => x.id === id);
    if (a.n || !s) {
      s = { id, c, w, p: [] };
      this.strokes.push(s);
    }
    if (this.points + pts.length / 2 <= MAX_POINTS) {
      s.p.push(...pts);
      this.points += pts.length / 2;
    }
    this.ctx.broadcast({ t: 's', id, c, w, p: pts, n: !!a.n });
  }

  guess(pid, text) {
    if (this.phase !== 'draw' || this.guessed[pid] != null || !this.order.includes(pid)) return;
    const g = norm(text);
    if (!g) return;
    const target = norm(this.word);
    if (g === target) return this.correct(pid);
    const msg = { t: 'chat', id: pid, text };
    this.chat.push(msg);
    if (this.chat.length > 30) this.chat.shift();
    this.ctx.broadcast(msg);
    if (lev(g, target) <= (target.length > 6 ? 2 : 1)) this.ctx.sendTo(pid, { t: 'close', text });
  }

  correct(pid) {
    const left = Math.max(0, this.deadline - Date.now()) / this.ms(this.drawMs);
    const order = Object.keys(this.guessed).length;
    const pts = Math.round((50 + 100 * left + (order === 0 ? 25 : 0)) / 5) * 5;
    this.guessed[pid] = pts;
    this.scores[pid] += pts;
    const drawerPts = order === 0 ? 40 : 20;
    this.scores[this.drawer] += drawerPts;
    this.ctx.broadcast({ t: 'correct', id: pid, pts, drawerPts });
    const waiting = this.order.filter((id) => id !== this.drawer && this.ctx.isOnline(id) && this.guessed[id] == null);
    if (!waiting.length) this.endTurn();
    else this.broadcastState();
  }

  endTurn() {
    if (this.phase !== 'draw' && this.phase !== 'choose') return;
    this.timers.clear();
    this.phase = 'reveal';
    this.deadline = null;
    this.reveal = { t: 'reveal', word: this.word, drawer: this.drawer, guessed: { ...this.guessed } };
    this.ctx.broadcast(this.reveal);
    this.broadcastState();
    this.timers.later(() => this.nextTurn(), this.ms(REVEAL_MS));
  }

  over() {
    this.phase = 'over';
    this.broadcastState();
    this.timers.later(() => this.ctx.end(this.finish()), this.ms(800));
  }

  publicState() {
    return {
      t: 'state',
      phase: this.phase,
      turn: this.turn,
      totalTurns: this.totalTurns,
      round: Math.floor(Math.max(0, this.turn) / this.order.length) + 1,
      rounds: this.rounds,
      drawer: this.drawer,
      mask: this.phase === 'reveal' ? this.word : this.mask(),
      left: this.deadline ? Math.max(0, this.deadline - Date.now()) : null,
      total: this.phase === 'choose' ? this.ms(CHOOSE_MS) : this.ms(this.drawMs),
      scores: { ...this.scores },
      guessed: Object.keys(this.guessed),
    };
  }

  broadcastState() {
    this.ctx.broadcast(this.publicState());
  }

  snapshot(pid) {
    const out = [this.publicState(), { t: 'strokes', list: this.strokes }];
    for (const m of this.chat.slice(-12)) out.push(m);
    if (pid === this.drawer && this.phase === 'choose') out.push({ t: 'options', words: this.options });
    if (pid === this.drawer && this.phase === 'draw') out.push({ t: 'word', word: this.word });
    if (this.phase === 'reveal' && this.reveal) out.push(this.reveal);
    return out;
  }

  playerLeft(pid) {
    if (pid === this.drawer && (this.phase === 'draw' || this.phase === 'choose')) this.endTurn();
  }

  finish() {
    const list = Object.entries(this.scores)
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score);
    list.forEach((r, i) => (r.place = i && r.score === list[i - 1].score ? list[i - 1].place : i + 1));
    return { ranking: list.map((r) => ({ ...r, label: String(r.score) })) };
  }
}
