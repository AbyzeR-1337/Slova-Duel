import { Timers } from '../../core/util.js';
import { generateWorld, mulberry32 } from './world.js';
import { Sim } from './sim.js';

// «Империи»: каждый игрок выбирает страну в сгенерированном мире, дальше —
// реальное время: день за днём копится золото, набираются полки, армии
// идут, сражаются и осаждают провинции. Остальными странами правит ИИ.

const PICK_MS = 30000;
const TICK_MS = { slow: 900, normal: 600, fast: 380 };
const AGGR = { calm: 0.5, normal: 1, war: 1.8 };

export async function createGame(ctx) {
  return new EmpiresGame(ctx);
}

export class EmpiresGame {
  constructor(ctx, { rng = Math.random, timeScale = 1 } = {}) {
    this.ctx = ctx;
    this.rng = rng;
    this.timeScale = timeScale;
    this.timers = new Timers();
    const st = ctx.settings;
    this.seed = Math.floor(rng() * 2 ** 31);
    this.world = generateWorld({ seed: this.seed, size: st.map || 'medium', lang: ctx.lang });
    this.sim = new Sim(this.world, { rng: mulberry32(this.seed ^ 0x5bd1e995), aggression: AGGR[st.ai] ?? 1 });
    this.tickMs = TICK_MS[st.speed] || TICK_MS.normal;
    this.every = this.tickMs >= 500 ? 1 : 2; // как часто рассылать состояние
    this.limit = (Number(st.time) || 20) * 60000;
    this.seats = ctx.seats.map((s) => ({ id: s.id, bot: !!s.bot, c: null, fell: 0 }));
    this.phase = 'pick';
    this.pending = { ev: [] };
  }

  ms(x) {
    return Math.round(x * this.timeScale);
  }

  seat(id) {
    return this.seats.find((s) => s.id === id);
  }

  start() {
    this.deadline = Date.now() + this.ms(PICK_MS);
    this.pickTimer = this.timers.later(() => this.beginPlay(), this.ms(PICK_MS));
    this.ctx.broadcast(this.worldMsg());
    this.broadcastFull();
    // Боты выбирают средние по размеру страны.
    for (const s of this.seats) if (s.bot) this.timers.later(() => this.pick(s, this.randomCountry()), this.ms(1500 + this.rng() * 5000));
  }

  stop() {
    this.timers.clear();
  }

  randomCountry() {
    const sizes = this.sim.countries.map((c) => [c.id, this.sim.provinces(c.id).length]).filter(([id]) => !this.seats.some((s) => s.c === id));
    sizes.sort((a, b) => a[1] - b[1]);
    const mid = sizes.slice(Math.floor(sizes.length * 0.25), Math.ceil(sizes.length * 0.8));
    const pool = mid.length ? mid : sizes;
    return pool[Math.floor(this.rng() * pool.length)]?.[0] ?? null;
  }

  pick(s, c) {
    if (this.phase !== 'pick' || c == null || !this.sim.countries[c] || this.seats.some((x) => x.c === c && x !== s)) return;
    s.c = c;
    this.broadcastFull();
    if (this.seats.every((x) => x.c != null || (!x.bot && !this.ctx.isOnline(x.id)))) {
      this.timers.cancel(this.pickTimer);
      this.pickTimer = this.timers.later(() => this.beginPlay(), this.ms(2500));
    }
  }

  beginPlay() {
    if (this.phase !== 'pick') return;
    for (const s of this.seats) if (s.c == null) s.c = this.randomCountry();
    for (const s of this.seats) if (!s.bot && s.c != null) this.sim.countries[s.c].player = s.id;
    this.phase = 'play';
    this.started = Date.now();
    this.deadline = this.started + this.ms(this.limit);
    this.timers.later(() => this.end('time'), this.ms(this.limit));
    this.broadcastFull();
    this.loop();
  }

  loop() {
    this.loopTimer = this.timers.later(() => {
      if (this.phase !== 'play') return;
      this.step();
      if (this.phase === 'play') this.loop();
    }, this.ms(this.tickMs));
  }

  step() {
    const sim = this.sim;
    sim.tick();
    this.collect();
    for (const s of this.seats) if (s.c != null && !s.fell && !sim.countries[s.c].alive) s.fell = sim.day;
    const dom = sim.dominant();
    if (dom != null) return this.end('domination', dom);
    if (this.seats.every((s) => s.c == null || s.fell)) return this.end('fallen');
    if (sim.day % this.every === 0) this.flush();
  }

  // Изменения копятся между рассылками, чтобы не терять события.
  collect() {
    const own = this.sim.flushChanges();
    if (own.length) this.pending.own = [...(this.pending.own || []), ...own];
    if (this.sim.events.length) this.pending.ev.push(...this.sim.events);
    this.sim.events = [];
  }

