import { Timers, shuffle } from '../../core/util.js';

// «Русская рулетка» в духе Buckshot Roulette. В ружьё заряжают известное число
// боевых (L) и холостых (B) патронов в неизвестном порядке. В свой ход можно
// использовать предметы и выстрелить в себя или в соперника. Холостой в себя —
// ход остаётся у тебя. Последний, у кого остались жизни, побеждает.
//
// Позиции патронов считаются от начала зарядки: текущий патрон — fired.length.

export const ITEMS = ['glass', 'soda', 'cuffs', 'saw', 'medkit', 'phone', 'invert'];
const TURN_MS = 30000;
const MAX_ITEMS = 8;

export async function createGame(ctx) {
  return new RouletteGame(ctx);
}

export class RouletteGame {
  constructor(ctx, { rng = Math.random, timeScale = 1 } = {}) {
    this.ctx = ctx;
    this.rng = rng;
    this.timeScale = timeScale;
    this.timers = new Timers();
    const hp = Number(ctx.settings.hp) || 4;
    this.items = ctx.settings.items !== 'off';
    this.players = ctx.seats.map((s) => ({ id: s.id, bot: !!s.bot, hp, maxHp: hp, items: [], out: false, cuffed: false, outAt: 0 }));
    this.turn = 0;
    this.saw = false;
    this.load = 0;
    this.shells = [];
    this.fired = [];
    this.log = [];
    this.ev = 0;
    this.outCount = 0;
    this.useTimer = ctx.humans >= 2;
    this.known = new Map(); // что игрок подсмотрел: id → {позиция: 'L'|'B'}
    this.seq = 0;
  }

  ms(x) {
    return Math.round(x * this.timeScale);
  }

  start() {
    this.turn = Math.floor(this.rng() * this.players.length);
    this.reload();
    this.prompt();
  }

  stop() {
    this.timers.clear();
  }

  alive() {
    return this.players.filter((p) => !p.out);
  }

  get pos() {
    return this.fired.length;
  }

  reload() {
    this.load++;
    const total = 2 + Math.floor(this.rng() * 7); // 2–8 патронов
    const live = Math.max(1, Math.min(total - 1, Math.round(total * (0.3 + this.rng() * 0.35))));
    this.shells = shuffle([...Array(live).fill('L'), ...Array(total - live).fill('B')], this.rng);
    this.loadInfo = { live, blank: total - live };
    this.fired = [];
    this.known.clear();
    let give = 0;
    if (this.items) {
      give = this.load === 1 ? 2 : 1 + Math.floor(this.rng() * 3);
      for (const p of this.alive()) {
        for (let k = 0; k < give && p.items.length < MAX_ITEMS; k++) p.items.push(ITEMS[Math.floor(this.rng() * ITEMS.length)]);
      }
    }
    this.event({ t: 'load', live, blank: total - live, give });
  }

  event(e) {
    e.k = ++this.ev;
    this.log.push(e);
    if (this.log.length > 30) this.log.shift();
  }

