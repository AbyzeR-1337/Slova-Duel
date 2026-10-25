import { Timers } from '../core/util.js';

// Основа для настольных игр на двоих: стороны по жребию, ход бота,
// «сдаться», итог. Конкретная игра реализует outcome(), apply(), botMove(), view().
export class DuelGame {
  constructor(ctx, { rng = Math.random, timeScale = 1, colors = ['w', 'b'] } = {}) {
    this.ctx = ctx;
    this.rng = rng;
    this.timeScale = timeScale;
    this.timers = new Timers();
    const [a, b] = ctx.seats;
    const swap = rng() < 0.5;
    this.colors = colors;
    this.side = { [colors[0]]: swap ? b : a, [colors[1]]: swap ? a : b };
    this.level = ctx.settings.level || 'medium';
    this.result = null;
  }

  start() {
    this.next();
  }

  stop() {
    this.timers.clear();
  }

  colorOf(pid) {
    return this.colors.find((c) => this.side[c].id === pid) || null;
  }

  other(c) {
    return c === this.colors[0] ? this.colors[1] : this.colors[0];
  }

  next() {
    const o = this.outcome();
    if (o.over) return this.finishWith(o.over, o.winner, o.extra);
    this.broadcast();
    const mover = this.side[this.turn()];
    if (mover.bot) {
      this.timers.later(() => {
        if (this.result) return;
        const m = this.botMove();
        this.apply(this.turn(), m);
        this.next();
      }, Math.round((450 + this.rng() * 500) * this.timeScale));
    }
  }

  action(pid, a) {
    if (this.result) return;
    const c = this.colorOf(pid);
    if (!c) return;
    if (a.t === 'resign') return this.finishWith('resign', this.other(c));
    if (c !== this.turn()) return;
    if (this.apply(c, a)) this.next();
  }

  finishWith(reason, winner, extra = null) {
    this.timers.clear();
    this.result = { reason, winner, ...(extra || {}) };
    this.broadcast();
    this.timers.later(() => this.ctx.end(this.finish()), Math.round(3000 * this.timeScale));
  }

  broadcast() {
    this.ctx.broadcast({ t: 'state', ...this.view(), sides: Object.fromEntries(this.colors.map((c) => [c, this.side[c].id])), result: this.result });
  }

  snapshot() {
    return [{ t: 'state', ...this.view(), sides: Object.fromEntries(this.colors.map((c) => [c, this.side[c].id])), result: this.result }];
  }

  finish() {
    const ids = this.colors.map((c) => this.side[c].id);
    const w = this.result?.winner;
    if (!w) return { ranking: ids.map((id) => ({ id, place: 1, score: 0.5, label: '½' })) };
    const win = this.side[w].id;
    return {
      ranking: [
        { id: win, place: 1, score: 1, label: '1' },
        { id: ids.find((x) => x !== win), place: 2, score: 0, label: '0' },
      ],
    };
  }
}
