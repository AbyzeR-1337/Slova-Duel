import { neighbors, hexDist, findPath, MOVE_DAYS, DEFENSE } from './world.js';

// Симуляция «Империй»: один тик — один день. Население и мобилизационный
// резерв, золото, три рода войск, боевой дух и отступление, снабжение и зима,
// осады и крепости, наука, постройки, недовольство и восстания, вассалы,
// коалиции против захватчиков, события и ИИ стран. Сеть — в engine.js.

export const REG = 1000; // солдат в полку
export const UNITS = {
  inf: { cost: 10, atk: 1.0, def: 1.2, speed: 1.0, upkeep: 0.35 },
  cav: { cost: 18, atk: 1.5, def: 0.8, speed: 1.6, upkeep: 0.6 },
  art: { cost: 24, atk: 1.6, def: 0.6, speed: 0.75, upkeep: 0.8 },
};
export const UNIT_TYPES = ['inf', 'cav', 'art'];
export const TECHS = ['eco', 'mil', 'log', 'eng'];
export const MAX_TECH = 5;
export const MAX_DEV = 9;
export const MAX_FORT = 3;
export const MARKET_COST = 40;
export const GRACE_DAYS = 45; // первые полтора месяца ИИ ни на кого не нападает
export const CORE_DAYS = 365; // через год завоёванная провинция становится своей
export const VASSAL_INTEGRATE_DAYS = 365;
const K = 0.07; // доля потерь от силы противника в день
const TRUCE_DAYS = 120;
const OFFER_DAYS = 30;
const EVENT_DAYS = 60; // столько ждём ответа игрока на событие
const TERR_POP = [0, 1.3, 1, 0.9, 0.6, 0.5, 0.5];
const ATTRITION = [0, 0, 0.0004, 0.0004, 0.0012, 0.0014, 0.0012];

export const techCost = (lvl) => Math.round(20 + 20 * lvl ** 1.4);
export const techDays = (lvl) => 40 + 25 * lvl;
export const devCost = (dev) => 10 + dev * 6;
export const fortCost = (lvl) => 25 + 25 * lvl;

export const EVENTS = ['gold', 'plague', 'harvest', 'reform', 'scholar', 'riots', 'volunteers', 'merchants', 'flood', 'festival', 'deserters', 'discovery'];

const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const size = (a) => a.inf + a.cav + a.art;