  next() {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const j = (this.turn + k) % n;
      const p = this.players[j];
      if (p.out) continue;
      if (p.cuffed && this.alive().length > 1) {
        p.cuffed = false;
        this.event({ t: 'skip', id: p.id });
        continue;
      }
      this.turn = j;
      return;
    }
  }

  prompt() {
    this.timers.cancel(this.turnTimer);
    this.timers.cancel(this.botTimer);
    this.deadline = null;
    const p = this.players[this.turn];
    const seq = ++this.seq;
    if (p.bot) this.botTimer = this.timers.later(() => seq === this.seq && this.botStep(), this.ms(1200 + this.rng() * 900));
    else if (this.useTimer) {
      this.deadline = Date.now() + this.ms(TURN_MS);
      this.turnTimer = this.timers.later(() => {
        if (seq !== this.seq) return;
        const target = this.rng() < 0.5 ? p.id : this.randomOpponent(p).id;
        this.apply(this.turn, { t: 'shoot', target });
      }, this.ms(TURN_MS));
    }
    this.broadcast();
  }

  randomOpponent(p) {
    const opp = this.alive().filter((q) => q !== p);
    return opp[Math.floor(this.rng() * opp.length)];
  }

  action(pid, a) {
    if (this.over) return;
    const i = this.players.findIndex((p) => p.id === pid);
    if (i !== this.turn) return;
    this.apply(i, a || {});
  }

  apply(i, a) {
    const p = this.players[i];
    if (a.t === 'use') return this.useItem(p, a);
    if (a.t !== 'shoot') return;
    const target = this.players.find((q) => q.id === a.target && !q.out);
    if (!target) return;
    const shell = this.shells.shift();
    this.fired.push(shell);
    const dmg = this.saw ? 2 : 1;
    this.saw = false;
    const self = target === p;
    if (shell === 'L') {
      target.hp = Math.max(0, target.hp - dmg);
      this.event({ t: 'shot', id: p.id, target: target.id, shell, dmg });
      if (!target.hp) {
        target.out = true;
        target.cuffed = false;
        target.outAt = ++this.outCount;
        target.items = [];
        this.event({ t: 'out', id: target.id });
      }
    } else {
      this.event({ t: 'shot', id: p.id, target: target.id, shell });
    }
    if (this.alive().length <= 1) return this.end();
    // Холостой в себя — ход остаётся. Иначе ход переходит.
    const keep = self && shell === 'B';
    if (!this.shells.length) this.reload();
    if (!keep || p.out) this.next();
    this.prompt();
  }

  learn(p, pos, shell) {
    const k = this.known.get(p.id) || {};
    k[pos] = shell;
    this.known.set(p.id, k);
  }

  useItem(p, a) {
    const at = p.items.indexOf(a.item);
    if (at < 0) return;
    const ev = { t: 'item', id: p.id, item: a.item };
    switch (a.item) {
      case 'glass':
        this.learn(p, this.pos, this.shells[0]);
        break;
      case 'soda': {
        const shell = this.shells.shift();
        this.fired.push(shell);
        ev.shell = shell;
        break;
      }
      case 'cuffs': {
        if (this.alive().some((q) => q.cuffed)) return;
        const target = this.players.find((q) => q.id === a.target && !q.out && q !== p) || this.randomOpponent(p);
        target.cuffed = true;
        ev.target = target.id;
        break;
      }
      case 'saw':
        if (this.saw) return;
        this.saw = true;
        break;
      case 'medkit':
        if (p.hp >= p.maxHp) return;
        p.hp++;
        break;
      case 'phone': {
        if (this.shells.length < 2) return;
        const idx = 1 + Math.floor(this.rng() * (this.shells.length - 1));
        this.learn(p, this.pos + idx, this.shells[idx]);
        break;
      }
      case 'invert':
        this.shells[0] = this.shells[0] === 'L' ? 'B' : 'L';
        // Кто знал этот патрон — узнаёт и новый (видно, что инвертор сработал).
        for (const k of this.known.values()) if (k[this.pos]) k[this.pos] = this.shells[0];
        break;
      default:
        return;
    }
    p.items.splice(at, 1);
    this.event(ev);
    if (!this.shells.length) this.reload();
    this.prompt();
  }

  // Вероятность, что текущий патрон боевой, по тому, что знает игрок.
  chance(p) {
    const k = this.known.get(p.id) || {};
    if (k[this.pos]) return k[this.pos] === 'L' ? 1 : 0;
    let live = this.loadInfo.live - this.fired.filter((s) => s === 'L').length;
    let rest = this.shells.length;
    for (const [pos, s] of Object.entries(k)) {
      if (Number(pos) <= this.pos) continue;
      rest--;
      if (s === 'L') live--;
    }
    return rest > 0 ? Math.max(0, Math.min(1, live / rest)) : 0;
  }

  botStep() {
    if (this.over) return;
    const p = this.players[this.turn];
    if (!p.bot || p.out) return;
    const pLive = this.chance(p);
    const has = (it) => p.items.includes(it);
    const opp = this.alive()
      .filter((q) => q !== p)
      .sort((a, b) => a.hp - b.hp)[0];
    if (has('medkit') && p.hp < p.maxHp) return this.useItem(p, { item: 'medkit' });
    if (pLive > 0 && pLive < 1 && has('glass')) return this.useItem(p, { item: 'glass' });
    if (pLive > 0 && pLive < 1 && this.shells.length > 2 && has('phone') && this.rng() < 0.5) return this.useItem(p, { item: 'phone' });
    if (pLive === 0 && has('invert')) return this.useItem(p, { item: 'invert' });
    if (has('cuffs') && !this.alive().some((q) => q.cuffed) && pLive >= 0.5) return this.useItem(p, { item: 'cuffs', target: opp.id });
    if (pLive === 1 && has('saw') && !this.saw && opp.hp > 1) return this.useItem(p, { item: 'saw' });
    if (pLive > 0.3 && pLive < 0.7 && has('soda') && this.rng() < 0.35) return this.useItem(p, { item: 'soda' });
    const shootSelf = pLive < 0.5 || (pLive === 0.5 && this.rng() < 0.35);
    this.apply(this.turn, { t: 'shoot', target: shootSelf && !this.saw ? p.id : opp.id });
  }

  end() {
    this.timers.clear();
    this.over = true;
    const winner = this.alive()[0];
    this.event({ t: 'won', id: winner?.id });
    this.broadcast();
    this.timers.later(() => this.ctx.end(this.finish()), this.ms(3000));
  }

  finish() {
    const ranked = this.players.slice().sort((a, b) => (a.out !== b.out ? (a.out ? 1 : -1) : a.out ? b.outAt - a.outAt : b.hp - a.hp));
    return { ranking: ranked.map((p, i) => ({ id: p.id, place: i + 1, score: p.hp, label: p.out ? '💀' : '❤'.repeat(Math.min(p.hp, 6)) })) };
  }

  publicState() {
    return {
      t: 'state',
      load: this.load,
      loaded: this.loadInfo,
      shells: this.shells.length,
      fired: this.fired.slice(),
      turn: this.players[this.turn]?.id,
      saw: this.saw,
      left: this.deadline ? Math.max(0, this.deadline - Date.now()) : null,
      over: !!this.over,
      log: this.log.slice(-8),
      players: this.players.map((p) => ({ id: p.id, hp: p.hp, maxHp: p.maxHp, items: p.items.slice(), out: p.out, cuffed: p.cuffed })),
    };
  }

  privateState(p) {
    return { t: 'known', load: this.load, known: { ...(this.known.get(p.id) || {}) } };
  }

  broadcast() {
    this.ctx.broadcast(this.publicState());
    for (const p of this.players) if (!p.bot) this.ctx.sendTo(p.id, this.privateState(p));
  }

  snapshot(pid) {
    const p = this.players.find((x) => x.id === pid);
    return [this.publicState(), ...(p ? [this.privateState(p)] : [])];
  }

  playerLeft(pid) {
    if (this.players[this.turn]?.id === pid && this.useTimer) {
      const seq = this.seq;
      this.timers.later(() => seq === this.seq && this.apply(this.turn, { t: 'shoot', target: pid }), this.ms(1500));
    }
  }
}
