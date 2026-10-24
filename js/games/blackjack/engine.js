import { Timers } from '../../core/util.js';
import { makeDeck, shuffled } from '../cards/deck.js';

const BET_MS = 15000;
const PLAY_MS = 25000;
const DEALER_STEP_MS = 700;
const SETTLE_MS = 4000;

export function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const r = c[0];
    if (r === 'A') {
      aces++;
      total += 11;
    } else total += 'TJQK'.includes(r) ? 10 : Number(r);
  }
  while (total > 21 && aces) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

const isBJ = (cards) => cards.length === 2 && handValue(cards).total === 21;

export async function createGame(ctx) {
  return new BlackjackGame(ctx);
}

// «21» (блэкджек) против дилера. Все игроки ходят одновременно —
// так игра остаётся быстрой даже за большим столом.
export class BlackjackGame {
  constructor(ctx, { rng = Math.random, timeScale = 1 } = {}) {
    this.ctx = ctx;
    this.rng = rng;
    this.timeScale = timeScale;
    this.timers = new Timers();
    const chips = Number(ctx.settings.chips) || 1000;
    this.minBet = Number(ctx.settings.minBet) || 10;
    this.maxRounds = Number(ctx.settings.rounds) || 10;
    this.players = ctx.seats.map((s) => ({ id: s.id, bot: !!s.bot, chips, bet: 0, hand: [], status: 'wait', result: null, delta: 0, out: false }));
    this.round = 0;
    this.dealer = [];
    this.phase = 'idle';
    this.shoe = [];
  }

  ms(x) {
    return Math.round(x * this.timeScale);
  }

  start() {
    this.nextRound();
  }

  stop() {
    this.timers.clear();
  }

  draw() {
    if (this.shoe.length < 30) this.shoe = shuffled(makeDeck(undefined, 4), this.rng);
    return this.shoe.pop();
  }

  alive() {
    return this.players.filter((p) => !p.out);
  }

  nextRound() {
    this.timers.clear();
    for (const p of this.players) if (p.chips <= 0) p.out = true;
    if (!this.alive().length || this.round >= this.maxRounds) {
      this.phase = 'over';
      this.broadcast();
      this.timers.later(() => this.ctx.end(this.finish()), this.ms(1200));
      return;
    }
    this.round++;
    this.phase = 'bet';
    this.dealer = [];
    for (const p of this.players) Object.assign(p, { bet: 0, hand: [], status: p.out ? 'out' : 'betting', result: null, delta: 0 });
    this.deadline = Date.now() + this.ms(BET_MS);
    this.waitTimer = this.timers.later(() => this.autoBets(), this.ms(BET_MS));
    for (const p of this.alive()) {
      if (p.bot) this.timers.later(() => this.botBet(p), this.ms(500 + this.rng() * 1200));
    }
    this.broadcast();
  }

  idx(id) {
    return this.players.findIndex((p) => p.id === id);
  }

  action(pid, a) {
    const p = this.players[this.idx(pid)];
    if (!p || p.out) return;
    this.apply(p, a || {});
  }

  apply(p, a) {
    if (a.t === 'bet') {
      if (this.phase !== 'bet' || p.status !== 'betting') return;
      const amount = Math.max(Math.min(this.minBet, p.chips), Math.min(p.chips, Math.floor(Number(a.amount) || 0)));
      p.bet = amount;
      p.chips -= amount;
      p.status = 'ready';
      if (this.alive().every((q) => q.status === 'ready')) return this.deal();
      return this.broadcast();
    }
    if (this.phase !== 'play' || p.status !== 'playing') return;
    if (a.t === 'hit') {
      p.hand.push(this.draw());
      const v = handValue(p.hand).total;
      if (v > 21) p.status = 'bust';
      else if (v === 21) p.status = 'stand';
    } else if (a.t === 'stand') {
      p.status = 'stand';
    } else if (a.t === 'double') {
      if (p.hand.length !== 2 || p.chips < p.bet) return;
      p.chips -= p.bet;
      p.bet *= 2;
      p.doubled = true;
      p.hand.push(this.draw());
      p.status = handValue(p.hand).total > 21 ? 'bust' : 'stand';
    } else return;
    this.afterMove();
  }

  autoBets() {
    for (const p of this.alive()) if (p.status === 'betting') this.apply(p, { t: 'bet', amount: this.minBet });
  }

  deal() {
    this.timers.cancel(this.waitTimer);
    this.phase = 'play';
    for (const p of this.alive()) {
      p.hand = [this.draw(), this.draw()];
      p.doubled = false;
      p.status = isBJ(p.hand) ? 'blackjack' : 'playing';
    }
    this.dealer = [this.draw(), this.draw()];
    // Дилер подглядывает: если у него блэкджек, раунд заканчивается сразу.
    if ('AT'.includes(this.dealer[0][0]) || 'JQK'.includes(this.dealer[0][0])) {
      if (isBJ(this.dealer)) return this.settle();
    }
    this.deadline = Date.now() + this.ms(PLAY_MS);
    this.waitTimer = this.timers.later(() => {
      for (const p of this.alive()) if (p.status === 'playing') p.status = 'stand';
      this.afterMove();
    }, this.ms(PLAY_MS));
    this.afterMove();
  }

