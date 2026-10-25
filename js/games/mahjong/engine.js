import { Timers } from '../../core/util.js';
import { positions, deal, reshuffle, moves, matches, isFree } from './tiles.js';

// Маджонг-гонка: у всех одинаковая раскладка, кто первым разберёт — победил.
// Если время вышло, выше тот, у кого осталось меньше костей.

const HINTS = 3;

export async function createGame(ctx) {
  return new MahjongGame(ctx);
}

export class MahjongGame {
  constructor(ctx, { rng = Math.random, timeScale = 1 } = {}) {
    this.ctx = ctx;
    this.rng = rng;
    this.timeScale = timeScale;
    this.timers = new Timers();
    this.size = ['small', 'medium', 'large'].includes(ctx.settings.size) ? ctx.settings.size : 'small';
    this.limit = (Number(ctx.settings.time) || 5) * 60000;
    this.pos = positions(this.size);
    this.players = ctx.seats.map((s) => ({ id: s.id, bot: !!s.bot, kinds: null, left: this.pos.length, at: 0, hints: HINTS, shuffles: 0 }));
  }

  ms(x) {
    return Math.round(x * this.timeScale);
  }

  start() {
    const kinds = deal(this.pos, this.rng);
    for (const p of this.players) p.kinds = kinds.slice();
    this.started = Date.now();
    this.deadline = this.started + this.ms(this.limit);
    this.timers.later(() => this.end('time'), this.ms(this.limit));
    for (const p of this.players) if (p.bot) this.botLater(p);
    this.ctx.broadcast({ t: 'layout', size: this.size, pos: this.pos, kinds });
    this.broadcast();
  }

  stop() {
    this.timers.clear();
  }

  player(id) {
    return this.players.find((p) => p.id === id);
  }

  action(pid, a) {
    const p = this.player(pid);
    if (!p || this.over || !a) return;
    if (a.t === 'pair') return this.pair(p, Number(a.a), Number(a.b));
    if (a.t === 'hint') return this.hint(p);
    if (a.t === 'shuffle') return this.shuffle(p);
  }

  pair(p, a, b) {
    const k = p.kinds;
    const present = k.map(Boolean);
    const ok = a !== b && matches(k[a], k[b]) && isFree(this.pos, present, a) && isFree(this.pos, present, b);
    if (!ok) {
      if (!p.bot) this.sendBoard(p);
      return;
    }
    k[a] = k[b] = null;
    p.left -= 2;
    p.at = Date.now();
    if (!p.left) return this.end('clear', p);
    // Ходов не осталось — перемешиваем бесплатно (раздача всё равно решаема).
    if (!moves(this.pos, k).length) this.shuffle(p, true);
    else if (!p.bot) this.sendBoard(p);
    this.broadcast();
  }

  hint(p) {
    if (!p.hints) return;
    const m = moves(this.pos, p.kinds);
    if (!m.length) return this.shuffle(p, true);
    p.hints--;
    const [a, b] = m[Math.floor(this.rng() * m.length)];
    this.ctx.sendTo(p.id, { t: 'hint', a, b, hints: p.hints });
    this.broadcast();
  }

  shuffle(p, auto = false) {
    p.kinds = reshuffle(this.pos, p.kinds, this.rng);
    if (!auto) p.shuffles++;
    if (!p.bot) this.sendBoard(p, auto ? 'auto' : 'manual');
    this.broadcast();
  }

  sendBoard(p, shuffled = null) {
    this.ctx.sendTo(p.id, { t: 'board', kinds: p.kinds.slice(), hints: p.hints, shuffled });
  }

  // Бот снимает пару каждые несколько секунд; иногда «задумывается».
  botLater(p) {
    const delay = 2600 + this.rng() * 2600 + (this.rng() < 0.12 ? 4000 : 0);
    this.timers.later(() => {
      if (this.over) return;
      const m = moves(this.pos, p.kinds);
      if (!m.length) this.shuffle(p, true);
      else {
        // Предпочитаем пары с верхних слоёв — так меньше шанс застрять.
        m.sort((x, y) => this.pos[y[0]].z + this.pos[y[1]].z - this.pos[x[0]].z - this.pos[x[1]].z);
        const top = m.slice(0, Math.max(1, Math.ceil(m.length / 2)));
        const [a, b] = top[Math.floor(this.rng() * top.length)];
        this.pair(p, a, b);
      }
      if (!this.over) this.botLater(p);
    }, this.ms(delay));
  }

  end(reason, winner = null) {
    if (this.over) return;
    this.over = { reason, winner: winner?.id || null };
    this.timers.clear();
    this.broadcast();
    this.timers.later(() => this.ctx.end(this.finish()), this.ms(2500));
  }

  finish() {
    const t0 = this.started || Date.now();
    const list = this.players.slice().sort((a, b) => a.left - b.left || (a.at || Infinity) - (b.at || Infinity));
    return {
      ranking: list.map((p, i) => ({
        id: p.id,
        place: i + 1,
        score: this.pos.length - p.left,
        label: p.left ? `${p.left} 🀄` : `✓ ${Math.round((p.at - t0) / 1000)}s`,
      })),
    };
  }

  publicState() {
    return {
      t: 'state',
      total: this.pos.length,
      left: this.deadline ? Math.max(0, this.deadline - Date.now()) : null,
      over: this.over || null,
      players: this.players.map((p) => ({ id: p.id, left: p.left, shuffles: p.shuffles })),
    };
  }

  broadcast() {
    this.ctx.broadcast(this.publicState());
  }

  snapshot(pid) {
    const p = this.player(pid);
    const out = [{ t: 'layout', size: this.size, pos: this.pos, kinds: p ? p.kinds : this.players[0].kinds }, this.publicState()];
    if (p) out.push({ t: 'board', kinds: p.kinds.slice(), hints: p.hints });
    return out;
  }
}
