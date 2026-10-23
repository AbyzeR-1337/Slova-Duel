import { LEVELS, MAX_LEVEL, MAX_HINTS, pickWords, scramble, wordPoints, pickWinner, leader } from './logic.js';

export const COUNTDOWN_MS = 3000;

const zero = (players) => Object.fromEntries(players.map((p) => [p, 0]));

// Ведущий матча. Работает на устройстве хозяина (или единственном устройстве
// в режиме «на одном телефоне») и рассылает всем одинаковые сообщения.
// Каждый игрок сам замеряет, за сколько мс собрал слово, — так задержка
// сети не влияет на то, кто оказался быстрее.
export class Match {
  constructor({ players, names, send, grace = 0, lateMs = 0, timeScale = 1, rng = Math.random, clock = Date.now }) {
    this.players = players;
    this.names = { ...names };
    this.send = send;
    this.grace = grace; // сколько ждать второго ответа после первого
    this.lateMs = lateMs; // запас на задержку доставки раунда сопернику
    this.timeScale = timeScale;
    this.rng = rng;
    this.clock = clock;
    this.timers = new Set();
    this.phase = 'lobby';
    this.lobbyLevel = 1;
    this.level = 1;
    this.scores = zero(players);
    this.levelScores = zero(players);
    this.history = [];
    this.ready = {};
    this.round = null;
    this.last = { level: null, phase: null };
    this.seq = 0;
  }

  ms(x) {
    return Math.round(x * this.timeScale);
  }

  later(fn, delay) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, delay);
    this.timers.add(id);
    return id;
  }

  cancel(id) {
    clearTimeout(id);
    this.timers.delete(id);
  }

  stop() {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
  }

  emit(msg) {
    // seq помогает клиенту отбросить уже полученные сообщения при переподключении.
    msg.seq = ++this.seq;
    if (msg.t === 'level') {
      this.last.level = msg;
      this.last.phase = null;
    } else if (msg.t !== 'ready') {
      this.last.phase = msg;
    }
    this.send(msg);
  }

  setNames(names) {
    Object.assign(this.names, names);
    if (this.phase === 'lobby') this.lobby(this.lobbyLevel);
  }

  lobby(level = this.lobbyLevel) {
    this.stop();
    this.phase = 'lobby';
    this.lobbyLevel = level;
    this.ready = {};
    this.last.level = null;
    this.emit({ t: 'lobby', level, names: { ...this.names } });
  }

  start(level = this.lobbyLevel) {
    this.scores = zero(this.players);
    this.startLevel(level);
  }

  startLevel(level) {
    this.stop();
    const cfg = LEVELS[level - 1];
    this.level = level;
    this.phase = 'countdown';
    this.levelScores = zero(this.players);
    this.history = [];
    this.ready = {};
    this.words = pickWords(level, this.rng).map((w) => ({ ...w, letters: scramble(w.word, this.rng) }));
    const countdown = this.ms(COUNTDOWN_MS);
    this.emit({
      t: 'level',
      level,
      name: cfg.name,
      total: this.words.length,
      time: cfg.time,
      names: { ...this.names },
      scores: { ...this.scores },
      countdown,
    });
    this.later(() => this.nextRound(0), countdown);
  }

  nextRound(i) {
    if (i >= this.words.length) return this.endLevel();
    const w = this.words[i];
    const dur = this.ms(LEVELS[this.level - 1].time * 1000);
    this.phase = 'round';
    this.round = { i, word: w.word, dur, startedAt: this.clock(), claims: {}, graceId: null, endId: null };
    this.emit({
      t: 'round',
      i,
      total: this.words.length,
      word: w.word,
      clue: w.clue,
      letters: w.letters,
      dur,
      scores: { ...this.scores },
    });
    this.round.endId = this.later(() => this.resolve(), dur + this.lateMs);
  }

  claim(pid, { i, ms, hints }) {
    const r = this.round;
    if (this.phase !== 'round' || !r || i !== r.i) return;
    if (!this.players.includes(pid) || r.claims[pid]) return;
    ms = Number(ms);
    if (!Number.isFinite(ms) || ms < 0 || ms > r.dur + 250) return;
    hints = Math.max(0, Math.min(MAX_HINTS, Math.floor(Number(hints) || 0)));
    r.claims[pid] = { ms: Math.min(ms, r.dur), hints };
    if (Object.keys(r.claims).length === this.players.length || this.grace === 0) {
      this.resolve();
    } else if (!r.graceId) {
      r.graceId = this.later(() => this.resolve(), this.grace);
    }
  }

  resolve() {
    const r = this.round;
    if (this.phase !== 'round' || !r) return;
    this.cancel(r.endId);
    if (r.graceId) this.cancel(r.graceId);
    const winner = pickWinner(r.claims);
    let points = 0;
    let margin = null;
    if (winner) {
      const c = r.claims[winner];
      points = wordPoints(this.level, c.ms, r.dur, c.hints);
      this.scores[winner] += points;
      this.levelScores[winner] += points;
      const other = Object.entries(r.claims).find(([p]) => p !== winner);
      if (other) margin = other[1].ms - c.ms;
    }
    this.history.push({ word: r.word, winner, points });
    this.phase = 'reveal';
    this.emit({
      t: 'result',
      i: r.i,
      word: r.word,
      winner,
      points,
      ms: winner ? r.claims[winner].ms : null,
      margin,
      solved: Object.keys(r.claims),
      scores: { ...this.scores },
      levelScores: { ...this.levelScores },
    });
    this.later(() => this.nextRound(r.i + 1), this.ms(LEVELS[this.level - 1].pause));
  }

  endLevel() {
    const final = this.level >= MAX_LEVEL;
    this.phase = 'levelEnd';
    this.ready = {};
    this.emit({
      t: 'levelEnd',
      level: this.level,
      name: LEVELS[this.level - 1].name,
      final,
      levelScores: { ...this.levelScores },
      scores: { ...this.scores },
      history: this.history.slice(),
      levelWinner: leader(this.levelScores),
      matchWinner: final ? leader(this.scores) : null,
    });
  }

  setReady(pid) {
    if (this.phase !== 'levelEnd' || !this.players.includes(pid) || this.ready[pid]) return;
    this.ready[pid] = true;
    this.emit({ t: 'ready', ready: { ...this.ready } });
    if (!this.players.every((p) => this.ready[p])) return;
    if (this.level >= MAX_LEVEL) this.lobby();
    else this.startLevel(this.level + 1);
  }

  // Сообщения, которые догонят переподключившегося игрока до текущего состояния.
  snapshot() {
    if (this.phase === 'lobby') return [this.last.phase];
    if (this.phase === 'countdown') return [this.last.level];
    const out = [{ ...this.last.level, countdown: 0 }];
    const ph = this.last.phase;
    if (ph?.t === 'round') out.push({ ...ph, elapsed: this.clock() - this.round.startedAt });
    else if (ph) out.push(ph);
    if (this.phase === 'levelEnd') out.push({ t: 'ready', ready: { ...this.ready } });
    return out;
  }
}
