import { neighbors, hexDist, MOVE_DAYS, DEFENSE } from './world.js';

// Симуляция «Империй»: один тик — один день. Экономика, армии, сражения,
// осады, дипломатия и ИИ стран. Ничего не знает о сети — это делает engine.js.

export const REG = 1000; // солдат в полку
export const REG_COST = 12;
export const GRACE_DAYS = 45; // первые полтора месяца ИИ ни на кого не нападает
const K = 0.07; // доля потерь от численности противника в день
const TRUCE_DAYS = 120;
const OFFER_DAYS = 30;
const MAX_DEV = 9;

const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

class Heap {
  constructor() {
    this.a = [];
  }
  push(p, v) {
    const a = this.a;
    a.push([p, v]);
    let i = a.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (a[j][0] <= a[i][0]) break;
      [a[i], a[j]] = [a[j], a[i]];
      i = j;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

export class Sim {
  constructor(world, { rng = Math.random, aggression = 1 } = {}) {
    this.rng = rng;
    this.aggression = aggression;
    this.w = world.w;
    this.h = world.h;
    this.terrain = world.terrain.slice();
    this.dev = world.dev.slice();
    this.owner = world.owner.slice();
    this.n = this.w * this.h;
    this.nb = Array.from({ length: this.n }, (_, i) => neighbors(this.w, this.h, i));
    this.landCount = this.terrain.filter(Boolean).length;
    this.day = 0;
    this.armies = new Map();
    this.nextArmy = 1;
    this.sieges = new Map();
    this.wars = new Map(); // ключ пары → {day, score: {a: n, b: n}}
    this.offers = [];
    this.nextOffer = 1;
    this.events = [];
    this.changed = new Set();
    this.dipDirty = true;
    this.countries = world.countries.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      cap: c.capital,
      gold: 30,
      alive: true,
      player: null,
      aggr: 0.5 + rng(),
      allies: new Set(),
      truce: new Map(),
      cooldown: 0,
    }));
    for (const c of this.countries) {
      const prov = this.provinces(c.id).length;
      this.addArmy(c.id, c.cap, REG * Math.max(2, Math.round(prov / 4)));
    }
  }

  /* ---------- справки ---------- */

  provinces(c) {
    const out = [];
    for (let i = 0; i < this.n; i++) if (this.owner[i] === c) out.push(i);
    return out;
  }

  troops(c) {
    let s = 0;
    for (const a of this.armies.values()) if (a.c === c) s += a.size;
    return s;
  }

  devSum(c) {
    let s = 0;
    for (let i = 0; i < this.n; i++) if (this.owner[i] === c) s += this.dev[i];
    return s;
  }

  // Месячный доход: развитие провинций, бонус столицы, минус содержание армии.
  income(c) {
    return this.devSum(c) * 0.5 + 4 - (this.troops(c) / REG) * 0.4;
  }

  troopCap(c) {
    return (8 + this.provinces(c).length) * REG;
  }

  investCost(hex) {
    return 10 + this.dev[hex] * 6;
  }

  atWar(a, b) {
    return a !== b && this.wars.has(key(a, b));
  }

  allied(a, b) {
    return a !== b && a >= 0 && b >= 0 && this.countries[a].allies.has(b);
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
    return o === c || this.allied(c, o) || this.atWar(c, o);
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

  score(c) {
    return this.devSum(c) + this.troops(c) / 2000;
  }

  /* ---------- армии ---------- */

  addArmy(c, hex, size) {
    const a = { id: this.nextArmy++, c, hex, size, path: [], prog: 0, fighting: false, retreat: false };
    this.armies.set(a.id, a);
    return a;
  }

  // Путь с учётом местности: Дейкстра по проходимым клеткам.
  path(c, from, to) {
    if (from === to || !this.canEnter(c, to)) return null;
    const dist = new Float32Array(this.n).fill(Infinity);
    const prev = new Int32Array(this.n).fill(-1);
    const heap = new Heap();
    dist[from] = 0;
    heap.push(0, from);
    while (heap.size) {
      const [d, x] = heap.pop();
      if (x === to) break;
      if (d > dist[x]) continue;
      for (const y of this.nb[x]) {
        if (!this.canEnter(c, y)) continue;
        const nd = d + MOVE_DAYS[this.terrain[y]];
        if (nd < dist[y]) {
          dist[y] = nd;
          prev[y] = x;
          heap.push(nd, y);
        }
      }
    }
    if (prev[to] < 0) return null;
    const out = [];
    for (let x = to; x !== from; x = prev[x]) out.push(x);
    return out.reverse();
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

  split(c, armyId) {
    const a = this.armies.get(armyId);
    if (!a || a.c !== c || a.size < 2 * REG || a.fighting) return null;
    const half = Math.floor(a.size / 2 / 100) * 100;
    a.size -= half;
    return this.addArmy(c, a.hex, half);
  }

  recruit(c, hex = null) {
    const ct = this.countries[c];
    if (!ct.alive || ct.gold < REG_COST || this.troops(c) + REG > this.troopCap(c)) return false;
    const at = hex != null && this.owner[hex] === c ? hex : ct.cap;
    if (this.armiesAt(at).some((x) => this.atWar(c, x.c))) return false;
    ct.gold -= REG_COST;
    const here = this.armiesAt(at).find((x) => x.c === c && !x.path.length);
    if (here) here.size += REG;
    else this.addArmy(c, at, REG);
    return true;
  }

  invest(c, hex) {
    const ct = this.countries[c];
    if (this.owner[hex] !== c || this.dev[hex] >= MAX_DEV) return false;
    const cost = this.investCost(hex);
    if (ct.gold < cost) return false;
    ct.gold -= cost;
    this.dev[hex]++;
    this.changed.add(hex);
    return true;
  }

  /* ---------- дипломатия ---------- */

  war(a, b) {
    return this.wars.get(key(a, b));
  }

  canDeclare(a, b) {
    const A = this.countries[a];
    const B = this.countries[b];
    return a !== b && A?.alive && B?.alive && !this.atWar(a, b) && !this.allied(a, b) && (A.truce.get(b) || 0) <= this.day;
  }

  declareWar(a, b) {
    if (!this.canDeclare(a, b)) return false;
    this.startWar(a, b);
    this.events.push({ t: 'war', a, b });
    // Союзники жертвы вступают в войну.
    for (const d of this.countries[b].allies) {
      if (d === a || this.allied(d, a) || this.atWar(d, a) || !this.countries[d].alive) continue;
      this.startWar(d, a);
      this.events.push({ t: 'join', a: d, b: a, of: b });
    }
    return true;
  }

  startWar(a, b) {
    this.wars.set(key(a, b), { day: this.day, score: { [a]: 0, [b]: 0 } });
    this.countries[a].truce.delete(b);
    this.countries[b].truce.delete(a);
    this.dipDirty = true;
  }

  makePeace(a, b) {
    if (!this.atWar(a, b)) return false;
    this.wars.delete(key(a, b));
    this.countries[a].truce.set(b, this.day + TRUCE_DAYS);
    this.countries[b].truce.set(a, this.day + TRUCE_DAYS);
    // Армии на чужой земле возвращаются домой.
    for (const x of this.armies.values()) {
      if ((x.c === a && this.owner[x.hex] === b) || (x.c === b && this.owner[x.hex] === a)) this.sendHome(x);
    }
    for (const [hex, s] of this.sieges) if ((s.c === a && this.owner[hex] === b) || (s.c === b && this.owner[hex] === a)) this.sieges.delete(hex);
    this.events.push({ t: 'peace', a, b });
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

  makeAlliance(a, b) {
    if (a === b || this.atWar(a, b) || this.allied(a, b) || !this.countries[a].alive || !this.countries[b].alive) return false;
    this.countries[a].allies.add(b);
    this.countries[b].allies.add(a);
    this.events.push({ t: 'ally', a, b });
    this.dipDirty = true;
    return true;
  }

  breakAlliance(a, b) {
    if (!this.allied(a, b)) return false;
    this.countries[a].allies.delete(b);
    this.countries[b].allies.delete(a);
    this.events.push({ t: 'unally', a, b });
    this.dipDirty = true;
    return true;
  }

  // Предложение мира или союза. ИИ отвечает сразу, игроку — приходит вопрос.
  propose(kind, from, to) {
    if (kind === 'peace' && !this.atWar(from, to)) return null;
    if (kind === 'ally' && (this.atWar(from, to) || this.allied(from, to))) return null;
    if (this.offers.some((o) => o.kind === kind && ((o.from === from && o.to === to) || (o.from === to && o.to === from)))) return null;
    const target = this.countries[to];
    if (!target?.alive) return null;
    if (target.player) {
      const o = { id: this.nextOffer++, kind, from, to, until: this.day + OFFER_DAYS };
      this.offers.push(o);
      this.events.push({ t: 'offer', id: o.id, kind, a: from, b: to });
      return o;
    }
    const yes = this.aiAccepts(kind, to, from);
    if (yes) kind === 'peace' ? this.makePeace(from, to) : this.makeAlliance(from, to);
    else this.events.push({ t: 'declined', kind, a: from, b: to });
    return yes;
  }

  answer(c, offerId, yes) {
    const i = this.offers.findIndex((o) => o.id === offerId && o.to === c);
    if (i < 0) return false;
    const [o] = this.offers.splice(i, 1);
    if (yes) o.kind === 'peace' ? this.makePeace(o.from, o.to) : this.makeAlliance(o.from, o.to);
    else this.events.push({ t: 'declined', kind: o.kind, a: o.from, b: o.to });
    return true;
  }

  aiAccepts(kind, me, other) {
    const r = this.rng();
    if (kind === 'peace') {
      const w = this.war(me, other);
      const dur = this.day - w.day;
      const mine = this.troops(me);
      const theirs = this.troops(other);
      const ahead = w.score[me] - w.score[other];
      if (ahead > 4 && mine > theirs) return r < (dur > 300 ? 0.3 : 0.04);
      if (mine < theirs * 0.7 || ahead < -3) return r < 0.85;
      return dur > 240 ? r < 0.45 : r < 0.1;
    }
    const shared = this.enemiesOf(me).some((e) => this.atWar(other, e));
    if (shared) return r < 0.9;
    if ([...this.countries[me].allies].some((x) => this.atWar(x, other))) return false;
    return r < (this.enemiesOf(me).length ? 0.5 : 0.3);
  }

  /* ---------- день ---------- */

  tick() {
    this.day++;
    this.economy();
    this.move();
    this.battles();
    this.siege();
    for (const c of this.countries) {
      if (c.alive && !c.player && (this.day + c.id) % 5 === 0) this.ai(c);
    }
    const before = this.offers.length;
    this.offers = this.offers.filter((o) => o.until > this.day && this.countries[o.from].alive && this.countries[o.to].alive);
    if (before !== this.offers.length) this.dipDirty = true;
  }

  economy() {
    for (const c of this.countries) {
      if (!c.alive) continue;
      c.gold += this.income(c.id) / 30;
      // Казна пуста — армия разбегается.
      if (c.gold < 0) {
        for (const a of this.armies.values()) if (a.c === c.id) a.size = Math.floor(a.size * 0.99);
        c.gold = Math.max(c.gold, -20);
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
      a.prog += 1 / MOVE_DAYS[this.terrain[nx]];
      if (a.prog < 1) continue;
      if (a.retreat) a.size = Math.floor(a.size * 0.92);
      a.retreat = false;
      a.hex = nx;
      a.path.shift();
      a.prog = 0;
      if (!a.path.length) {
        // Дошли — объединяемся со своей армией, если она стоит здесь.
        const mate = this.armiesAt(a.hex).find((x) => x !== a && x.c === a.c && !x.path.length);
        if (mate) {
          mate.size += a.size;
          this.armies.delete(a.id);
        }
      }
    }
  }

  battles() {
    const byHex = new Map();
    for (const a of this.armies.values()) {
      a.fighting = false;
      (byHex.get(a.hex) || byHex.set(a.hex, []).get(a.hex)).push(a);
    }
    for (const [hex, list] of byHex) {
      if (list.length < 2) continue;
      const total = new Map();
      for (const a of list) total.set(a.c, (total.get(a.c) || 0) + a.size);
      const cs = [...total.keys()];
      const dmg = new Map();
      let any = false;
      for (const x of cs) {
        const targets = cs.filter((y) => this.atWar(x, y));
        if (!targets.length) continue;
        any = true;
        const T = targets.reduce((s, y) => s + total.get(y), 0);
        for (const y of targets) {
          const share = total.get(y) / T;
          const d = total.get(x) * K * share * this.defense(y, hex) * (0.8 + this.rng() * 0.4);
          dmg.set(y, (dmg.get(y) || 0) + d);
        }
      }
      if (!any) continue;
      for (const a of list) {
        const d = dmg.get(a.c);
        if (!d) continue;
        a.fighting = true;
        a.size = Math.floor(a.size - (d * a.size) / total.get(a.c));
      }
      for (const a of list) {
        if (a.size < 50) {
          this.armies.delete(a.id);
          this.events.push({ t: 'routed', c: a.c, hex });
        }
      }
    }
  }

  defense(c, hex) {
    const o = this.owner[hex];
    if (o !== c && !this.allied(c, o)) return 1;
    return DEFENSE[this.terrain[hex]] * (this.countries[o]?.cap === hex ? 0.75 : 1);
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
      if (here.some((x) => x.c === o || this.allied(x.c, o))) continue;
      const c = here.filter((x) => this.atWar(x.c, o)).sort((x, y) => y.size - x.size)[0].c;
      let s = this.sieges.get(hex);
      if (!s || s.c !== c) s = { c, days: 0 };
      s.days++;
      s.need = 3 + this.dev[hex] + (this.countries[o].cap === hex ? 8 : 0);
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
    this.changed.add(hex);
    const w = this.war(c, prev);
    if (w) w.score[c] += this.dev[hex];
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

  eliminate(x, by) {
    const X = this.countries[x];
    X.alive = false;
    for (const a of [...this.armies.values()]) if (a.c === x) this.armies.delete(a.id);
    for (const e of this.enemiesOf(x)) this.wars.delete(key(x, e));
    for (const y of X.allies) this.countries[y].allies.delete(x);
    X.allies.clear();
    this.offers = this.offers.filter((o) => o.from !== x && o.to !== x);
    this.events.push({ t: 'fallen', c: x, by });
    this.dipDirty = true;
  }

  dominant() {
    const counts = new Map();
    for (let i = 0; i < this.n; i++) if (this.owner[i] >= 0) counts.set(this.owner[i], (counts.get(this.owner[i]) || 0) + 1);
    for (const [c, k] of counts) if (k >= this.landCount * 0.5) return c;
    return counts.size === 1 ? [...counts.keys()][0] : null;
  }

  /* ---------- ИИ ---------- */

  ai(c) {
    const id = c.id;
    const enemies = this.enemiesOf(id);
    const atWar = enemies.length > 0;
    const strength = this.troops(id);
    const prov = this.provinces(id).length;
    // Набор войск: в войну — на все деньги, в мирное время — до разумного предела.
    const want = atWar ? Infinity : prov * 700 + 2000;
    for (let k = 0; k < 6; k++) {
      if (this.troops(id) >= want || c.gold < REG_COST + (atWar ? 0 : 10)) break;
      if (!this.recruit(id, this.frontHex(id))) break;
    }
    if (!atWar && c.gold > 70) {
      const mine = this.provinces(id).filter((h) => this.dev[h] < MAX_DEV);
      const best = mine.sort((a, b) => this.investCost(a) - this.investCost(b))[0];
      if (best != null) this.invest(id, best);
    }
    if (c.cooldown <= this.day && !atWar && this.day > GRACE_DAYS && this.rng() < 0.12 * c.aggr * this.aggression) {
      const opts = this.neighborsOf(id).filter((o) => this.canDeclare(id, o));
      let best = null;
      let bestRatio = 0.9;
      for (const o of opts) {
        const theirs = this.troops(o) + [...this.countries[o].allies].reduce((s, x) => s + this.troops(x) * 0.7, 0);
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
    for (const e of enemies) {
      const w = this.war(id, e);
      const dur = this.day - w.day;
      if (dur > 90 && (strength < this.troops(e) * 0.6 || w.score[e] > w.score[id] + 6 || (dur > 240 && this.rng() < 0.2))) {
        if (this.countries[e].player && this.rng() > 0.4) continue; // игроку предлагаем реже
        this.propose('peace', id, e);
      }
    }
    if (c.allies.size < 2 && this.rng() < 0.03) {
      const pool = this.countries.filter((o) => o.alive && o.id !== id && !this.atWar(id, o.id) && !this.allied(id, o.id));
      const o = pool[Math.floor(this.rng() * pool.length)];
      if (o && (!o.player || this.rng() < 0.3)) this.propose('ally', id, o.id);
    }
    this.aiArmies(id, this.enemiesOf(id));
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
      if (this.armiesAt(i).some((x) => this.atWar(c, x.c))) continue;
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
    for (const a of this.armiesAt(hex)) if (this.atWar(c, a.c)) s += a.size;
    return s;
  }

  aiArmies(c, enemies) {
    const mine = [...this.armies.values()].filter((a) => a.c === c && !a.path.length && !a.fighting);
    if (!mine.length) return;
    if (!enemies.length) {
      for (const a of mine) if (this.owner[a.hex] !== c) this.sendHome(a);
      return;
    }
    const biggest = mine.reduce((m, a) => (a.size > m.size ? a : m), mine[0]);
    for (const a of mine) {
      // Идёт осада — не бросаем её, если своей земле ничего не грозит.
      const besieging = this.sieges.get(a.hex)?.c === c;
      // Защищаем свою землю от вторжения, если хватает сил.
      let p = this.find(c, a.hex, (h) => (this.owner[h] === c || this.allied(c, this.owner[h])) && this.enemyAt(c, h) > 0 && this.enemyAt(c, h) < a.size * 1.3, besieging ? 4 : 12);
      if (!p && besieging) continue;
      if (!p && a !== biggest && a.size < 1500 && biggest.size >= a.size) {
        p = a.hex === biggest.hex ? null : this.path(c, a.hex, biggest.hex);
        if (p) {
          a.path = p;
          continue;
        }
      }
      if (!p) p = this.find(c, a.hex, (h) => enemies.includes(this.owner[h]) && this.enemyAt(c, h) < a.size * 1.1);
      if (!p) p = this.find(c, a.hex, (h) => enemies.includes(this.owner[h]));
      if (p) {
        a.path = p;
        a.prog = 0;
      }
    }
  }

  /* ---------- для сети ---------- */

  armyList() {
    return [...this.armies.values()].map((a) => [a.id, a.c, a.hex, a.size, a.path[0] ?? -1, Math.min(99, Math.floor(a.prog * 100)), a.fighting ? 1 : 0, a.path.at(-1) ?? -1]);
  }

  countryList() {
    return this.countries.map((c) => [Math.floor(c.gold), Math.round(this.income(c.id) * 10) / 10, this.troops(c.id), this.provinces(c.id).length, c.alive ? 1 : 0, c.cap]);
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
      offers: this.offers.map((o) => [o.id, o.kind, o.from, o.to, o.until]),
    };
  }

  flushChanges() {
    const out = [...this.changed].map((h) => [h, this.owner[h], this.dev[h]]);
    this.changed.clear();
    return out;
  }
}