  flush() {
    const sim = this.sim;
    const msg = {
      t: 'tick',
      day: sim.day,
      left: Math.max(0, this.deadline - Date.now()),
      armies: sim.armyList(),
      cs: sim.countryList(),
      sieges: sim.siegeList(),
    };
    if (this.pending.own) msg.own = this.pending.own;
    if (this.pending.ev.length) msg.ev = this.pending.ev;
    if (sim.dipDirty) {
      msg.dip = sim.diplomacy();
      sim.dipDirty = false;
    }
    this.pending = { ev: [] };
    this.ctx.broadcast(msg);
  }

  myCountry(pid) {
    const s = this.seat(pid);
    if (!s || s.bot || s.c == null || s.fell || this.phase !== 'play') return null;
    return this.sim.countries[s.c].alive ? s.c : null;
  }

  action(pid, a) {
    if (!a || this.phase === 'over') return;
    if (a.t === 'pick') {
      const s = this.seat(pid);
      if (s && !s.bot) this.pick(s, Number(a.c));
      return;
    }
    const c = this.myCountry(pid);
    if (c == null) return;
    const sim = this.sim;
    let ok = true;
    switch (a.t) {
      case 'recruit':
        ok = sim.recruit(c, a.hex == null ? null : Number(a.hex));
        break;
      case 'move':
        ok = sim.order(c, Number(a.army), Number(a.to));
        break;
      case 'split':
        ok = !!sim.split(c, Number(a.army));
        break;
      case 'invest':
        ok = sim.invest(c, Number(a.hex));
        break;
      case 'war':
        ok = sim.declareWar(c, Number(a.c));
        break;
      case 'peace':
      case 'ally':
        ok = sim.propose(a.t, c, Number(a.c)) != null;
        break;
      case 'unally':
        ok = sim.breakAlliance(c, Number(a.c));
        break;
      case 'answer':
        ok = sim.answer(c, Number(a.id), !!a.yes);
        break;
      default:
        return;
    }
    if (!ok) this.ctx.sendTo(pid, { t: 'nope', a: a.t });
    // Ответ на действие игрока — сразу, не дожидаясь следующего дня.
    this.collect();
    this.flush();
  }

  end(reason, winner = null) {
    if (this.phase === 'over') return;
    this.collect();
    this.flush();
    this.phase = 'over';
    this.timers.clear();
    this.result = { reason, winner };
    this.broadcastFull();
    this.timers.later(() => this.ctx.end(this.finish()), this.ms(6000));
  }

  finish() {
    const sim = this.sim;
    const rows = this.seats.map((s) => ({
      s,
      alive: s.c != null && sim.countries[s.c].alive,
      score: s.c != null ? sim.score(s.c) : 0,
      prov: s.c != null ? sim.provinces(s.c).length : 0,
    }));
    rows.sort((a, b) => (a.alive !== b.alive ? b.alive - a.alive : a.alive ? b.score - a.score : b.s.fell - a.s.fell));
    return {
      ranking: rows.map((r, i) => ({ id: r.s.id, place: i + 1, score: Math.round(r.score), label: r.alive ? `${r.prov} 🏳️` : '💀' })),
      extra: { winner: this.result?.winner != null ? sim.countries[this.result.winner].name : null },
    };
  }

  worldMsg() {
    const w = this.world;
    return {
      t: 'world',
      w: w.w,
      h: w.h,
      terrain: w.terrain.join(''),
      countries: w.countries.map((c) => ({ name: c.name, color: c.color })),
    };
  }

  fullState() {
    const sim = this.sim;
    return {
      t: 'full',
      phase: this.phase,
      day: sim.day,
      left: this.deadline ? Math.max(0, this.deadline - Date.now()) : null,
      owner: sim.owner.slice(),
      dev: sim.dev.join(''),
      picks: Object.fromEntries(this.seats.filter((s) => s.c != null).map((s) => [s.id, s.c])),
      armies: sim.armyList(),
      cs: sim.countryList(),
      sieges: sim.siegeList(),
      dip: sim.diplomacy(),
      result: this.result || null,
    };
  }

  broadcastFull() {
    this.ctx.broadcast(this.fullState());
  }

  snapshot() {
    return [this.worldMsg(), this.fullState()];
  }

  playerLeft() {
    if (this.phase === 'pick' && this.seats.every((x) => x.c != null || (!x.bot && !this.ctx.isOnline(x.id)))) {
      this.timers.cancel(this.pickTimer);
      this.pickTimer = this.timers.later(() => this.beginPlay(), this.ms(2500));
    }
  }
}
