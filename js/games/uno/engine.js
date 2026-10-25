import { Timers, shuffle } from '../../core/util.js';

// Карта — две буквы: цвет (r, y, g, b; w — дикая) и значение
// (0–9, S — пропуск хода, R — разворот, D — +2, W — смена цвета, F — +4).
export const COLORS = ['r', 'y', 'g', 'b'];

export function makeDeck() {
  const out = [];
  for (const c of COLORS) {
    out.push(c + '0');
    for (const v of '123456789SRD') out.push(c + v, c + v);
  }
  for (let i = 0; i < 4; i++) out.push('wW', 'wF');
  return out;
}

export const cardPoints = (c) => (c[0] === 'w' ? 50 : 'SRD'.includes(c[1]) ? 20 : Number(c[1]));

const TURN_MS = 25000;
const CATCH_MS = 5000;

export async function createGame(ctx) {
  return new UnoGame(ctx);
}

export class UnoGame {
  constructor(ctx, { rng = Math.random, timeScale = 1 } = {}) {
    this.ctx = ctx;
    this.rng = rng;
    this.timeScale = timeScale;
    this.timers = new Timers();
    this.players = ctx.seats.map((s) => ({ id: s.id, bot: !!s.bot, hand: [], armed: false }));
    this.stacking = ctx.settings.stack === 'on' || ctx.settings.stack === true;
    this.dir = 1;
    this.turn = 0;
    this.pending = 0; // сколько карт должен взять следующий при «стопке» +2/+4
    this.drawn = null;
    this.vulnerable = null;
    this.event = null;
    this.over = null;
    this.useTimer = ctx.humans >= 2;
    this.seq = 0;
  }

  ms(x) {
    return Math.round(x * this.timeScale);
  }

  start() {
    this.pile = shuffle(makeDeck(), this.rng);
    this.discard = [];
    for (let k = 0; k < 7; k++) for (const p of this.players) p.hand.push(this.pile.pop());
    // Первая карта — обычная цифра.
    let first = this.pile.findIndex((c) => /\d/.test(c[1]));
    this.top = this.pile.splice(first, 1)[0];
    this.color = this.top[0];
    this.turn = Math.floor(this.rng() * this.players.length);
    this.prompt();
  }

  stop() {
    this.timers.clear();
  }

  idx(id) {
    return this.players.findIndex((p) => p.id === id);
  }

  step(from = this.turn, k = 1) {
    const n = this.players.length;
    return (((from + this.dir * k) % n) + n) % n;
  }

  drawCards(p, n) {
    for (let i = 0; i < n; i++) {
      if (!this.pile.length) {
        if (!this.discard.length) break;
        this.pile = shuffle(this.discard, this.rng);
        this.discard = [];
      }
      p.hand.push(this.pile.pop());
    }
  }

  playable(card) {
    if (this.pending) return (card[1] === 'D' && this.top[1] === 'D') || card[1] === 'F';
    return card[0] === 'w' || card[0] === this.color || card[1] === this.top[1];
  }

  prompt() {
    this.timers.cancel(this.turnTimer);
    this.timers.cancel(this.botTimer);
    this.deadline = null;
    const seq = ++this.seq;
    const p = this.players[this.turn];
    if (p.bot) this.botTimer = this.timers.later(() => seq === this.seq && this.botTurn(), this.ms(800 + this.rng() * 700));
    else if (this.useTimer) {
      this.deadline = Date.now() + this.ms(TURN_MS);
      this.turnTimer = this.timers.later(() => this.autoTurn(), this.ms(TURN_MS));
    }
    this.broadcast();
  }

  autoTurn() {
    const p = this.players[this.turn];
    if (!this.drawn) this.apply(this.turn, { t: 'draw' });
    if (this.players[this.turn] === p && this.drawn) this.apply(this.turn, { t: 'pass' });
  }

  action(pid, a) {
    const i = this.idx(pid);
    if (i < 0 || this.over) return;
    if (a.t === 'uno') return this.sayUno(i);
    if (a.t === 'catch') return this.catchUno(i);
    if (i !== this.turn) return;
    this.apply(i, a);
  }

  apply(i, a) {
    const p = this.players[i];
    if (a.t === 'draw') {
      if (this.drawn) return;
      if (this.pending) {
        this.drawCards(p, this.pending);
        this.event = { t: 'drew', id: p.id, n: this.pending };
        this.pending = 0;
        return this.advance(1);
      }
      this.drawCards(p, 1);
      this.drawn = p.hand[p.hand.length - 1];
      this.event = { t: 'drew', id: p.id, n: 1 };
      // Взятую карту можно сразу сыграть, иначе ход переходит.
      if (!this.drawn || !this.playable(this.drawn)) {
        this.drawn = null;
        return this.advance(1);
      }
      return this.prompt();
    }
    if (a.t === 'pass') {
      if (!this.drawn) return;
      this.drawn = null;
      return this.advance(1);
    }
    if (a.t !== 'play') return;
    const card = a.card;
    const at = p.hand.indexOf(card);
    if (at < 0 || !this.playable(card)) return;
    if (this.drawn && card !== this.drawn) return;
    p.hand.splice(at, 1);
    this.discard.push(this.top);
    this.top = card;
    this.drawn = null;
    this.color = card[0] === 'w' ? (COLORS.includes(a.color) ? a.color : this.bestColor(p)) : card[0];
    this.event = { t: 'played', id: p.id, card, color: this.color };
    if (p.hand.length === 1 && !p.armed) {
      this.vulnerable = p.id;
      this.timers.cancel(this.catchTimer);
      this.catchTimer = this.timers.later(() => {
        this.vulnerable = null;
        this.broadcast();
      }, this.ms(CATCH_MS));
      this.scheduleBotCatch(p);
    }
    p.armed = false;
    if (!p.hand.length) return this.finishRound(p);
    const v = card[1];
    if (v === 'R') {
      this.dir *= -1;
      return this.advance(this.players.length === 2 ? 2 : 1);
    }
    if (v === 'S') return this.advance(2);
    if (v === 'D' || v === 'F') {
      const n = v === 'D' ? 2 : 4;
      if (this.stacking) {
        this.pending += n;
        return this.advance(1);
      }
      const victim = this.players[this.step()];
      this.drawCards(victim, n);
      this.event = { ...this.event, victim: victim.id, n };
      return this.advance(2);
    }
    return this.advance(1);
  }

