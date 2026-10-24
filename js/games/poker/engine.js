import { Timers } from '../../core/util.js';
import { makeDeck, shuffled } from '../cards/deck.js';
import { bestHand } from './eval.js';
import { decide } from './bot.js';

const ACT_MS = 30000;
const SHOW_MS = 5000;
const FOLD_WIN_MS = 2500;
const RUNOUT_MS = 1300;

export async function createGame(ctx) {
  return new PokerGame(ctx);
}

// Техасский холдем без лимита. Ведущий раздаёт карты, следит за ставками,
// делит банк (в том числе побочные банки при олл-ине) и вскрывает карты.
export class PokerGame {
  constructor(ctx, { rng = Math.random, timeScale = 1 } = {}) {
    this.ctx = ctx;
    this.rng = rng;
    this.timeScale = timeScale;
    this.timers = new Timers();
    const chips = Number(ctx.settings.chips) || 1000;
    this.players = ctx.seats.map((s) => ({ id: s.id, bot: !!s.bot, chips, cards: [], bet: 0, total: 0, folded: false, allIn: false, out: false, acted: false, last: null }));
    this.bb = Number(ctx.settings.bb) || 20;
    this.handsLimit = Number(ctx.settings.hands) || 0;
    this.button = -1;
    this.hand = 0;
    this.outCount = 0;
    this.street = 'idle';
    this.board = [];
    this.lastShow = null;
    // Таймер хода нужен, только если за столом больше одного живого человека.
    this.useTimer = ctx.humans >= 2;
  }

  ms(x) {
    return Math.round(x * this.timeScale);
  }

  start() {
    this.nextHand();
  }

  stop() {
    this.timers.clear();
  }

  idx(id) {
    return this.players.findIndex((p) => p.id === id);
  }

  canAct(p) {
    return !p.out && !p.folded && !p.allIn;
  }

