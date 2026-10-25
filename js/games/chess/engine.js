import { Timers } from '../../core/util.js';
import { START, parseFen, toFen, makeMove, legalMoves, outcome, posKey, notation } from './rules.js';
import { bestMove } from './ai.js';

export async function createGame(ctx) {
  return new ChessGame(ctx);
}

// Шахматы: два игрока (или человек против бота), цвет — по жребию.
export class ChessGame {
  constructor(ctx, { rng = Math.random, timeScale = 1 } = {}) {
    this.ctx = ctx;
    this.rng = rng;
    this.timeScale = timeScale;
    this.timers = new Timers();
    const [a, b] = ctx.seats;
    const swap = rng() < 0.5;
    this.side = { w: swap ? b : a, b: swap ? a : b };
    this.level = ctx.settings.level || 'medium';
    const clock = Number(ctx.settings.clock) || 0;
    this.clocks = clock ? { w: clock * 1000, b: clock * 1000 } : null;
    this.s = parseFen(START);
    this.keys = [posKey(this.s)];
    this.log = [];
    this.last = null;
    this.result = null;
  }

  start() {
    this.turnStarted = Date.now();
    this.next();
  }

  stop() {
    this.timers.clear();
  }

  colorOf(pid) {
    return this.side.w.id === pid ? 'w' : this.side.b.id === pid ? 'b' : null;
  }

  next() {
    const o = outcome(this.s, this.keys);
    this.check = o.check;
    if (o.over) return this.finishWith(o.over, o.winner);
    this.broadcast();
    const mover = this.side[this.s.turn];
    if (mover.bot) {
      this.timers.later(() => {
        const m = bestMove(this.s, { level: this.level, rng: this.rng, timeMs: 700 });
        if (m) this.play(m);
      }, Math.round((400 + this.rng() * 500) * this.timeScale));
    }
    if (this.clocks) {
      this.timers.cancel(this.flagTimer);
      this.flagTimer = this.timers.later(() => this.flag(), Math.max(0, this.clocks[this.s.turn]));
    }
  }

  flag() {
    if (this.result) return;
    this.clocks[this.s.turn] = 0;
    this.finishWith('time', this.s.turn === 'w' ? 'b' : 'w');
  }

  action(pid, a) {
    if (this.result) return;
    const c = this.colorOf(pid);
    if (!c) return;
    if (a.t === 'resign') return this.finishWith('resign', c === 'w' ? 'b' : 'w');
    if (a.t !== 'move' || c !== this.s.turn) return;
    const m = legalMoves(this.s).find((x) => x.from === a.from && x.to === a.to && (!x.promo || x.promo === (a.promo || 'q')));
    if (m) this.play(m);
  }

  play(m) {
    if (this.clocks) {
      const used = Date.now() - this.turnStarted;
      this.clocks[this.s.turn] = Math.max(0, this.clocks[this.s.turn] - used);
    }
    this.log.push(notation(this.s, m));
    this.last = { from: m.from, to: m.to };
    this.s = makeMove(this.s, m);
    this.keys.push(posKey(this.s));
    this.turnStarted = Date.now();
    this.next();
  }

  finishWith(reason, winner) {
    this.timers.clear();
    this.result = { reason, winner };
    this.broadcast();
    this.timers.later(() => this.ctx.end(this.finish()), Math.round(2500 * this.timeScale));
  }

  publicState() {
    const running = !this.result && this.clocks ? this.s.turn : null;
    const clocks = this.clocks && { ...this.clocks };
    if (running) clocks[running] = Math.max(0, clocks[running] - (Date.now() - this.turnStarted));
    return {
      t: 'state',
      fen: toFen(this.s),
      white: this.side.w.id,
      black: this.side.b.id,
      last: this.last,
      check: this.check,
      log: this.log.slice(-60),
      moves: this.log.length,
      clocks,
      running,
      result: this.result,
    };
  }

  broadcast() {
    this.ctx.broadcast(this.publicState());
  }

  snapshot() {
    return [this.publicState()];
  }

  finish() {
    const w = this.result?.winner;
    const ids = [this.side.w.id, this.side.b.id];
    if (!w) return { ranking: ids.map((id) => ({ id, place: 1, score: 0.5, label: '½' })) };
    const win = this.side[w].id;
    return {
      ranking: [
        { id: win, place: 1, score: 1, label: '1' },
        { id: ids.find((x) => x !== win), place: 2, score: 0, label: '0' },
      ],
      extra: { reason: this.result.reason },
    };
  }
}
