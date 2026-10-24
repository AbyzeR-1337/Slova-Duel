import { Timers } from '../../core/util.js';
import { makeDeck, shuffled, RANKS_36 } from '../cards/deck.js';

export const rv = (c) => RANKS_36.indexOf(c[0]);
export const beats = (att, def, trump) =>
  (def[1] === att[1] && rv(def) > rv(att)) || (def[1] === trump && att[1] !== trump);

const ATTACK_MS = 30000;
const DEFEND_MS = 30000;
const PASS_MS = 12000;
const TAKE_MS = 7000;
const PAUSE_MS = 1100;

export async function createGame(ctx) {
  return new DurakGame(ctx);
}

// «Дурак подкидной» на 36 карт, 2–6 игроков.
export class DurakGame {
  constructor(ctx, { rng = Math.random, timeScale = 1 } = {}) {
    this.ctx = ctx;
    this.rng = rng;
    this.timeScale = timeScale;
    this.timers = new Timers();
    this.players = ctx.seats.map((s) => ({ id: s.id, bot: !!s.bot, hand: [], out: false, place: null }));
    this.mode = ctx.settings.throw === 'neighbors' ? 'neighbors' : 'all';
    this.finished = 0;
    this.discard = 0;
    this.table = [];
    this.phase = 'deal';
    this.passed = new Set();
    this.event = null;
    // Если человек один, ждать его не нужно — таймеры только мешают.
    this.strict = ctx.humans >= 2;
  }

  ms(x) {
    return Math.round(x * this.timeScale);
  }

  start() {
    this.deck = shuffled(makeDeck(RANKS_36), this.rng);
    for (let r = 0; r < 6; r++) for (const p of this.players) p.hand.push(this.deck.pop());
    // Нижняя карта колоды открыта — это козырь. Если раздали всю колоду
    // (шестеро игроков), козырь — масть последней розданной карты.
    this.trumpCard = this.deck[0] || null;
    this.trump = (this.trumpCard || this.players.at(-1).hand.at(-1))[1];
    let first = -1;
    let low = 99;
    this.players.forEach((p, i) => {
      for (const c of p.hand) {
        if (c[1] === this.trump && rv(c) < low) {
          low = rv(c);
          first = i;
        }
      }
    });
    if (first < 0) first = Math.floor(this.rng() * this.players.length);
    this.attacker = first;
    this.defender = this.next(first);
    this.startBout();
  }

  stop() {
    this.timers.clear();
  }

  idx(id) {
    return this.players.findIndex((p) => p.id === id);
  }