  afterMove() {
    this.timers.cancel(this.botTimer);
    if (this.alive().every((p) => p.status !== 'playing')) {
      this.timers.cancel(this.waitTimer);
      return this.dealerPlay();
    }
    this.broadcast();
    const bot = this.alive().find((p) => p.bot && p.status === 'playing');
    if (bot) this.botTimer = this.timers.later(() => this.botMove(bot), this.ms(600 + this.rng() * 600));
  }

  dealerPlay() {
    this.phase = 'dealer';
    this.deadline = null;
    const needed = this.alive().some((p) => p.status === 'stand');
    const step = () => {
      const v = handValue(this.dealer);
      if (needed && v.total < 17) {
        this.dealer.push(this.draw());
        this.broadcast();
        this.timers.later(step, this.ms(DEALER_STEP_MS));
      } else {
        this.settle();
      }
    };
    this.broadcast();
    this.timers.later(step, this.ms(DEALER_STEP_MS));
  }

  settle() {
    this.timers.cancel(this.waitTimer);
    this.phase = 'settle';
    this.deadline = null;
    const d = handValue(this.dealer).total;
    const dealerBJ = isBJ(this.dealer);
    for (const p of this.alive()) {
      if (!p.hand.length) continue;
      const v = handValue(p.hand).total;
      const bj = isBJ(p.hand) && !p.doubled;
      let pay = 0;
      if (p.status === 'bust') p.result = 'lose';
      else if (bj && dealerBJ) [p.result, pay] = ['push', p.bet];
      else if (bj) [p.result, pay] = ['bj', Math.floor(p.bet * 2.5)];
      else if (dealerBJ) p.result = 'lose';
      else if (d > 21 || v > d) [p.result, pay] = ['win', p.bet * 2];
      else if (v === d) [p.result, pay] = ['push', p.bet];
      else p.result = 'lose';
      p.chips += pay;
      p.delta = pay - p.bet;
      if (p.status === 'playing') p.status = 'stand';
    }
    this.broadcast();
    this.timers.later(() => this.nextRound(), this.ms(SETTLE_MS));
  }

  /* ---------- боты ---------- */

  botBet(p) {
    if (this.phase !== 'bet' || p.status !== 'betting') return;
    const mult = [1, 1, 2, 3, 5][Math.floor(this.rng() * 5)];
    this.apply(p, { t: 'bet', amount: Math.min(p.chips, this.minBet * mult) });
  }

  // Упрощённая «базовая стратегия».
  botMove(p) {
    if (this.phase !== 'play' || p.status !== 'playing') return;
    const { total, soft } = handValue(p.hand);
    const up = handValue([this.dealer[0]]).total;
    let move = 'stand';
    if (soft) move = total <= 17 || (total === 18 && up >= 9) ? 'hit' : 'stand';
    else if (total <= 8) move = 'hit';
    else if (total <= 11) move = p.hand.length === 2 && p.chips >= p.bet && total >= 10 && up <= 9 ? 'double' : 'hit';
    else if (total === 12) move = up >= 4 && up <= 6 ? 'stand' : 'hit';
    else if (total <= 16) move = up <= 6 ? 'stand' : 'hit';
    this.apply(p, { t: move });
  }

  /* ---------- сообщения ---------- */

  publicState() {
    const hidden = this.phase === 'play' || this.phase === 'bet';
    const dealer = hidden && this.dealer.length ? [this.dealer[0], '??'] : this.dealer.slice();
    return {
      t: 'state',
      round: this.round,
      rounds: this.maxRounds,
      phase: this.phase,
      minBet: this.minBet,
      dealer,
      dealerTotal: dealer.includes('??') ? handValue([dealer[0]]).total : handValue(dealer).total,
      left: this.deadline ? Math.max(0, this.deadline - Date.now()) : null,
      players: this.players.map((p) => ({
        id: p.id,
        chips: p.chips,
        bet: p.bet,
        hand: p.hand.slice(),
        total: handValue(p.hand).total,
        status: p.status,
        result: p.result,
        delta: p.delta,
        out: p.out,
      })),
    };
  }

  broadcast() {
    this.ctx.broadcast(this.publicState());
  }

  snapshot() {
    return [this.publicState()];
  }

  playerLeft(pid) {
    const p = this.players[this.idx(pid)];
    if (!p) return;
    if (p.status === 'betting') this.apply(p, { t: 'bet', amount: this.minBet });
    else if (p.status === 'playing') this.apply(p, { t: 'stand' });
  }

  finish() {
    const ranked = this.players.slice().sort((a, b) => b.chips - a.chips);
    let place = 0;
    return {
      ranking: ranked.map((p, i) => {
        if (i === 0 || ranked[i - 1].chips !== p.chips) place = i + 1;
        return { id: p.id, score: p.chips, place, label: String(p.chips) };
      }),
    };
  }
}