  nextFrom(i, pred) {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const j = (i + k + n) % n;
      if (pred(this.players[j])) return j;
    }
    return -1;
  }

  post(i, amount) {
    const p = this.players[i];
    const a = Math.max(0, Math.min(amount, p.chips));
    p.chips -= a;
    p.bet += a;
    p.total += a;
    if (p.chips === 0) p.allIn = true;
    return a;
  }

  nextHand() {
    this.timers.clear();
    for (const p of this.players) {
      if (!p.out && p.chips <= 0) {
        p.out = true;
        p.outAt = ++this.outCount;
      }
    }
    const alive = this.players.filter((p) => !p.out);
    if (alive.length <= 1 || (this.handsLimit && this.hand >= this.handsLimit)) {
      this.street = 'over';
      this.broadcastState();
      this.timers.later(() => this.ctx.end(this.finish()), this.ms(1500));
      return;
    }
    this.hand++;
    // Без лимита раздач блайнды понемногу растут, чтобы игра не тянулась вечно.
    if (!this.handsLimit && this.hand > 1 && (this.hand - 1) % 10 === 0) this.bb = Math.round((this.bb * 1.5) / 10) * 10;
    for (const p of this.players) Object.assign(p, { cards: [], bet: 0, total: 0, folded: p.out, allIn: false, acted: false, last: null });
    this.deck = shuffled(makeDeck(), this.rng);
    this.board = [];
    this.lastShow = null;
    this.button = this.nextFrom(this.button, (p) => !p.out);
    const sbIdx = alive.length === 2 ? this.button : this.nextFrom(this.button, (p) => !p.out);
    const bbIdx = this.nextFrom(sbIdx, (p) => !p.out);
    this.post(sbIdx, Math.floor(this.bb / 2));
    this.post(bbIdx, this.bb);
    this.players[sbIdx].last = 'sb';
    this.players[bbIdx].last = 'bb';
    for (let r = 0; r < 2; r++) {
      let i = this.button;
      for (let k = 0; k < alive.length; k++) {
        i = this.nextFrom(i, (p) => !p.out);
        this.players[i].cards.push(this.deck.pop());
      }
    }
    this.street = 'preflop';
    this.currentBet = this.bb;
    this.minRaise = this.bb;
    for (const p of this.players) if (!p.out) this.ctx.sendTo(p.id, { t: 'hole', hand: this.hand, cards: p.cards });
    this.toAct = this.nextFrom(bbIdx, (p) => this.canAct(p));
    if (this.roundComplete()) return this.nextStreet();
    this.prompt();
  }

  prompt() {
    const p = this.players[this.toAct];
    this.deadline = null;
    if (p.bot) {
      this.timers.later(() => this.botAct(), this.ms(700 + this.rng() * 900));
    } else if (!this.ctx.isOnline?.(p.id) && this.useTimer) {
      this.timers.later(() => this.autoAct(), this.ms(1500));
    } else if (this.useTimer) {
      this.deadline = Date.now() + this.ms(ACT_MS);
      this.actTimer = this.timers.later(() => this.autoAct(), this.ms(ACT_MS));
    }
    this.broadcastState();
  }

  autoAct() {
    const p = this.players[this.toAct];
    this.apply(this.toAct, p.bet >= this.currentBet ? { t: 'check' } : { t: 'fold' });
  }

  botAct() {
    if (!['preflop', 'flop', 'turn', 'river'].includes(this.street)) return;
    const p = this.players[this.toAct];
    const opponents = this.players.filter((q) => q !== p && !q.out && !q.folded).length;
    const a = decide(
      {
        hole: p.cards,
        board: this.board,
        toCall: this.currentBet - p.bet,
        pot: this.pot(),
        chips: p.chips,
        bet: p.bet,
        currentBet: this.currentBet,
        minRaise: this.minRaise,
        bb: this.bb,
        opponents,
      },
      this.rng,
    );
    this.apply(this.toAct, a);
  }

  action(pid, a) {
    const i = this.idx(pid);
    if (i < 0 || i !== this.toAct || !['preflop', 'flop', 'turn', 'river'].includes(this.street)) return;
    this.apply(i, a || {});
  }

  apply(i, a) {
    const p = this.players[i];
    if (!this.canAct(p)) return;
    const toCall = this.currentBet - p.bet;
    switch (a.t) {
      case 'fold':
        p.folded = true;
        p.last = 'fold';
        break;
      case 'check':
        if (toCall > 0) return;
        p.last = 'check';
        break;
      case 'call':
        if (toCall <= 0) {
          p.last = 'check';
          break;
        }
        this.post(i, toCall);
        p.last = p.allIn ? 'allin' : 'call';
        break;
      case 'allin':
      case 'raise': {
        const maxTo = p.bet + p.chips;
        let target = a.t === 'allin' ? maxTo : Math.floor(Number(a.to) || 0);
        if (target >= maxTo) target = maxTo;
        else if (target < this.currentBet + this.minRaise) return;
        if (target <= this.currentBet) {
          // Олл-ин меньше колла — это просто колл на все фишки.
          this.post(i, target - p.bet);
          p.last = 'allin';
          break;
        }
        const wasBet = this.currentBet > 0;
        const raiseBy = target - this.currentBet;
        this.post(i, target - p.bet);
        if (raiseBy >= this.minRaise) this.minRaise = raiseBy;
        this.currentBet = target;
        for (const q of this.players) if (q !== p && this.canAct(q)) q.acted = false;
        p.last = p.allIn ? 'allin' : wasBet ? 'raise' : 'bet';
        break;
      }
      default:
        return;
    }
    p.acted = true;
    this.timers.cancel(this.actTimer);
    this.afterAction();
  }

  pot() {
    return this.players.reduce((s, p) => s + p.total, 0);
  }

  roundComplete() {
    const act = this.players.filter((p) => this.canAct(p));
    if (act.length === 0) return true;
    // Остался один, кто может ставить, и он уже уравнял — ставить не против кого.
    if (act.length === 1 && act[0].bet >= this.currentBet) return true;
    return act.every((p) => p.acted && p.bet === this.currentBet);
  }

  afterAction() {
    const live = this.players.filter((p) => !p.out && !p.folded);
    if (live.length === 1) return this.winUncontested(live[0]);
    if (this.roundComplete()) return this.nextStreet();
    this.toAct = this.nextFrom(this.toAct, (p) => this.canAct(p));
    this.prompt();
  }

  nextStreet() {
    for (const p of this.players) {
      p.bet = 0;
      p.acted = false;
      if (!p.folded && !p.allIn) p.last = null;
    }
    this.currentBet = 0;
    this.minRaise = this.bb;
    if (this.street === 'river') return this.showdown();
    if (this.street === 'preflop') {
      this.board.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
      this.street = 'flop';
    } else if (this.street === 'flop') {
      this.board.push(this.deck.pop());
      this.street = 'turn';
    } else {
      this.board.push(this.deck.pop());
      this.street = 'river';
    }
    if (this.players.filter((p) => this.canAct(p)).length < 2) {
      // Ставить больше некому — докладываем стол с паузами.
      this.toAct = -1;
      this.deadline = null;
      this.broadcastState();
      this.timers.later(() => this.nextStreet(), this.ms(RUNOUT_MS));
      return;
    }
    this.toAct = this.nextFrom(this.button, (p) => this.canAct(p));
    this.prompt();
  }

  // Банки: основной и побочные, по уровням вложений игроков, оставшихся в игре.
  pots() {
    const contenders = this.players.filter((p) => !p.out && !p.folded);
    const levels = [...new Set(contenders.map((p) => p.total))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const lvl of levels) {
      const amount = this.players.reduce((s, p) => s + Math.min(p.total, lvl) - Math.min(p.total, prev), 0);
      if (amount > 0) pots.push({ amount, eligible: contenders.filter((p) => p.total >= lvl) });
      prev = lvl;
    }
    const counted = pots.reduce((s, p) => s + p.amount, 0);
    if (pots.length && counted < this.pot()) pots[pots.length - 1].amount += this.pot() - counted;
    return pots;
  }

  showdown() {
    this.timers.cancel(this.actTimer);
    this.street = 'showdown';
    this.toAct = -1;
    const evals = new Map();
    for (const p of this.players) if (!p.out && !p.folded) evals.set(p, bestHand([...p.cards, ...this.board]));
    const won = new Map();
    const n = this.players.length;
    const order = (p) => (this.players.indexOf(p) - this.button - 1 + n) % n;
    for (const pot of this.pots()) {
      const top = Math.max(...pot.eligible.map((p) => evals.get(p).score));
      const winners = pot.eligible.filter((p) => evals.get(p).score === top).sort((a, b) => order(a) - order(b));
      const share = Math.floor(pot.amount / winners.length);
      let rest = pot.amount - share * winners.length;
      for (const w of winners) won.set(w, (won.get(w) || 0) + share + (rest-- > 0 ? 1 : 0));
    }
    for (const [p, amt] of won) p.chips += amt;
    for (const p of this.players) p.total = 0;
    const hands = {};
    for (const [p, e] of evals) hands[p.id] = { cards: p.cards, cat: e.cat, best: e.best };
    this.lastShow = { t: 'show', hand: this.hand, board: this.board.slice(), hands, wins: [...won].map(([p, amount]) => ({ id: p.id, amount })) };
    this.broadcastState();
    this.ctx.broadcast(this.lastShow);
    this.timers.later(() => this.nextHand(), this.ms(SHOW_MS));
  }

  winUncontested(p) {
    this.timers.cancel(this.actTimer);
    const amount = this.pot();
    p.chips += amount;
    for (const q of this.players) q.total = 0;
    this.street = 'showdown';
    this.toAct = -1;
    this.lastShow = { t: 'show', hand: this.hand, board: this.board.slice(), hands: {}, wins: [{ id: p.id, amount }] };
    this.broadcastState();
    this.ctx.broadcast(this.lastShow);
    this.timers.later(() => this.nextHand(), this.ms(FOLD_WIN_MS));
  }

  publicState() {
    return {
      t: 'state',
      hand: this.hand,
      handsLimit: this.handsLimit,
      street: this.street,
      board: this.board.slice(),
      pot: this.pot(),
      bb: this.bb,
      button: this.players[this.button]?.id ?? null,
      toAct: this.toAct >= 0 ? this.players[this.toAct]?.id ?? null : null,
      left: this.deadline ? Math.max(0, this.deadline - Date.now()) : null,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      players: this.players.map((p) => ({
        id: p.id,
        chips: p.chips,
        bet: p.bet,
        folded: p.folded,
        allIn: p.allIn,
        out: p.out,
        last: p.last,
        cards: p.out ? 0 : p.cards.length,
      })),
    };
  }

  broadcastState() {
    this.ctx.broadcast(this.publicState());
  }

  snapshot(pid) {
    const out = [this.publicState()];
    const p = this.players.find((x) => x.id === pid);
    if (p && p.cards.length) out.push({ t: 'hole', hand: this.hand, cards: p.cards });
    if (this.lastShow && this.street === 'showdown') out.push(this.lastShow);
    return out;
  }

  playerLeft(pid) {
    const i = this.idx(pid);
    if (i === this.toAct && this.useTimer) {
      this.timers.cancel(this.actTimer);
      this.timers.later(() => this.toAct === i && this.autoAct(), this.ms(1000));
    }
  }

  finish() {
    const ranked = this.players.slice().sort((a, b) => {
      if (a.out !== b.out) return a.out ? 1 : -1;
      if (!a.out) return b.chips - a.chips;
      return b.outAt - a.outAt;
    });
    let place = 0;
    return {
      ranking: ranked.map((p, i) => {
        const prev = ranked[i - 1];
        if (!prev || prev.out !== p.out || prev.chips !== p.chips || p.out) place = i + 1;
        return { id: p.id, score: p.chips, place, label: String(p.chips) };
      }),
    };
  }
}