  next(i) {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const j = (i + k) % n;
      if (!this.players[j].out) return j;
    }
    return i;
  }

  prev(i) {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const j = (i - k + n) % n;
      if (!this.players[j].out) return j;
    }
    return i;
  }

  // Кто может подкидывать: все, кроме защищающегося, или только соседи.
  attackers() {
    if (this.mode === 'neighbors') return [...new Set([this.attacker, this.next(this.defender)])].filter((i) => i !== this.defender);
    return this.players.map((_, i) => i).filter((i) => i !== this.defender && !this.players[i].out);
  }

  ranksOnTable() {
    const s = new Set();
    for (const p of this.table) {
      s.add(p.a[0]);
      if (p.d) s.add(p.d[0]);
    }
    return s;
  }

  unbeaten() {
    return this.table.filter((p) => !p.d).length;
  }

  canThrow(i, card) {
    if (this.phase !== 'attack' && this.phase !== 'taking') return false;
    if (i === this.defender || !this.attackers().includes(i)) return false;
    if (!this.players[i].hand.includes(card)) return false;
    if (this.table.length >= this.limit) return false;
    const def = this.players[this.defender];
    if (this.table.length === 0) return i === this.attacker;
    if (!this.ranksOnTable().has(card[0])) return false;
    // Отбиваться должно быть чем: непобитых карт не больше, чем у защитника на руках.
    if (this.phase === 'attack' && this.unbeaten() >= def.hand.length) return false;
    return true;
  }

  canThrowAny(i) {
    return this.players[i].hand.some((c) => this.canThrow(i, c));
  }

  startBout() {
    this.table = [];
    this.passed = new Set();
    this.phase = 'attack';
    this.limit = Math.min(6, this.players[this.defender].hand.length);
    this.check();
  }

  action(pid, a) {
    const i = this.idx(pid);
    if (i < 0 || this.players[i].out) return;
    this.apply(i, a || {});
  }

  apply(i, a) {
    const p = this.players[i];
    switch (a.t) {
      case 'attack': {
        if (!this.canThrow(i, a.card)) return false;
        p.hand.splice(p.hand.indexOf(a.card), 1);
        this.table.push({ a: a.card, d: null, by: p.id });
        this.passed.clear();
        this.event = { t: 'attack', id: p.id };
        break;
      }
      case 'defend': {
        if (this.phase !== 'attack' || i !== this.defender || !p.hand.includes(a.card)) return false;
        const pair = this.table[a.target];
        if (!pair || pair.d || !beats(pair.a, a.card, this.trump)) return false;
        p.hand.splice(p.hand.indexOf(a.card), 1);
        pair.d = a.card;
        this.event = { t: 'defend', id: p.id };
        break;
      }
      case 'take':
        if (this.phase !== 'attack' || i !== this.defender || !this.unbeaten()) return false;
        this.phase = 'taking';
        this.passed.clear();
        this.event = { t: 'take', id: p.id };
        break;
      case 'pass':
        if (i === this.defender || !this.table.length || !this.attackers().includes(i)) return false;
        this.passed.add(i);
        break;
      default:
        return false;
    }
    this.check();
    return true;
  }

  // Смотрим, чем закончился ход, и решаем, кого ждём дальше.
  check() {
    this.timers.cancel(this.waitTimer);
    this.timers.cancel(this.botTimer);
    this.deadline = null;
    if (this.phase !== 'attack' && this.phase !== 'taking') return;
    const def = this.players[this.defender];
    const allPassed = this.attackers().every((j) => this.passed.has(j) || !this.canThrowAny(j));
    let wait;
    if (this.table.length === 0) {
      wait = { ms: this.strict ? ATTACK_MS : 0, fn: () => this.autoOpen() };
    } else if (this.phase === 'attack') {
      const allBeaten = this.unbeaten() === 0;
      if (allBeaten && (allPassed || def.hand.length === 0 || this.table.length >= this.limit)) return this.endBout(true);
      if (!allBeaten) wait = { ms: this.strict ? DEFEND_MS : 0, fn: () => this.apply(this.defender, { t: 'take' }) };
      else wait = { ms: PASS_MS, fn: () => this.passAll() };
    } else {
      if (allPassed || this.table.length >= this.limit) return this.endBout(false);
      wait = { ms: TAKE_MS, fn: () => this.endBout(false) };
    }
    if (wait.ms) {
      this.deadline = Date.now() + this.ms(wait.ms);
      this.waitTimer = this.timers.later(wait.fn, this.ms(wait.ms));
    }
    this.broadcast();
    this.scheduleBots();
  }

  autoOpen() {
    const p = this.players[this.attacker];
    const card = p.hand.slice().sort((a, b) => this.cost(a) - this.cost(b))[0];
    if (card) this.apply(this.attacker, { t: 'attack', card });
  }

  passAll() {
    for (const j of this.attackers()) this.passed.add(j);
    this.check();
  }

  endBout(beaten) {
    this.timers.cancel(this.waitTimer);
    this.timers.cancel(this.botTimer);
    const cards = this.table.flatMap((p) => (p.d ? [p.a, p.d] : [p.a]));
    const def = this.players[this.defender];
    let nextAttacker;
    if (beaten) {
      this.discard += cards.length;
      nextAttacker = this.defender;
      this.event = { t: 'beaten', id: def.id };
    } else {
      def.hand.push(...cards);
      nextAttacker = this.next(this.defender);
      this.event = { t: 'took', id: def.id, n: cards.length };
    }
    this.table = [];
    this.phase = 'pause';
    // Добор: сначала заходящий, потом остальные по кругу, защитник последним.
    const order = [];
    let j = this.attacker;
    do {
      if (j !== this.defender) order.push(j);
      j = this.next(j);
    } while (j !== this.attacker);
    order.push(this.defender);
    for (const k of order) {
      const p = this.players[k];
      while (p.hand.length < 6 && this.deck.length) p.hand.push(this.deck.pop());
    }
    if (!this.deck.length) {
      for (const p of this.players) {
        if (!p.out && p.hand.length === 0) {
          p.out = true;
          p.place = ++this.finished;
        }
      }
    }
    const left = this.players.filter((p) => !p.out);
    this.broadcast();
    if (left.length <= 1) return this.gameOver(left[0] || null);
    this.attacker = this.players[nextAttacker].out ? this.next(nextAttacker) : nextAttacker;
    this.defender = this.next(this.attacker);
    this.timers.later(() => this.startBout(), this.ms(PAUSE_MS));
  }

  gameOver(durak) {
    this.phase = 'over';
    this.durak = durak?.id ?? null;
    if (durak) durak.place = this.players.length;
    this.broadcast();
    this.timers.later(() => this.ctx.end(this.finish()), this.ms(1800));
  }

  finish() {
    const ranked = this.players.slice().sort((a, b) => (a.place ?? 50 + a.hand.length) - (b.place ?? 50 + b.hand.length));
    return {
      ranking: ranked.map((p, i) => ({
        id: p.id,
        place: p.id === this.durak ? ranked.length : i + 1,
        score: p.hand.length,
        label: p.id === this.durak ? 'durak' : p.place ? 'out' : String(p.hand.length),
      })),
      extra: { durak: this.durak ?? null },
    };
  }

  /* ---------- боты ---------- */

  // Чем дешевле карта, тем охотнее бот с ней расстаётся. Козыри — дорогие.
  cost(c) {
    return rv(c) + (c[1] === this.trump ? 10 : 0);
  }

  botMove(i) {
    const p = this.players[i];
    if (!p.bot || p.out) return null;
    const cheap = (cards) => cards.slice().sort((a, b) => this.cost(a) - this.cost(b));
    if (i === this.defender && this.phase === 'attack' && this.unbeaten()) {
      const target = this.table.findIndex((x) => !x.d);
      const att = this.table[target].a;
      const options = cheap(p.hand.filter((c) => beats(att, c, this.trump)));
      // Не тратим старшие козыри в начале игры — лучше взять.
      const best = options[0];
      if (!best || (this.deck.length > 8 && best[1] === this.trump && rv(best) >= 6 && this.table.length <= 2)) return { t: 'take' };
      return { t: 'defend', card: best, target };
    }
    if (i === this.defender) return null;
    if (!this.attackers().includes(i) || this.phase === 'pause') return null;
    if (this.table.length === 0) return i === this.attacker ? { t: 'attack', card: cheap(p.hand)[0] } : null;
    if (this.passed.has(i)) return null;
    const options = cheap(p.hand.filter((c) => this.canThrow(i, c)));
    const card = options[0];
    if (card && (card[1] !== this.trump || this.deck.length === 0)) return { t: 'attack', card };
    if (this.phase === 'taking' || this.unbeaten() === 0) return { t: 'pass' };
    return null;
  }

  scheduleBots() {
    const moves = this.players.map((_, i) => i).filter((i) => this.botMove(i));
    if (!moves.length) return;
    this.botTimer = this.timers.later(() => {
      for (const i of moves) {
        const m = this.botMove(i);
        if (m && this.apply(i, m)) return;
      }
    }, this.ms(650 + this.rng() * 600));
  }

  /* ---------- сообщения ---------- */

  publicState() {
    return {
      t: 'state',
      phase: this.phase,
      trump: this.trump,
      trumpCard: this.deck.length ? this.trumpCard : null,
      deck: this.deck.length,
      discard: this.discard,
      table: this.table.map((p) => ({ ...p })),
      limit: this.limit,
      attacker: this.players[this.attacker]?.id,
      defender: this.players[this.defender]?.id,
      throwers: this.attackers().map((i) => this.players[i].id),
      passed: [...this.passed].map((i) => this.players[i].id),
      left: this.deadline ? Math.max(0, this.deadline - Date.now()) : null,
      durak: this.durak ?? null,
      event: this.event,
      players: this.players.map((p) => ({ id: p.id, count: p.hand.length, out: p.out, place: p.place })),
    };
  }

  broadcast() {
    this.ctx.broadcast(this.publicState());
    for (const p of this.players) if (!p.bot) this.ctx.sendTo(p.id, { t: 'hand', cards: p.hand.slice() });
  }

  snapshot(pid) {
    const out = [this.publicState()];
    const p = this.players.find((x) => x.id === pid);
    if (p) out.push({ t: 'hand', cards: p.hand.slice() });
    return out;
  }
}