  advance(k) {
    this.turn = this.step(this.turn, k);
    this.prompt();
  }

  sayUno(i) {
    const p = this.players[i];
    if (this.vulnerable === p.id) {
      this.vulnerable = null;
      this.event = { t: 'uno', id: p.id };
      return this.broadcast();
    }
    if (p.hand.length <= 2) {
      p.armed = true;
      this.event = { t: 'uno', id: p.id };
      this.broadcast();
    }
  }

  catchUno(i) {
    if (!this.vulnerable || this.players[i].id === this.vulnerable) return;
    const v = this.players[this.idx(this.vulnerable)];
    this.drawCards(v, 2);
    this.event = { t: 'caught', id: this.players[i].id, victim: v.id };
    this.vulnerable = null;
    this.broadcast();
  }

  scheduleBotCatch(victim) {
    const catcher = this.players.find((q) => q.bot && q !== victim);
    if (catcher && this.rng() < 0.5) this.timers.later(() => this.catchUno(this.players.indexOf(catcher)), this.ms(1500 + this.rng() * 2000));
  }

  bestColor(p) {
    const count = Object.fromEntries(COLORS.map((c) => [c, 0]));
    for (const c of p.hand) if (c[0] !== 'w') count[c[0]]++;
    return COLORS.slice().sort((a, b) => count[b] - count[a])[0];
  }

  botTurn() {
    if (this.over) return;
    const p = this.players[this.turn];
    if (!p.bot) return;
    if (p.hand.length === 2 && this.rng() < 0.85) p.armed = true;
    const options = p.hand.filter((c) => this.playable(c) && (!this.drawn || c === this.drawn));
    if (!options.length) {
      // Если взятой картой можно сходить, prompt() снова позовёт бота.
      return this.apply(this.turn, { t: this.drawn ? 'pass' : 'draw' });
    }
    const nextSmall = this.players[this.step()].hand.length <= 2;
    const rank = (c) => (c[0] === 'w' ? 3 : 'SRD'.includes(c[1]) ? (nextSmall ? -1 : 1) : 0);
    const card = options.sort((a, b) => rank(a) - rank(b))[0];
    this.apply(this.turn, { t: 'play', card, color: this.bestColor(p) });
  }

  finishRound(winner) {
    this.timers.clear();
    this.over = winner.id;
    this.event = { t: 'won', id: winner.id };
    this.broadcast();
    this.timers.later(() => this.ctx.end(this.finish()), this.ms(2500));
  }

  finish() {
    const list = this.players
      .map((p) => ({ id: p.id, score: p.hand.reduce((s, c) => s + cardPoints(c), 0), cards: p.hand.length }))
      .sort((a, b) => a.score - b.score);
    list.forEach((r, i) => (r.place = i && r.score === list[i - 1].score ? list[i - 1].place : i + 1));
    return { ranking: list.map((r) => ({ id: r.id, place: r.place, score: r.cards, label: String(r.cards) })) };
  }

  publicState() {
    return {
      t: 'state',
      top: this.top,
      color: this.color,
      dir: this.dir,
      turn: this.players[this.turn]?.id,
      pending: this.pending,
      pile: this.pile.length,
      discard: this.discard.length,
      left: this.deadline ? Math.max(0, this.deadline - Date.now()) : null,
      vulnerable: this.vulnerable,
      event: this.event,
      over: this.over,
      players: this.players.map((p) => ({ id: p.id, count: p.hand.length, armed: p.armed })),
    };
  }

  broadcast() {
    this.ctx.broadcast(this.publicState());
    for (const p of this.players) if (!p.bot) this.ctx.sendTo(p.id, { t: 'hand', cards: p.hand.slice(), drawn: this.turn === this.idx(p.id) ? this.drawn : null });
  }

  snapshot(pid) {
    const p = this.players.find((x) => x.id === pid);
    return [this.publicState(), ...(p ? [{ t: 'hand', cards: p.hand.slice(), drawn: this.players[this.turn] === p ? this.drawn : null }] : [])];
  }

  playerLeft(pid) {
    if (this.players[this.turn]?.id === pid && this.useTimer) this.timers.later(() => this.autoTurn(), this.ms(1000));
  }
}