export class Sim {
  constructor(world, { rng = Math.random, aggression = 1 } = {}) {
    this.rng = rng;
    this.aggression = aggression;
    this.w = world.w;
    this.h = world.h;
    this.n = this.w * this.h;
    this.terrain = world.terrain.slice();
    this.river = world.river ? world.river.slice() : Array(this.n).fill(0);
    this.dev = world.dev.slice();
    this.owner = world.owner.slice();
    this.core = world.owner.slice();
    this.fort = Array(this.n).fill(0);
    this.market = Array(this.n).fill(0);
    this.unrest = Array(this.n).fill(0);
    this.since = Array(this.n).fill(0);
    this.pop = this.terrain.map((t, i) => (t ? this.dev[i] * (6 + rng() * 4) * TERR_POP[t] * (this.river[i] ? 1.2 : 1) : 0));
    this.nb = Array.from({ length: this.n }, (_, i) => neighbors(this.w, this.h, i));
    this.landCount = this.terrain.filter(Boolean).length;
    this.day = 0;
    this.month = 0;
    this.armies = new Map();
    this.nextArmy = 1;
    this.sieges = new Map();
    this.wars = new Map(); // ключ пары → {day, score: {a: n, b: n}}
    this.offers = [];
    this.nextOffer = 1;
    this.pending = []; // события, ждущие решения игроков
    this.nextEventId = 1;
    this.events = [];
    this.changed = new Set();
    this.dipDirty = true;
    this.history = [];
    this.countries = world.countries.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      cap: c.capital,
      gold: 40,
      manpower: 0,
      alive: true,
      player: null,
      aggr: 0.5 + rng(),
      focus: rng() < 0.5 ? 'war' : 'eco',
      allies: new Set(),
      truce: new Map(),
      cooldown: 0,
      tech: { eco: 0, mil: 0, log: 0, eng: 0 },
      research: null,
      scholar: false,
      exhaustion: 0,
      threat: 0,
      overlord: -1,
      vassalSince: 0,
      coalition: -1,
      buff: null,
      nextEvent: 120 + Math.floor(rng() * 240),
      lost: 0,
    }));
    for (const c of this.countries) this.pop[c.cap] *= 1.5;
    for (const c of this.countries) {
      c.manpower = Math.round(this.mpMax(c.id) * 0.6);
      const prov = this.provinces(c.id).length;
      const regs = Math.max(2, Math.round(prov / 4));
      this.addArmy(c.id, c.cap, { inf: Math.ceil(regs * 0.7) * REG, cav: Math.floor(regs * 0.3) * REG, art: 0 });
    }
    this.snapshotHistory();
  }

  /* ---------- справки ---------- */

  provinces(c) {
    const out = [];
    for (let i = 0; i < this.n; i++) if (this.owner[i] === c) out.push(i);
    return out;
  }

  troops(c) {
    let s = 0;
    for (const a of this.armies.values()) if (a.c === c) s += size(a);
    return s;
  }

  devSum(c) {
    let s = 0;
    for (let i = 0; i < this.n; i++) if (this.owner[i] === c) s += this.dev[i];
    return s;
  }

  vassalsOf(c) {
    return this.countries.filter((x) => x.alive && x.overlord === c).map((x) => x.id);
  }

  // Предел резерва: часть населения своих (и меньшая — чужих) провинций.
  mpMax(c) {
    let s = 0;
    for (let i = 0; i < this.n; i++) if (this.owner[i] === c) s += this.pop[i] * (this.core[i] === c ? 80 : 25);
    return Math.round(s);
  }

  upkeep(c) {
    let s = 0;
    for (const a of this.armies.values()) if (a.c === c) for (const u of UNIT_TYPES) s += (a[u] / REG) * UNITS[u].upkeep;
    return s;
  }

  // Доход за месяц до содержания армии и дани.
  grossIncome(c) {
    const ct = this.countries[c];
    let s = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.owner[i] !== c) continue;
      s += this.dev[i] * 0.5 * (this.market[i] ? 1.5 : 1) * (this.core[i] === c ? 1 : 0.5);
    }
    const penalty = 1 - Math.min(0.4, ct.exhaustion * 0.005);
    return (s * (1 + 0.1 * ct.tech.eco) + 4) * penalty;
  }

  // Чистый месячный доход: с данью вассалов и за вычетом армии.
  income(c) {
    const ct = this.countries[c];
    const gross = this.grossIncome(c);
    let net = gross - this.upkeep(c);
    if (ct.overlord >= 0) net -= Math.max(0, gross) * 0.25;
    for (const v of this.vassalsOf(c)) net += Math.max(0, this.grossIncome(v)) * 0.25;
    return net;
  }

  investCost(hex) {
    return devCost(this.dev[hex]);
  }

  atWar(a, b) {
    return a !== b && this.wars.has(key(a, b));
  }

  allied(a, b) {
    return a !== b && a >= 0 && b >= 0 && this.countries[a].allies.has(b);
  }

  // Свои: союзники, сюзерен и вассалы, вассалы общего сюзерена.
  friendly(a, b) {
    if (a === b) return true;
    if (a < 0 || b < 0) return false;
    if (this.allied(a, b)) return true;
    const A = this.countries[a];
    const B = this.countries[b];
    return A.overlord === b || B.overlord === a || (A.overlord >= 0 && A.overlord === B.overlord);
  }

  enemiesOf(c) {
    const out = [];
    for (const k of this.wars.keys()) {
      const [a, b] = k.split('-').map(Number);
      if (a === c) out.push(b);
      else if (b === c) out.push(a);
    }
    return out;
  }

  canEnter(c, hex) {
    if (!this.terrain[hex]) return false;
    const o = this.owner[hex];
    return this.friendly(c, o) || this.atWar(c, o);
  }

  neighborsOf(c) {
    const out = new Set();
    for (let i = 0; i < this.n; i++) {
      if (this.owner[i] !== c) continue;
      for (const j of this.nb[i]) if (this.owner[j] >= 0 && this.owner[j] !== c) out.add(this.owner[j]);
    }
    return [...out];
  }

  armiesAt(hex) {
    const out = [];
    for (const a of this.armies.values()) if (a.hex === hex) out.push(a);
    return out;
  }

  techSum(c) {
    const t = this.countries[c].tech;
    return t.eco + t.mil + t.log + t.eng;
  }

  // Земли страны и половина земель вассалов — для победы по господству.
  realm(c) {
    let k = 0;
    const vs = new Set(this.vassalsOf(c));
    for (let i = 0; i < this.n; i++) if (this.owner[i] === c) k++;
    else if (vs.has(this.owner[i])) k += 0.5;
    return k;
  }

  score(c) {
    let vdev = 0;
    for (const v of this.vassalsOf(c)) vdev += this.devSum(v);
    return this.devSum(c) + vdev * 0.5 + this.troops(c) / 2000 + this.techSum(c) * 2;
  }

  /* ---------- армии ---------- */

  addArmy(c, hex, units, morale = 1) {
    const a = { id: this.nextArmy++, c, hex, inf: units.inf || 0, cav: units.cav || 0, art: units.art || 0, morale, path: [], prog: 0, fighting: false, retreat: false };
    this.armies.set(a.id, a);
    return a;
  }

  speed(a) {
    let s = Infinity;
    for (const u of UNIT_TYPES) if (a[u] > 0) s = Math.min(s, UNITS[u].speed);
    if (s === Infinity) s = 1;
    return s * (1 + 0.08 * this.countries[a.c].tech.log);
  }

  moveCost(hex) {
    return MOVE_DAYS[this.terrain[hex]] + (this.river[hex] ? 1 : 0);
  }

  power(a) {
    const ct = this.countries[a.c];
    const raw = (a.inf * UNITS.inf.atk + a.cav * UNITS.cav.atk + a.art * UNITS.art.atk) / REG;
    const buff = ct.buff && ct.buff.until > this.day ? ct.buff.atk : 1;
    return raw * (1 + 0.08 * ct.tech.mil) * (0.4 + 0.6 * a.morale) * buff;
  }

  // Насколько армия уязвима: пехота держит удар лучше конницы и пушек.
  fragility(a) {
    const s = size(a) || 1;
    return (a.inf / UNITS.inf.def + a.cav / UNITS.cav.def + a.art / UNITS.art.def) / s;
  }

  maxMorale(c) {
    return 1 - Math.min(0.3, this.countries[c].exhaustion * 0.004);
  }

  path(c, from, to) {
    return findPath(
      this.nb,
      from,
      to,
      (x) => this.canEnter(c, x),
      (x) => this.moveCost(x),
    );
  }

  // Ближайшая (по шагам) клетка, подходящая под условие.
  find(c, from, pred, maxSteps = 60) {
    const prev = new Map([[from, -1]]);
    let frontier = [from];
    for (let step = 0; step < maxSteps && frontier.length; step++) {
      const next = [];
      for (const x of frontier) {
        for (const y of this.nb[x]) {
          if (prev.has(y) || !this.canEnter(c, y)) continue;
          prev.set(y, x);
          if (pred(y)) {
            const out = [];
            for (let z = y; z !== from; z = prev.get(z)) out.push(z);
            return out.reverse();
          }
          next.push(y);
        }
      }
      frontier = next;
    }
    return null;
  }

  order(c, armyId, to) {
    const a = this.armies.get(armyId);
    if (!a || a.c !== c || to < 0 || to >= this.n) return false;
    const p = this.path(c, a.hex, to);
    if (!p) return false;
    a.path = p;
    a.prog = 0;
    a.retreat = a.fighting;
    return true;
  }

  stop(c, armyId) {
    const a = this.armies.get(armyId);
    if (!a || a.c !== c) return false;
    a.path = [];
    a.prog = 0;
    return true;
  }

  split(c, armyId) {
    const a = this.armies.get(armyId);
    if (!a || a.c !== c || size(a) < 2 * REG || a.fighting) return null;
    const part = {};
    for (const u of UNIT_TYPES) {
      part[u] = Math.floor(a[u] / 2 / 100) * 100;
      a[u] -= part[u];
    }
    return this.addArmy(c, a.hex, part, a.morale);
  }

  merge(c, armyId) {
    const a = this.armies.get(armyId);
    if (!a || a.c !== c) return false;
    const mates = this.armiesAt(a.hex).filter((x) => x !== a && x.c === c);
    if (!mates.length) return false;
    for (const m of mates) this.absorb(a, m);
    return true;
  }

  absorb(into, other) {
    const total = size(into) + size(other);
    into.morale = total ? (into.morale * size(into) + other.morale * size(other)) / total : 1;
    for (const u of UNIT_TYPES) into[u] += other[u];
    this.armies.delete(other.id);
  }

  canRecruitAt(c, hex) {
    return this.owner[hex] === c && !this.armiesAt(hex).some((x) => this.atWar(c, x.c)) && !this.sieges.has(hex);
  }

  recruit(c, hex = null, type = 'inf') {
    const ct = this.countries[c];
    const u = UNITS[type];
    if (!u || !ct.alive || ct.gold < u.cost || ct.manpower < REG) return false;
    const at = hex != null && this.canRecruitAt(c, hex) ? hex : ct.cap;
    if (!this.canRecruitAt(c, at)) return false;
    ct.gold -= u.cost;
    ct.manpower -= REG;
    const here = this.armiesAt(at).find((x) => x.c === c && !x.path.length);
    if (here) this.absorb(here, { id: -1, inf: 0, cav: 0, art: 0, [type]: REG, morale: 0.6 });
    else this.addArmy(c, at, { [type]: REG }, 0.6);
    return true;
  }

  /* ---------- постройки и наука ---------- */

  buildable(c, hex) {
    return this.owner[hex] === c && !this.sieges.has(hex) && !this.armiesAt(hex).some((x) => this.atWar(c, x.c));
  }

  build(c, hex, kind) {
    const ct = this.countries[c];
    if (!this.buildable(c, hex)) return false;
    let cost;
    if (kind === 'dev') {
      if (this.dev[hex] >= MAX_DEV) return false;
      cost = devCost(this.dev[hex]);
    } else if (kind === 'fort') {
      if (this.fort[hex] >= MAX_FORT) return false;
      cost = fortCost(this.fort[hex]);
    } else if (kind === 'market') {
      if (this.market[hex]) return false;
      cost = MARKET_COST;
    } else return false;
    if (ct.gold < cost) return false;
    ct.gold -= cost;
    if (kind === 'dev') this.dev[hex]++;
    if (kind === 'fort') this.fort[hex]++;
    if (kind === 'market') this.market[hex] = 1;
    this.changed.add(hex);
    return true;
  }

  invest(c, hex) {
    return this.build(c, hex, 'dev');
  }

  research(c, t) {
    const ct = this.countries[c];
    if (!TECHS.includes(t) || ct.research || ct.tech[t] >= MAX_TECH) return false;
    const lvl = ct.tech[t] + 1;
    const cost = techCost(lvl);
    if (ct.gold < cost) return false;
    ct.gold -= cost;
    let days = techDays(lvl);
    if (ct.scholar) {
      days = Math.ceil(days / 2);
      ct.scholar = false;
    }
    ct.research = { t, left: days, total: days };
    return true;
  }

  /* ---------- дипломатия ---------- */

  war(a, b) {
    return this.wars.get(key(a, b));
  }

  canDeclare(a, b) {
    const A = this.countries[a];
    const B = this.countries[b];
    if (a === b || !A?.alive || !B?.alive || this.atWar(a, b)) return false;
    if ((A.truce.get(b) || 0) > this.day) return false;
    // Вассал может воевать только за независимость от своего сюзерена.
    if (A.overlord >= 0) return A.overlord === b;
    if (this.friendly(a, b)) return false;
    return true;
  }

  declareWar(a, b) {
    if (!this.canDeclare(a, b)) return false;
    const A = this.countries[a];
    if (A.overlord === b) {
      A.overlord = -1;
      this.startWar(a, b);
      this.events.push({ t: 'independence', a, b });
      return true;
    }
    this.startWar(a, b);
    this.events.push({ t: 'war', a, b });
    // Вассалы нападающего идут с ним.
    for (const v of this.vassalsOf(a)) if (!this.atWar(v, b) && v !== b) this.startWar(v, b);
    // Жертву защищают союзники, сюзерен и вассалы.
    const B = this.countries[b];
    const defenders = new Set([...B.allies, ...this.vassalsOf(b)]);
    if (B.overlord >= 0) defenders.add(B.overlord);
    for (const d of defenders) {
      if (d === a || this.friendly(d, a) || this.atWar(d, a) || !this.countries[d].alive) continue;
      this.startWar(d, a);
      this.events.push({ t: 'join', a: d, b: a, of: b });
      for (const v of this.vassalsOf(d)) if (v !== a && !this.atWar(v, a)) this.startWar(v, a);
    }
    return true;
  }

  startWar(a, b) {
    this.wars.set(key(a, b), { day: this.day, score: { [a]: 0, [b]: 0 } });
    this.countries[a].truce.delete(b);
    this.countries[b].truce.delete(a);
    this.dipDirty = true;
  }

  endWar(a, b) {
    if (!this.atWar(a, b)) return false;
    this.wars.delete(key(a, b));
    this.countries[a].truce.set(b, this.day + TRUCE_DAYS);
    this.countries[b].truce.set(a, this.day + TRUCE_DAYS);
    for (const x of this.armies.values()) {
      if ((x.c === a && this.owner[x.hex] === b) || (x.c === b && this.owner[x.hex] === a)) this.sendHome(x);
    }
    for (const [hex, s] of this.sieges) if ((s.c === a && this.owner[hex] === b) || (s.c === b && this.owner[hex] === a)) this.sieges.delete(hex);
    this.dipDirty = true;
    return true;
  }

  makePeace(a, b) {
    if (!this.endWar(a, b)) return false;
    this.events.push({ t: 'peace', a, b });
    return true;
  }

  // Мир с данью: проигравший отдаёт половину казны.
  makeTribute(winner, loser) {
    if (!this.endWar(winner, loser)) return false;
    const L = this.countries[loser];
    const sum = Math.max(0, Math.floor(L.gold * 0.5));
    L.gold -= sum;
    this.countries[winner].gold += sum;
    this.events.push({ t: 'tribute', a: winner, b: loser, n: sum });
    return true;
  }

  makeVassal(over, v) {
    const V = this.countries[v];
    if (!this.endWar(over, v)) return false;
    // Вассал разрывает свои союзы и выходит из войн с друзьями сюзерена.
    for (const x of [...V.allies]) this.breakAlliance(v, x, true);
    for (const e of this.enemiesOf(v)) if (this.friendly(over, e)) this.endWar(v, e);
    for (const vv of this.vassalsOf(v)) this.countries[vv].overlord = over;
    V.overlord = over;
    V.vassalSince = this.day;
    V.coalition = -1;
    const O = this.countries[over];
    O.threat = Math.min(100, O.threat + this.devSum(v) * 0.6);
    this.events.push({ t: 'vassal', a: over, b: v });
    this.dipDirty = true;
    return true;
  }

  release(over, v) {
    const V = this.countries[v];
    if (V.overlord !== over) return false;
    V.overlord = -1;
    V.truce.set(over, this.day + TRUCE_DAYS);
    this.countries[over].truce.set(v, this.day + TRUCE_DAYS);
    this.events.push({ t: 'release', a: over, b: v });
    this.dipDirty = true;
    return true;
  }

  integrateCost(v) {
    return 20 * this.provinces(v).length;
  }

  canIntegrate(over, v) {
    const V = this.countries[v];
    return V.overlord === over && this.day - V.vassalSince >= VASSAL_INTEGRATE_DAYS && this.countries[over].gold >= this.integrateCost(v) && !this.enemiesOf(v).length;
  }

  // Присоединить вассала: все его земли становятся своими.
  integrate(over, v) {
    if (!this.canIntegrate(over, v)) return false;
    this.countries[over].gold -= this.integrateCost(v);
    for (const h of this.provinces(v)) {
      this.owner[h] = over;
      this.core[h] = over;
      this.since[h] = this.day;
      this.changed.add(h);
    }
    for (const a of this.armies.values()) if (a.c === v) a.c = over;
    this.countries[v].overlord = -1;
    this.events.push({ t: 'integrate', a: over, b: v });
    this.eliminate(v, over, true);
    return true;
  }

  makeAlliance(a, b) {
    if (a === b || this.atWar(a, b) || this.allied(a, b) || !this.countries[a].alive || !this.countries[b].alive) return false;
    if (this.countries[a].overlord >= 0 || this.countries[b].overlord >= 0) return false;
    this.countries[a].allies.add(b);
    this.countries[b].allies.add(a);
    this.events.push({ t: 'ally', a, b });
    this.dipDirty = true;
    return true;
  }

  breakAlliance(a, b, quiet = false) {
    if (!this.allied(a, b)) return false;
    this.countries[a].allies.delete(b);
    this.countries[b].allies.delete(a);
    if (!quiet) this.events.push({ t: 'unally', a, b });
    this.dipDirty = true;
    return true;
  }

  sendHome(x) {
    const cap = this.countries[x.c].cap;
    const p = this.path(x.c, x.hex, cap);
    if (p) x.path = p;
    else {
      x.hex = cap;
      x.path = [];
    }
    x.prog = 0;
  }

  // Можно ли вообще предложить такую сделку.
  canPropose(kind, from, to) {
    const A = this.countries[from];
    const B = this.countries[to];
    if (!A?.alive || !B?.alive || from === to) return false;
    if (kind === 'peace' || kind === 'tribute') return this.atWar(from, to);
    if (kind === 'vassal') return this.atWar(from, to) && A.overlord < 0 && !this.vassalsOf(to).length && B.overlord < 0;
    if (kind === 'ally') return !this.atWar(from, to) && !this.friendly(from, to) && A.overlord < 0 && B.overlord < 0;
    return false;
  }

  // Предложение мира, дани, вассалитета или союза. ИИ отвечает сразу, игроку — вопрос.
  propose(kind, from, to) {
    if (!this.canPropose(kind, from, to)) return null;
    if (this.offers.some((o) => (o.from === from && o.to === to) || (o.from === to && o.to === from && o.kind === kind))) return null;
    const target = this.countries[to];
    if (target.player) {
      const o = { id: this.nextOffer++, kind, from, to, until: this.day + OFFER_DAYS };
      this.offers.push(o);
      this.events.push({ t: 'offer', id: o.id, kind, a: from, b: to });
      this.dipDirty = true;
      return o;
    }
    const yes = this.aiAccepts(kind, to, from);
    if (yes) this.accept(kind, from, to);
    else this.events.push({ t: 'declined', kind, a: from, b: to });
    return yes;
  }

  accept(kind, from, to) {
    if (kind === 'peace') return this.makePeace(from, to);
    if (kind === 'tribute') return this.makeTribute(from, to);
    if (kind === 'vassal') return this.makeVassal(from, to);
    if (kind === 'ally') return this.makeAlliance(from, to);
    return false;
  }

  answer(c, offerId, yes) {
    const i = this.offers.findIndex((o) => o.id === offerId && o.to === c);
    if (i < 0) return false;
    const [o] = this.offers.splice(i, 1);
    this.dipDirty = true;
    if (yes && this.canPropose(o.kind, o.from, o.to)) this.accept(o.kind, o.from, o.to);
    else this.events.push({ t: 'declined', kind: o.kind, a: o.from, b: o.to });
    return true;
  }

  // Перевес в войне: захваченное развитие плюс соотношение сил.
  warBalance(me, other) {
    const w = this.war(me, other);
    if (!w) return 0;
    const mine = this.troops(me) + 1;
    const theirs = this.troops(other) + 1;
    return w.score[me] - w.score[other] + Math.log2(mine / theirs) * 3;
  }

  aiAccepts(kind, me, other) {
    const r = this.rng();
    const M = this.countries[me];
    if (kind === 'peace' || kind === 'tribute' || kind === 'vassal') {
      const w = this.war(me, other);
      const dur = this.day - w.day;
      const bal = this.warBalance(me, other); // > 0 — я выигрываю
      const tired = M.exhaustion > 50 ? 0.25 : 0;
      if (kind === 'peace') {
        if (bal > 6) return r < (dur > 300 ? 0.3 : 0.04) + tired;
        if (bal < -3) return r < 0.85;
        return r < (dur > 240 ? 0.45 : 0.12) + tired;
      }
      if (kind === 'tribute') return bal < -4 ? r < 0.75 : r < 0.05 + tired;
      // Вассалитет — только если совсем плохо.
      const small = this.provinces(me).length < this.provinces(other).length * 0.5;
      return bal < -8 && small ? r < 0.7 : false;
    }
    if (M.coalition === other) return false;
    const shared = this.enemiesOf(me).some((e) => this.atWar(other, e));
    const sameFoe = M.coalition >= 0 && M.coalition === this.countries[other].coalition;
    if (shared || sameFoe) return r < 0.9;
    if ([...M.allies].some((x) => this.atWar(x, other))) return false;
    return r < (this.enemiesOf(me).length ? 0.5 : 0.3);
  }

  /* ---------- день ---------- */

  tick() {
    this.day++;
    this.month = new Date(Date.UTC(1900, 0, 1) + this.day * 86400000).getUTCMonth();
    this.economy();
    this.move();
    this.battles();
    this.recover();
    this.siege();
    if (this.day % 5 === 0) {
      this.society(5);
      this.coalitions();
    }
    for (const c of this.countries) {
      if (!c.alive) continue;
      if (c.nextEvent <= this.day) this.fireEvent(c);
      if (!c.player && (this.day + c.id) % 5 === 0) this.ai(c);
    }
    const before = this.offers.length;
    this.offers = this.offers.filter((o) => o.until > this.day && this.countries[o.from].alive && this.countries[o.to].alive);
    if (before !== this.offers.length) this.dipDirty = true;
    // Игрок не ответил на событие — выбираем первый вариант.
    for (const e of this.pending.filter((x) => x.until <= this.day)) this.decide(e.c, e.id, 0);
    if (this.day % 30 === 0) this.snapshotHistory();
  }

  snapshotHistory() {
    const counts = Array(this.countries.length).fill(0);
    for (let i = 0; i < this.n; i++) if (this.owner[i] >= 0) counts[this.owner[i]]++;
    this.history.push(counts);
  }

  economy() {
    for (const c of this.countries) {
      if (!c.alive) continue;
      c.gold += this.income(c.id) / 30;
      const max = this.mpMax(c.id);
      c.manpower = Math.min(max, c.manpower + max / 150);
      // Казна пуста — армия разбегается.
      if (c.gold < 0) {
        for (const a of this.armies.values()) if (a.c === c.id) for (const u of UNIT_TYPES) a[u] = Math.floor(a[u] * 0.99);
        c.gold = Math.max(c.gold, -20);
      }
      const atWar = this.enemiesOf(c.id).length > 0;
      c.exhaustion = Math.max(0, c.exhaustion - (atWar ? 0.02 : 0.15));
      c.threat = Math.max(0, c.threat - 0.04 - c.threat * 0.0015);
      if (c.research && --c.research.left <= 0) {
        c.tech[c.research.t]++;
        this.events.push({ t: 'tech', c: c.id, tech: c.research.t, lvl: c.tech[c.research.t] });
        c.research = null;
      }
    }
  }

  move() {
    for (const a of this.armies.values()) {
      if (!a.path.length || (a.fighting && !a.retreat)) continue;
      const nx = a.path[0];
      if (!this.canEnter(a.c, nx)) {
        a.path = [];
        a.prog = 0;
        continue;
      }
      a.prog += (this.speed(a) * (a.retreat ? 1.2 : 1)) / this.moveCost(nx);
      if (a.prog < 1) continue;
      a.hex = nx;
      a.path.shift();
      a.prog = 0;
      if (!a.path.length) {
        a.retreat = false;
        // Дошли — объединяемся со своей армией, если она стоит здесь.
        const mate = this.armiesAt(a.hex).find((x) => x !== a && x.c === a.c && !x.path.length);
        if (mate) this.absorb(mate, a);
      }
    }
  }

  lose(a, n) {
    const s = size(a);
    if (!s) return;
    const k = Math.min(1, n / s);
    let lost = 0;
    for (const u of UNIT_TYPES) {
      const d = Math.round(a[u] * k);
      a[u] -= d;
      lost += d;
    }
    const C = this.countries[a.c];
    C.lost += lost;
    C.exhaustion = Math.min(100, C.exhaustion + (lost / Math.max(5000, this.mpMax(a.c))) * 40);
  }

  battles() {
    const byHex = new Map();
    for (const a of this.armies.values()) {
      a.fighting = false;
      (byHex.get(a.hex) || byHex.set(a.hex, []).get(a.hex)).push(a);
    }
    for (const [hex, list] of byHex) {
      if (list.length < 2) continue;
      // Силы по странам; отступающие не бьют в ответ.
      const pow = new Map();
      const men = new Map();
      for (const a of list) {
        men.set(a.c, (men.get(a.c) || 0) + size(a));
        if (!a.retreat) pow.set(a.c, (pow.get(a.c) || 0) + this.power(a));
      }
      const cs = [...men.keys()];
      const dmg = new Map();
      let any = false;
      for (const x of cs) {
        const targets = cs.filter((y) => this.atWar(x, y));
        if (!targets.length) continue;
        any = true;
        const T = targets.reduce((s, y) => s + men.get(y), 0);
        for (const y of targets) {
          const d = (pow.get(x) || 0) * K * REG * (men.get(y) / T) * this.defense(y, hex) * (0.8 + this.rng() * 0.4);
          dmg.set(y, (dmg.get(y) || 0) + d);
        }
      }
      if (!any) continue;
      for (const a of list) {
        if (!dmg.has(a.c)) continue;
        a.fighting = true;
        const d = (dmg.get(a.c) * size(a)) / men.get(a.c);
        const taken = d * this.fragility(a);
        a.morale = Math.max(0, a.morale - (taken / Math.max(1, size(a))) * 3 - 0.02);
        this.lose(a, taken);
      }
      for (const a of list) {
        if (size(a) < 100) {
          this.armies.delete(a.id);
          this.events.push({ t: 'routed', c: a.c, hex });
        } else if (a.fighting && a.morale < 0.25 && !a.retreat) this.startRetreat(a);
      }
    }
  }

  // Боевой дух упал — армия отходит на ближайшую свою клетку без врага.
  startRetreat(a) {
    const safe = (h) => this.friendly(a.c, this.owner[h]) && !this.armiesAt(h).some((x) => this.atWar(a.c, x.c));
    const p = this.find(a.c, a.hex, safe, 10);
    if (!p) return;
    a.path = p;
    a.prog = 0;
    a.retreat = true;
    this.events.push({ t: 'retreat', c: a.c, hex: a.hex });
  }

  // Дух восстанавливается, а на чужой земле, в пустыне и зимой армия тает.
  recover() {
    const winter = this.month === 11 || this.month <= 1;
    for (const a of this.armies.values()) {
      if (a.fighting) continue;
      const C = this.countries[a.c];
      const home = this.friendly(a.c, this.owner[a.hex]);
      const regen = (home ? 0.04 : 0.015) * (1 + 0.1 * C.tech.log);
      a.morale = Math.min(this.maxMorale(a.c), a.morale + regen);
      const t = this.terrain[a.hex];
      let att = home ? 0 : 0.0003 + ATTRITION[t];
      if (winter && (t === 4 || t === 6)) att += home ? 0.0005 : 0.002;
      if (att) this.lose(a, size(a) * att * (1 - 0.12 * C.tech.log));
    }
    for (const a of [...this.armies.values()]) if (size(a) < 100) this.armies.delete(a.id);
  }

  defense(c, hex) {
    const o = this.owner[hex];
    if (!this.friendly(c, o)) return 1;
    let d = DEFENSE[this.terrain[hex]] * 0.85 ** this.fort[hex];
    if (this.river[hex]) d *= 0.9;
    if (this.countries[o]?.cap === hex) d *= 0.85;
    return d;
  }

  siege() {
    const seen = new Set();
    for (const a of this.armies.values()) {
      if (a.fighting || a.path.length) continue;
      const hex = a.hex;
      if (seen.has(hex)) continue;
      seen.add(hex);
      const o = this.owner[hex];
      if (!this.atWar(a.c, o)) continue;
      const here = this.armiesAt(hex);
      if (here.some((x) => this.friendly(x.c, o))) continue;
      const besiegers = here.filter((x) => this.atWar(x.c, o) && !x.path.length);
      const lead = besiegers.sort((x, y) => size(y) - size(x))[0];
      const c = lead.c;
      const men = besiegers.filter((x) => x.c === c).reduce((s, x) => s + size(x), 0);
      const art = besiegers.filter((x) => x.c === c).reduce((s, x) => s + x.art, 0);
      let s = this.sieges.get(hex);
      if (!s || s.c !== c) s = { c, days: 0 };
      const strength = Math.max(0.3, Math.min(1.5, men / (2000 + 1500 * this.fort[hex])));
      s.days += strength * (1 + (2 * art) / Math.max(1, men)) * (1 + 0.15 * this.countries[c].tech.eng);
      s.need = (4 + this.dev[hex]) * (1 + 0.7 * this.fort[hex]) * (this.countries[o].cap === hex ? 1.6 : 1);
      this.sieges.set(hex, s);
      if (s.days >= s.need) {
        this.sieges.delete(hex);
        this.annex(hex, c);
      }
    }
    for (const hex of [...this.sieges.keys()]) if (!seen.has(hex)) this.sieges.delete(hex);
  }

  annex(hex, c) {
    const prev = this.owner[hex];
    this.owner[hex] = c;
    this.since[hex] = this.day;
    this.unrest[hex] = this.core[hex] === c ? 0 : 35;
    this.changed.add(hex);
    const w = this.war(c, prev);
    if (w) w.score[c] += this.dev[hex];
    if (this.core[hex] !== c) this.countries[c].threat = Math.min(100, this.countries[c].threat + this.dev[hex] * 1.5);
    const P = this.countries[prev];
    if (P.cap === hex) {
      const left = this.provinces(prev);
      const loot = Math.max(0, Math.floor(P.gold * 0.3));
      P.gold -= loot;
      this.countries[c].gold += loot;
      if (left.length) {
        P.cap = left.sort((x, y) => this.dev[y] - this.dev[x])[0];
        this.events.push({ t: 'capital', c: prev, by: c, hex });
      }
    }
    if (!this.provinces(prev).length) this.eliminate(prev, c);
  }

  eliminate(x, by, quiet = false) {
    const X = this.countries[x];
    X.alive = false;
    X.research = null;
    X.overlord = -1;
    X.coalition = -1;
    for (const a of [...this.armies.values()]) if (a.c === x) this.armies.delete(a.id);
    for (const e of this.enemiesOf(x)) this.wars.delete(key(x, e));
    for (const y of X.allies) this.countries[y].allies.delete(x);
    X.allies.clear();
    for (const v of this.vassalsOf(x)) this.countries[v].overlord = -1;
    this.offers = this.offers.filter((o) => o.from !== x && o.to !== x);
    this.pending = this.pending.filter((e) => e.c !== x);
    if (!quiet) this.events.push({ t: 'fallen', c: x, by });
    this.dipDirty = true;
  }

  /* ---------- недовольство, восстания, коалиции ---------- */

  society(dt) {
    const garrison = new Set();
    for (const a of this.armies.values()) if (a.c === this.owner[a.hex]) garrison.add(a.hex);
    for (let i = 0; i < this.n; i++) {
      const o = this.owner[i];
      if (o < 0) continue;
      const O = this.countries[o];
      // Население растёт к пределу, который задаёт развитие.
      const cap = this.dev[i] * 12 * TERR_POP[this.terrain[i]] * (this.river[i] ? 1.2 : 1) + 3;
      this.pop[i] += this.pop[i] * 0.0003 * dt * (1 - this.pop[i] / cap);
      const before = this.unrest[i] >= 60;
      if (this.core[i] === o) this.unrest[i] = Math.max(0, this.unrest[i] - 0.5 * dt);
      else {
        // Родная страна жива и воюет с нами — народ ждёт освобождения.
        const R = this.core[i];
        const home = this.countries[R]?.alive ? (this.atWar(o, R) ? 0.08 : 0.02) : 0;
        let d = (0.05 + O.exhaustion * 0.002 + home) * dt;
        if (garrison.has(i)) d -= 0.25 * dt;
        this.unrest[i] = Math.max(0, Math.min(100, this.unrest[i] + d));
        if (this.day - this.since[i] >= CORE_DAYS && this.unrest[i] < 70) {
          this.core[i] = o;
          this.changed.add(i);
        }
      }
      if (before !== this.unrest[i] >= 60) this.changed.add(i);
    }
    for (let i = 0; i < this.n; i++) if (this.owner[i] >= 0 && this.unrest[i] >= 100) this.revolt(i);
  }

  // Восстание: провинция (и соседние с тем же «родным» народом) отпадает.
  // Если родная страна погибла — она возрождается.
  revolt(hex) {
    const o = this.owner[hex];
    const R = this.core[hex];
    if (R === o || R < 0) return;
    const group = [hex];
    const seen = new Set(group);
    for (let k = 0; k < group.length && group.length < 8; k++) {
      for (const j of this.nb[group[k]]) {
        if (seen.has(j)) continue;
        seen.add(j);
        if (this.owner[j] === o && this.core[j] === R && this.unrest[j] >= 50) group.push(j);
      }
    }
    const RC = this.countries[R];
    const reborn = !RC.alive;
    for (const h of group) {
      this.owner[h] = R;
      this.unrest[h] = 0;
      this.since[h] = this.day;
      this.sieges.delete(h);
      this.changed.add(h);
    }
    if (reborn) {
      RC.alive = true;
      RC.cap = group.slice().sort((x, y) => this.dev[y] - this.dev[x])[0];
      RC.gold = 30;
      RC.manpower = Math.round(this.mpMax(R) * 0.5);
      RC.exhaustion = 0;
      RC.threat = 0;
      RC.truce.clear();
      RC.tech = { ...this.countries[o].tech };
    }
    // Чужие армии в отпавших провинциях отходят, повстанцы берут оружие.
    for (const a of this.armies.values()) if (group.includes(a.hex) && a.c === o) this.sendHome(a);
    this.addArmy(R, hex, { inf: group.length * 1200, cav: group.length * 300 }, 0.9);
    if (!this.atWar(R, o)) {
      if (RC.overlord === o) RC.overlord = -1;
      this.startWar(R, o);
    }
    this.events.push({ t: 'revolt', c: R, from: o, n: group.length, reborn });
  }

  // Слишком быстрые завоевания пугают соседей: они объединяются против захватчика.
  coalitions() {
    for (const T of this.countries) {
      if (!T.alive) continue;
      const members = this.countries.filter((x) => x.alive && x.coalition === T.id);
      if (T.threat < 8) {
        for (const m of members) m.coalition = -1;
        continue;
      }
      if (T.threat < 22 || (this.day / 5 + T.id) % 6 !== 0) continue;
      const near = new Set(this.neighborsOf(T.id));
      for (const x of [...near]) for (const y of this.neighborsOf(x)) near.add(y);
      for (const v of this.vassalsOf(T.id)) for (const y of this.neighborsOf(v)) near.add(y);
      near.delete(T.id);
      const joined = [];
      for (const id of near) {
        const X = this.countries[id];
        if (!X.alive || X.player || X.overlord >= 0 || X.coalition >= 0 || this.friendly(id, T.id)) continue;
        if (this.rng() < Math.min(0.85, (T.threat - 15) / 30)) {
          X.coalition = T.id;
          joined.push(id);
        }
      }
      const all = this.countries.filter((x) => x.alive && x.coalition === T.id);
      if (!all.length) continue;
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) this.makeAllianceQuiet(all[i].id, all[j].id);
      if (joined.length) this.events.push({ t: 'coalition', c: T.id, n: all.length });
      const power = all.reduce((s, x) => s + this.troops(x.id), 0);
      if (all.length >= 2 && power >= this.troops(T.id) * 0.8) {
        for (const x of all) if (this.canDeclare(x.id, T.id)) this.declareWar(x.id, T.id);
      }
    }
  }

  makeAllianceQuiet(a, b) {
    if (this.allied(a, b) || this.atWar(a, b)) return;
    this.countries[a].allies.add(b);
    this.countries[b].allies.add(a);
    this.dipDirty = true;
  }

  /* ---------- события ---------- */

  eventOk(c, type) {
    const C = this.countries[c.id ?? c];
    if (type === 'flood') return this.provinces(C.id).some((h) => this.river[h]);
    if (type === 'deserters') return this.enemiesOf(C.id).length > 0;
    if (type === 'scholar' || type === 'discovery') return !!C.research || TECHS.some((t) => C.tech[t] < MAX_TECH);
    return true;
  }

  fireEvent(C) {
    C.nextEvent = this.day + 150 + Math.floor(this.rng() * 200);
    const opts = EVENTS.filter((t) => this.eventOk(C, t));
    const type = opts[Math.floor(this.rng() * opts.length)];
    const e = { id: this.nextEventId++, c: C.id, type, until: this.day + EVENT_DAYS };
    if (type === 'flood') {
      const rivers = this.provinces(C.id).filter((h) => this.river[h]);
      e.hex = rivers[Math.floor(this.rng() * rivers.length)];
    }
    if (C.player) {
      this.pending.push(e);
      this.events.push({ t: 'event', id: e.id, c: C.id, type, hex: e.hex });
      return;
    }
    // ИИ: экономные берут золото, воинственные — силу.
    const pick = { gold: 0, plague: 0, harvest: C.focus === 'war' ? 1 : 0, reform: C.gold > 90 ? 0 : 1, scholar: C.gold > 60 ? 0 : 1, riots: 1, volunteers: 0, merchants: 0, flood: C.gold > 50 ? 0 : 1, festival: C.exhaustion > 20 ? 0 : 1, deserters: 0, discovery: C.gold > 100 ? 0 : 1 }[type];
    this.applyEvent(e, pick ?? 0);
  }

  decide(c, id, choice) {
    const i = this.pending.findIndex((e) => e.id === id && e.c === c);
    if (i < 0) return false;
    const [e] = this.pending.splice(i, 1);
    this.applyEvent(e, choice ? 1 : 0);
    return true;
  }

  applyEvent(e, choice) {
    const C = this.countries[e.c];
    if (!C.alive) return;
    const mine = this.provinces(C.id);
    const armies = [...this.armies.values()].filter((a) => a.c === C.id);
    const max = this.mpMax(C.id);
    const A = choice === 0;
    switch (e.type) {
      case 'gold':
        if (A) C.gold += 80;
        else for (const h of mine) this.unrest[h] = Math.max(0, this.unrest[h] - 25);
        break;
      case 'plague':
        if (A) {
          C.gold -= 30;
          for (const h of mine) this.pop[h] *= 0.95;
        } else {
          for (const h of mine) this.pop[h] *= 0.85;
          C.manpower *= 0.7;
        }
        break;
      case 'harvest':
        if (A) C.gold += 50;
        else C.manpower = Math.min(max, C.manpower + max * 0.25);
        break;
      case 'reform':
        if (A) {
          C.gold -= 60;
          C.buff = { atk: 1.15, until: this.day + 365 };
        }
        break;
      case 'scholar':
        if (A) {
          C.gold -= 40;
          if (C.research) C.research.left = Math.ceil(C.research.left / 2);
          else C.scholar = true;
        }
        break;
      case 'riots':
        if (A) {
          C.manpower = Math.max(0, C.manpower - 3000);
          C.exhaustion = Math.min(100, C.exhaustion + 3);
          this.unrest[C.cap] = 0;
        } else {
          C.gold -= 40;
          C.exhaustion = Math.max(0, C.exhaustion - 10);
        }
        break;
      case 'volunteers':
        if (A) {
          const here = armies.find((a) => a.hex === C.cap && !a.path.length);
          if (here) here.inf += 2 * REG;
          else this.addArmy(C.id, C.cap, { inf: 2 * REG }, 0.8);
        } else if (this.dev[C.cap] < MAX_DEV) this.dev[C.cap]++;
        break;
      case 'merchants':
        if (A) {
          const h = [C.cap, ...mine.sort((x, y) => this.dev[y] - this.dev[x])].find((x) => !this.market[x]);
          if (h != null) this.market[h] = 1;
        } else C.gold += 60;
        break;
      case 'flood':
        if (A) C.gold -= 40;
        else if (e.hex != null && this.owner[e.hex] === C.id) this.dev[e.hex] = Math.max(1, this.dev[e.hex] - 1);
        break;
      case 'festival':
        if (A) {
          C.gold -= 30;
          C.exhaustion = Math.max(0, C.exhaustion - 15);
          for (const h of mine) this.unrest[h] = Math.max(0, this.unrest[h] - 10);
        } else C.gold += 10;
        break;
      case 'deserters':
        if (A) {
          C.manpower = Math.min(max, C.manpower + 3000);
          C.exhaustion = Math.max(0, C.exhaustion - 5);
        } else {
          for (const a of armies) a.morale = Math.min(1, a.morale + 0.2);
          C.exhaustion = Math.min(100, C.exhaustion + 5);
        }
        break;
      case 'discovery':
        if (A) {
          C.gold -= 70;
          if (C.research) C.research.left = 1;
          else C.scholar = true;
        } else C.gold += 45;
        break;
    }
    for (const h of mine) this.changed.add(h);
    this.events.push({ t: 'decided', id: e.id, c: C.id, type: e.type, choice: A ? 0 : 1 });
  }

  /* ---------- ИИ ---------- */

  ai(c) {
    const id = c.id;
    const enemies = this.enemiesOf(id);
    const atWar = enemies.length > 0;
    const strength = this.troops(id);
    // В мирное время копим на следующее открытие.
    const nextTech = TECHS.filter((t) => c.tech[t] < MAX_TECH).map((t) => techCost(c.tech[t] + 1));
    const reserve = atWar ? 0 : c.research || !nextTech.length ? 25 : Math.min(...nextTech) + 5;
    // Наука, если есть лишние деньги.
    if (!c.research) {
      const order = c.focus === 'war' ? ['mil', 'eng', 'log', 'eco'] : ['eco', 'log', 'mil', 'eng'];
      const t = order.filter((x) => c.tech[x] < MAX_TECH).sort((a, b) => c.tech[a] - c.tech[b] + (order.indexOf(a) - order.indexOf(b)) * 0.4)[0];
      if (t && c.gold >= techCost(c.tech[t] + 1) + (atWar ? 15 : 5)) this.research(id, t);
    }
    // Войска: в войну — на всё, что есть; в мире — до разумной армии.
    const want = atWar ? Infinity : this.mpMax(id) * (c.focus === 'war' ? 0.7 : 0.45) + 2000;
    const mix = c.focus === 'war' ? ['inf', 'inf', 'cav', 'art', 'inf'] : ['inf', 'inf', 'inf', 'cav', 'art'];
    const front = this.frontHex(id);
    for (let k = 0; k < 6; k++) {
      if (this.troops(id) >= want || c.gold < UNITS.art.cost + reserve || c.manpower < REG) break;
      const type = mix[(this.day / 5 + k) % mix.length | 0];
      if (!this.recruit(id, front, type)) break;
    }
    if (!atWar && c.gold > 60) this.aiBuild(c);
    // Вассал: копит силы и ждёт момента для независимости.
    if (c.overlord >= 0) {
      const over = c.overlord;
      if (this.troops(id) > this.troops(over) * 0.9 && this.rng() < 0.15 && this.canDeclare(id, over)) this.declareWar(id, over);
      return this.aiArmies(id, this.enemiesOf(id));
    }
    for (const v of this.vassalsOf(id)) if (this.canIntegrate(id, v) && this.rng() < 0.3) this.integrate(id, v);
    if (c.cooldown <= this.day && !atWar && this.day > GRACE_DAYS && c.exhaustion < 30 && this.rng() < 0.12 * c.aggr * this.aggression) {
      const opts = this.neighborsOf(id).filter((o) => this.canDeclare(id, o));
      let best = null;
      let bestRatio = 0.85;
      for (const o of opts) {
        const O = this.countries[o];
        const helpers = new Set([...O.allies, ...this.vassalsOf(o)]);
        if (O.overlord >= 0) helpers.add(O.overlord);
        const theirs = this.troops(o) + [...helpers].reduce((s, x) => s + this.troops(x) * 0.7, 0);
        const ratio = theirs / Math.max(1, strength);
        if (ratio < bestRatio) {
          bestRatio = ratio;
          best = o;
        }
      }
      if (best != null) {
        this.declareWar(id, best);
        c.cooldown = this.day + 40;
      }
    }
    for (const e of this.enemiesOf(id)) {
      const w = this.war(id, e);
      const dur = this.day - w.day;
      // Предложения — не чаще раза в месяц на войну.
      if (dur < 60 || (w.asked?.[id] || 0) > this.day) continue;
      (w.asked ||= {})[id] = this.day + 30;
      const bal = this.warBalance(id, e);
      const E = this.countries[e];
      if (E.player && this.rng() > 0.4) continue; // игрока не заваливаем предложениями
      if (bal > 9 && this.canPropose('vassal', id, e) && this.provinces(e).length < this.provinces(id).length * 0.5) this.propose('vassal', id, e);
      else if (bal > 5 && dur > 120) this.propose('tribute', id, e);
      else if (bal < -3 || c.exhaustion > 45 || (dur > 240 && this.rng() < 0.2)) this.propose('peace', id, e);
    }
    if (c.allies.size < 2 && this.rng() < 0.03) {
      const pool = this.countries.filter((o) => o.alive && o.id !== id && this.canPropose('ally', id, o.id));
      const o = pool[Math.floor(this.rng() * pool.length)];
      if (o && (!o.player || this.rng() < 0.3)) this.propose('ally', id, o.id);
    }
    this.aiArmies(id, this.enemiesOf(id));
  }

  aiBuild(c) {
    const id = c.id;
    const mine = this.provinces(id).filter((h) => this.buildable(id, h));
    if (!mine.length) return;
    const enemiesNear = new Set(this.neighborsOf(id).filter((o) => this.troops(o) > this.troops(id)));
    const border = mine.filter((h) => this.nb[h].some((j) => enemiesNear.has(this.owner[j])));
    const fortTarget = border.filter((h) => this.fort[h] < 1).sort((a, b) => this.dev[b] - this.dev[a])[0];
    if (fortTarget != null && this.rng() < 0.4 && this.build(id, fortTarget, 'fort')) return;
    if (this.fort[c.cap] < 2 && this.rng() < 0.2 && this.build(id, c.cap, 'fort')) return;
    const mk = mine.filter((h) => !this.market[h] && this.dev[h] >= 3).sort((a, b) => this.dev[b] - this.dev[a])[0];
    if (mk != null && this.rng() < 0.5 && this.build(id, mk, 'market')) return;
    const cheap = mine.filter((h) => this.dev[h] < MAX_DEV).sort((a, b) => this.dev[a] - this.dev[b])[0];
    if (cheap != null) this.build(id, cheap, 'dev');
  }

  // Где набирать войска: у границы с врагом, иначе в столице.
  frontHex(c) {
    const enemies = this.enemiesOf(c);
    if (!enemies.length) return null;
    const cap = this.countries[c].cap;
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < this.n; i++) {
      if (this.owner[i] !== c || !this.nb[i].some((j) => enemies.includes(this.owner[j]))) continue;
      if (!this.canRecruitAt(c, i)) continue;
      const d = hexDist(this.w, i, cap);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  enemyAt(c, hex) {
    let s = 0;
    for (const a of this.armiesAt(hex)) if (this.atWar(c, a.c)) s += this.power(a);
    return s;
  }

  aiArmies(c, enemies) {
    const mine = [...this.armies.values()].filter((a) => a.c === c && !a.path.length && !a.fighting);
    if (!mine.length) return;
    if (!enemies.length) {
      for (const a of mine) if (this.owner[a.hex] !== c) this.sendHome(a);
      return;
    }
    const biggest = mine.reduce((m, a) => (size(a) > size(m) ? a : m), mine[0]);
    for (const a of mine) {
      const pw = this.power(a);
      // Идёт осада — не бросаем её, если своей земле ничего не грозит.
      const besieging = this.sieges.get(a.hex)?.c === c;
      const ours = (h) => this.friendly(c, this.owner[h]);
      // Дух упал — отдыхаем дома.
      if (a.morale < 0.45 && !besieging) {
        if (!ours(a.hex)) {
          const p = this.find(c, a.hex, (h) => ours(h) && !this.enemyAt(c, h), 12);
          if (p) a.path = p;
        }
        continue;
      }
      let p = this.find(c, a.hex, (h) => ours(h) && this.enemyAt(c, h) > 0 && this.enemyAt(c, h) < pw * 1.2, besieging ? 4 : 12);
      if (!p && besieging) continue;
      if (!p && a !== biggest && size(a) < 3000 && size(biggest) >= size(a)) {
        p = a.hex === biggest.hex ? null : this.path(c, a.hex, biggest.hex);
        if (p) {
          a.path = p;
          continue;
        }
      }
      // Сначала — слабо защищённая вражеская столица поблизости.
      if (!p) p = this.find(c, a.hex, (h) => enemies.includes(this.owner[h]) && this.countries[this.owner[h]].cap === h && this.enemyAt(c, h) < pw * 0.8, 8);
      if (!p) p = this.find(c, a.hex, (h) => enemies.includes(this.owner[h]) && this.enemyAt(c, h) < pw * 1.1);
      if (!p) p = this.find(c, a.hex, (h) => enemies.includes(this.owner[h]));
      if (p) {
        a.path = p;
        a.prog = 0;
      }
    }
  }

  /* ---------- для сети ---------- */

  armyList() {
    return [...this.armies.values()].map((a) => [
      a.id,
      a.c,
      a.hex,
      Math.round(a.inf / 100),
      Math.round(a.cav / 100),
      Math.round(a.art / 100),
      a.path[0] ?? -1,
      Math.min(99, Math.floor(a.prog * 100)),
      (a.fighting ? 1 : 0) | (a.retreat ? 2 : 0),
      a.path.at(-1) ?? -1,
      Math.round(a.morale * 100),
      Math.round(this.speed(a) * 100),
    ]);
  }

  countryList() {
    return this.countries.map((c) => [
      Math.floor(c.gold),
      Math.round(this.income(c.id) * 10) / 10,
      this.troops(c.id),
      this.provinces(c.id).length,
      c.alive ? 1 : 0,
      c.cap,
      Math.floor(c.manpower),
      this.mpMax(c.id),
      Math.round(c.exhaustion),
      Math.round(c.threat),
      c.overlord,
      TECHS.map((t) => c.tech[t]).join(''),
      c.research ? [c.research.t, c.research.left, c.research.total] : 0,
      c.coalition,
    ]);
  }

  siegeList() {
    return [...this.sieges].map(([hex, s]) => [hex, s.c, Math.floor((s.days / s.need) * 100)]);
  }

  diplomacy() {
    const allies = [];
    for (const c of this.countries) for (const o of c.allies) if (c.id < o) allies.push([c.id, o]);
    const truces = [];
    for (const c of this.countries) for (const [o, until] of c.truce) if (c.id < o && until > this.day) truces.push([c.id, o, until]);
    return {
      wars: [...this.wars.entries()].map(([k, w]) => {
        const [a, b] = k.split('-').map(Number);
        return [a, b, w.day, w.score[a], w.score[b]];
      }),
      allies,
      truces,
      vassals: this.countries.filter((c) => c.alive && c.overlord >= 0).map((c) => [c.overlord, c.id, c.vassalSince]),
      offers: this.offers.map((o) => [o.id, o.kind, o.from, o.to, o.until]),
    };
  }

  // Флаги провинции: рынок, крепость (2 бита), «своя» ли, уровень недовольства.
  flags(h) {
    return this.market[h] | (this.fort[h] << 1) | (this.core[h] === this.owner[h] ? 8 : 0) | (Math.min(3, Math.floor(this.unrest[h] / 30)) << 4);
  }

  provinceState(h) {
    return [h, this.owner[h], this.dev[h], this.flags(h), this.core[h], Math.round(this.pop[h])];
  }

  flushChanges() {
    const out = [...this.changed].map((h) => this.provinceState(h));
    this.changed.clear();
    return out;
  }
}
