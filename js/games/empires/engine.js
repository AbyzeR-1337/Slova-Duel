import { Timers } from '../../core/util.js';
import { generateWorld, mulberry32 } from './world.js';
import { Sim, UNIT_TYPES, TECHS } from './sim.js';

// «Империи»: каждый игрок выбирает страну в сгенерированном мире, дальше —
// реальное время: день за днём копится золото, набираются полки, армии
// идут, сражаются и осаждают провинции. Остальными странами правит ИИ.
// Хозяин комнаты может поставить паузу и менять скорость.

const PICK_MS = 30000;
export const SPEED_MS = [0, 900, 600, 350]; // 0 — пауза
const SPEED_OF = { slow: 1, normal: 2, fast: 3 };
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
    this.speed = SPEED_OF[st.speed] || 2;
    this.goal = (Number(st.goal) || 50) / 100;
    this.limit = (Number(st.time) || 20) * 60000;
    this.seats = ctx.seats.map((s) => ({ id: s.id, bot: !!s.bot, c: null, fell: 0 }));
    this.phase = 'pick';
    this.pending = { ev: [] };
    this.ticks = 0;
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
    this.left = this.ms(this.limit);
    this.lastStep = Date.now();
    this.broadcastFull();
    this.loop();
  }

  loop() {
    this.timers.cancel(this.loopTimer);
    if (this.phase !== 'play' || !this.speed) return;
    this.loopTimer = this.timers.later(() => {
      if (this.phase !== 'play') return;
      this.step();
      if (this.phase === 'play') this.loop();
    }, this.ms(SPEED_MS[this.speed]));
  }

  // Время партии идёт, только пока игра не на паузе.
  spend() {
    const now = Date.now();
    if (this.speed) this.left -= now - this.lastStep;
    this.lastStep = now;
  }

  step() {
    const sim = this.sim;
    this.spend();
    sim.tick();
    this.ticks++;
    this.collect();
    for (const s of this.seats) {
      if (s.c == null) continue;
      const alive = sim.countries[s.c].alive;
      if (!s.fell && !alive) s.fell = sim.day;
      else if (s.fell && alive) s.fell = 0; // восстание вернуло страну
    }
    const dom = sim.countries.find((c) => c.alive && sim.realm(c.id) >= sim.landCount * this.goal);
    if (dom) return this.end('domination', dom.id);
    if (this.seats.every((s) => s.c == null || s.fell)) return this.end('fallen');
    if (this.left <= 0) return this.end('time');
    if (this.ticks % (SPEED_MS[this.speed] >= 500 ? 1 : 2) === 0) this.flush();
  }

  // Изменения копятся между рассылками, чтобы не терять события.
  collect() {
    const own = this.sim.flushChanges();
    if (own.length) this.pending.own = [...(this.pending.own || []), ...own];
    for (const e of this.sim.events) {
      this.pending.ev.push(e);
      // Событие страны игрока — лично ему, с выбором.
      if (e.t === 'event') {
        const s = this.seats.find((x) => x.c === e.c && !x.bot);
        if (s) this.ctx.sendTo(s.id, { t: 'event', id: e.id, type: e.type, hex: e.hex ?? null });
      }
    }
    this.sim.events = [];
  }

  flush() {
    const sim = this.sim;
    const msg = {
      t: 'tick',
      day: sim.day,
      left: Math.max(0, this.left),
      speed: this.speed,
      armies: sim.armyList(),
      cs: sim.countryList(),
      sieges: sim.siegeList(),
    };
    if (this.pending.own) msg.own = this.pending.own;
    if (this.pending.ev.length) msg.ev = this.pending.ev.filter((e) => e.t !== 'event' && e.t !== 'decided');
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
    if (a.t === 'speed') {
      // Скоростью управляет хозяин комнаты.
      const v = Number(a.v);
      if (pid !== this.ctx.hostId || this.phase !== 'play' || !(v >= 0 && v <= 3)) return;
      this.spend();
      this.speed = v;
      this.loop();
      this.collect();
      return this.flush();
    }
    const c = this.myCountry(pid);
    if (c == null) return;
    const sim = this.sim;
    const n = (x) => Number(x);
    let ok = true;
    switch (a.t) {
      case 'recruit':
        ok = sim.recruit(c, a.hex == null ? null : n(a.hex), UNIT_TYPES.includes(a.unit) ? a.unit : 'inf');
        break;
      case 'move':
        ok = sim.order(c, n(a.army), n(a.to));
        break;
      case 'stop':
        ok = sim.stop(c, n(a.army));
        break;
      case 'split':
        ok = !!sim.split(c, n(a.army));
        break;
      case 'merge':
        ok = sim.merge(c, n(a.army));
        break;
      case 'build':
        ok = sim.build(c, n(a.hex), a.kind);
        break;
      case 'invest':
        ok = sim.build(c, n(a.hex), 'dev');
        break;
      case 'research':
        ok = TECHS.includes(a.tech) && sim.research(c, a.tech);
        break;
      case 'war':
        ok = sim.declareWar(c, n(a.c));
        break;
      case 'peace':
      case 'tribute':
      case 'vassal':
      case 'ally':
        ok = sim.propose(a.t, c, n(a.c)) != null;
        break;
      case 'unally':
        ok = sim.breakAlliance(c, n(a.c));
        break;
      case 'release':
        ok = sim.release(c, n(a.c));
        break;
      case 'integrate':
        ok = sim.integrate(c, n(a.c));
        break;
      case 'answer':
        ok = sim.answer(c, n(a.id), !!a.yes);
        break;
      case 'decide':
        ok = sim.decide(c, n(a.id), n(a.choice));
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
    this.sim.snapshotHistory();
    this.result = { reason, winner };
    this.broadcastFull();
    this.timers.later(() => this.ctx.end(this.finish()), this.ms(8000));
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

  // История размеров для графика в конце: страны игроков и самые большие.
  chart() {
    const h = this.sim.history;
    const ids = new Set(this.seats.filter((s) => s.c != null).map((s) => s.c));
    const peak = this.sim.countries.map((c) => [c.id, Math.max(...h.map((row) => row[c.id]))]).sort((a, b) => b[1] - a[1]);
    for (const [id] of peak.slice(0, 6)) ids.add(id);
    return { ids: [...ids], rows: h.map((row) => [...ids].map((id) => row[id])) };
  }

  worldMsg() {
    const w = this.world;
    return {
      t: 'world',
      w: w.w,
      h: w.h,
      terrain: w.terrain.join(''),
      river: w.river.join(''),
      rivers: w.rivers,
      countries: w.countries.map((c) => ({ name: c.name, color: c.color })),
    };
  }

  fullState(pid) {
    const sim = this.sim;
    const s = pid ? this.seat(pid) : null;
    return {
      t: 'full',
      phase: this.phase,
      day: sim.day,
      left: this.phase === 'pick' ? Math.max(0, this.deadline - Date.now()) : Math.max(0, this.left ?? this.limit),
      speed: this.speed,
      goal: this.goal,
      provinces: Array.from({ length: sim.n }, (_, h) => (sim.terrain[h] ? sim.provinceState(h) : null)).filter(Boolean),
      picks: Object.fromEntries(this.seats.filter((x) => x.c != null).map((x) => [x.id, x.c])),
      armies: sim.armyList(),
      cs: sim.countryList(),
      sieges: sim.siegeList(),
      dip: sim.diplomacy(),
      result: this.result || null,
      chart: this.phase === 'over' ? this.chart() : null,
      events: s && s.c != null ? sim.pending.filter((e) => e.c === s.c).map((e) => ({ id: e.id, type: e.type, hex: e.hex ?? null })) : [],
    };
  }

  broadcastFull() {
    this.ctx.broadcast(this.fullState());
    for (const s of this.seats) if (!s.bot && s.c != null) for (const e of this.sim.pending.filter((x) => x.c === s.c)) this.ctx.sendTo(s.id, { t: 'event', id: e.id, type: e.type, hex: e.hex ?? null });
  }

  snapshot(pid) {
    return [this.worldMsg(), this.fullState(pid)];
  }

  playerLeft() {
    if (this.phase === 'pick' && this.seats.every((x) => x.c != null || (!x.bot && !this.ctx.isOnline(x.id)))) {
      this.timers.cancel(this.pickTimer);
      this.pickTimer = this.timers.later(() => this.beginPlay(), this.ms(2500));
    }
  }
}
