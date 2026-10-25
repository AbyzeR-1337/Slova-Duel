import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, neighbors, hexDist, mulberry32, findPath, SIZES } from '../js/games/empires/world.js';
import { Sim, REG, UNITS, techCost, devCost, MARKET_COST } from '../js/games/empires/sim.js';
import { EmpiresGame } from '../js/games/empires/engine.js';
import { fakeCtx, until, wait } from './helpers.js';

// Мир, где ИИ ничего не делает: удобно проверять правила по шагам.
function quietSim(seed = 3, size = 'small') {
  const sim = new Sim(generateWorld({ seed, size, lang: 'en' }), { rng: mulberry32(seed) });
  for (const c of sim.countries) {
    c.player = 'p' + c.id;
    c.nextEvent = Infinity;
  }
  return sim;
}

test('мир: детерминирован, один материк, реки, все земли поделены', () => {
  for (const size of Object.keys(SIZES)) {
    const a = generateWorld({ seed: 77, size, lang: 'ru' });
    const b = generateWorld({ seed: 77, size, lang: 'ru' });
    assert.deepEqual(a, b);
    const land = a.terrain.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
    const seen = new Set([land[0]]);
    const st = [land[0]];
    while (st.length) for (const j of neighbors(a.w, a.h, st.pop())) if (a.terrain[j] && !seen.has(j)) seen.add(j), st.push(j);
    assert.equal(seen.size, land.length);
    for (const i of land) assert.ok(a.owner[i] >= 0 && a.dev[i] >= 1);
    assert.ok(a.countries.length >= SIZES[size].countries - 2);
    assert.equal(new Set(a.countries.map((c) => c.name)).size, a.countries.length);
    for (const c of a.countries) assert.match(c.name, /^[А-ЯЁ][а-яё]+$/);
    assert.ok(a.rivers.length > 0);
    for (const r of a.rivers) for (const h of r.path) assert.ok(a.terrain[h] && a.river[h]);
  }
  const en = generateWorld({ seed: 5, size: 'small', lang: 'en' });
  for (const c of en.countries) assert.match(c.name, /^[A-Z][a-z]+$/);
  assert.equal(hexDist(10, 0, 9), 9);
  // Поиск пути обходит запретные клетки.
  const nb = Array.from({ length: 30 }, (_, i) => neighbors(10, 3, i));
  const p = findPath(nb, 0, 9, (h) => h % 10 !== 5 || h >= 20, () => 1);
  assert.ok(p && p.at(-1) === 9 && !p.includes(5) && !p.includes(15));
});

test('войска: три рода, резерв, золото, объединение и разделение', () => {
  const sim = quietSim();
  const C = sim.countries[0];
  C.gold = 500;
  C.manpower = 5 * REG;
  assert.ok(sim.recruit(0, null, 'inf'));
  assert.ok(sim.recruit(0, null, 'cav'));
  assert.ok(sim.recruit(0, null, 'art'));
  assert.equal(C.gold, 500 - UNITS.inf.cost - UNITS.cav.cost - UNITS.art.cost);
  assert.equal(C.manpower, 2 * REG);
  sim.recruit(0);
  sim.recruit(0);
  assert.equal(sim.recruit(0), false, 'резерв кончился');
  const armies = [...sim.armies.values()].filter((a) => a.c === 0);
  assert.equal(armies.length, 1);
  const a = armies[0];
  assert.ok(a.cav >= REG && a.art === REG);
  assert.ok(a.morale < 1, 'новобранцы снижают дух');
  // Артиллерия замедляет, конница без пехоты — быстрая.
  assert.ok(sim.speed(a) < 1);
  const b = sim.split(0, a.id);
  assert.ok(b && b.hex === a.hex);
  assert.ok(sim.merge(0, a.id));
  assert.equal(sim.armies.has(b.id), false);
});

test('война: поход, бой, осада, захват столицы и недовольство', () => {
  const sim = quietSim();
  const a = 0;
  const b = sim.neighborsOf(a)[0];
  const capB = sim.countries[b].cap;
  sim.countries[a].gold = 900;
  sim.countries[a].manpower = 40 * REG;
  for (let k = 0; k < 12; k++) sim.recruit(a, null, k % 4 === 3 ? 'art' : 'inf');
  const army = [...sim.armies.values()].find((x) => x.c === a);
  army.morale = 1;
  assert.equal(sim.order(a, army.id, capB), false, 'без войны нельзя');
  assert.ok(sim.declareWar(a, b));
  assert.ok(sim.order(a, army.id, capB));
  let fought = false;
  for (let d = 0; d < 600 && sim.owner[capB] !== a; d++) {
    sim.tick();
    fought ||= [...sim.armies.values()].some((x) => x.fighting);
    sim.events = [];
    // Наша армия могла отступить — снова отправляем её на столицу.
    for (const x of sim.armies.values()) if (x.c === a && !x.path.length && x.hex !== capB && x.morale > 0.6) sim.order(a, x.id, capB);
  }
  assert.ok(fought);
  assert.equal(sim.owner[capB], a);
  assert.notEqual(sim.core[capB], a);
  assert.ok(sim.unrest[capB] > 0, 'завоёванная провинция недовольна');
  assert.ok(sim.countries[a].threat > 0, 'соседи напуганы');
  const B = sim.countries[b];
  assert.ok(!B.alive || B.cap !== capB);
  if (B.alive) {
    assert.ok(sim.makePeace(a, b));
    assert.equal(sim.canDeclare(a, b), false, 'перемирие');
  }
});

test('постройки и наука', () => {
  const sim = quietSim();
  const C = sim.countries[0];
  C.gold = 1000;
  const h = C.cap;
  const dev = sim.dev[h];
  assert.ok(sim.build(0, h, 'dev'));
  assert.equal(sim.dev[h], dev + 1);
  assert.ok(sim.build(0, h, 'market'));
  assert.equal(sim.build(0, h, 'market'), false);
  assert.ok(sim.build(0, h, 'fort'));
  assert.equal(sim.fort[h], 1);
  assert.equal(C.gold, 1000 - devCost(dev) - MARKET_COST - 25);
  const before = sim.grossIncome(0);
  assert.ok(sim.research(0, 'eco'));
  assert.equal(sim.research(0, 'mil'), false, 'одно исследование за раз');
  for (let d = 0; d < 80; d++) sim.tick();
  assert.equal(C.tech.eco, 1);
  assert.ok(sim.grossIncome(0) > before);
  assert.ok(techCost(2) > techCost(1));
});

test('вассалы, дань и присоединение', () => {
  const sim = quietSim(9);
  const [a, b] = [0, sim.neighborsOf(0)[0]];
  sim.declareWar(a, b);
  sim.countries[b].gold = 100;
  assert.ok(sim.makeTribute(a, b));
  assert.equal(sim.countries[b].gold, 50);
  assert.equal(sim.atWar(a, b), false);
  sim.countries[b].truce.clear();
  sim.countries[a].truce.clear();
  sim.declareWar(a, b);
  assert.ok(sim.makeVassal(a, b));
  assert.equal(sim.countries[b].overlord, a);
  assert.ok(sim.friendly(a, b));
  assert.equal(sim.canDeclare(b, 5 === b ? 6 : 5), false, 'вассал не воюет сам');
  // Вассал платит четверть дохода.
  assert.ok(sim.income(a) > sim.grossIncome(a) - sim.upkeep(a));
  // Сюзерен воюет — вассал с ним.
  const foe = sim.countries.find((x) => x.id !== a && x.id !== b && sim.canDeclare(a, x.id)).id;
  sim.declareWar(a, foe);
  assert.ok(sim.atWar(b, foe));
  sim.makePeace(a, foe);
  sim.makePeace(b, foe);
  sim.countries[a].gold = 10000;
  assert.equal(sim.integrate(a, b), false, 'рано');
  sim.day += 400;
  const land = sim.provinces(b);
  assert.ok(sim.integrate(a, b));
  assert.equal(sim.countries[b].alive, false);
  for (const h of land) assert.equal(sim.owner[h], a);
});

test('восстание возрождает погибшую страну', () => {
  const sim = quietSim(4);
  const [a, b] = [0, sim.neighborsOf(0)[0]];
  const land = sim.provinces(b);
  sim.declareWar(a, b);
  for (const h of land) sim.annex(h, a);
  assert.equal(sim.countries[b].alive, false);
  sim.events = [];
  for (const h of land) sim.unrest[h] = 99.9;
  sim.society(5);
  const ev = sim.events.find((e) => e.t === 'revolt');
  assert.ok(ev && ev.c === b && ev.reborn);
  assert.ok(sim.countries[b].alive);
  assert.ok(sim.atWar(a, b));
  assert.ok([...sim.armies.values()].some((x) => x.c === b));
});

test('коалиция против захватчика', () => {
  const sim = new Sim(generateWorld({ seed: 6, size: 'medium', lang: 'en' }), { rng: () => 0.01 });
  const T = sim.countries[0];
  T.threat = 60;
  sim.day = 30 * 6;
  for (let k = 0; k < 6; k++) {
    sim.day = (k + 1) * 5 * 6 - 5 * T.id;
    sim.coalitions();
  }
  const members = sim.countries.filter((x) => x.coalition === 0);
  assert.ok(members.length >= 2);
  assert.ok(sim.events.some((e) => e.t === 'coalition'));
  // Члены коалиции в союзе друг с другом.
  assert.ok(sim.allied(members[0].id, members[1].id));
});

test('события: игрок выбирает, ИИ решает сам', () => {
  const sim = quietSim();
  const C = sim.countries[0];
  C.nextEvent = 0;
  const gold = C.gold;
  sim.tick();
  const e = sim.pending.find((x) => x.c === 0);
  assert.ok(e);
  assert.ok(sim.events.some((x) => x.t === 'event' && x.id === e.id));
  assert.ok(sim.decide(0, e.id, 1));
  assert.equal(sim.decide(0, e.id, 0), false);
  assert.ok(sim.events.some((x) => x.t === 'decided' && x.id === e.id && x.choice === 1));
  // ИИ-стране событие применяется сразу.
  const ai = sim.countries[1];
  ai.player = null;
  ai.nextEvent = sim.day + 1;
  sim.tick();
  assert.equal(sim.pending.filter((x) => x.c === 1).length, 0);
  assert.ok(Number.isFinite(gold));
});

test('симуляция ИИ: мир живёт, страны воюют и исчезают, никто не захватывает всё', () => {
  const sim = new Sim(generateWorld({ seed: 3, size: 'medium', lang: 'en' }), { rng: mulberry32(9) });
  const n0 = sim.countries.length;
  const total = sim.landCount;
  const seen = new Set();
  for (let d = 0; d < 1500; d++) {
    sim.tick();
    for (const e of sim.events) seen.add(e.t);
    sim.events = [];
  }
  for (const t of ['war', 'peace', 'tech']) assert.ok(seen.has(t), t);
  assert.ok(sim.countries.filter((c) => c.alive).length < n0);
  assert.equal(sim.owner.filter((o) => o >= 0).length, total);
  for (const a of sim.armies.values()) assert.ok(sim.countries[a.c].alive && a.inf + a.cav + a.art > 0);
  assert.ok(sim.countries.every((c) => !c.alive || sim.realm(c.id) < total * 0.5));
});

test('империи: выбор стран, пауза, ходы игрока, событие, итог по времени', async () => {
  const { ctx, log, priv, state } = fakeCtx(['h', { id: 'bot', bot: true }], { map: 'small', time: 10, speed: 'fast', ai: 'war' });
  const g = new EmpiresGame(ctx, { rng: mulberry32(2), timeScale: 0.0005 });
  g.start();
  assert.equal(log[0].t, 'world');
  assert.ok(log[0].river.length === log[0].terrain.length);
  const pickable = g.sim.countries.find((c) => !g.seats.some((s) => s.c === c.id)).id;
  g.action('h', { t: 'pick', c: pickable });
  await until(() => g.phase === 'play');
  const me = g.seat('h').c;
  assert.equal(me, pickable);
  assert.notEqual(g.seat('bot').c, me);
  assert.equal(g.sim.countries[me].player, 'h');
  // Пауза: дни не идут, время партии не тратится.
  g.action('bot', { t: 'speed', v: 0 }); // не хозяин
  assert.equal(g.speed, 3);
  g.action('h', { t: 'speed', v: 0 });
  const day = g.sim.day;
  const left = g.left;
  await wait(30);
  assert.equal(g.sim.day, day);
  g.action('h', { t: 'speed', v: 3 });
  assert.ok(g.left <= left && left - g.left < 25);
  g.sim.countries[me].gold = 200;
  g.sim.countries[me].manpower = 10 * REG;
  const troops = g.sim.troops(me);
  g.action('h', { t: 'recruit', unit: 'cav' });
  assert.equal(g.sim.troops(me), troops + REG);
  g.action('h', { t: 'research', tech: 'mil' });
  assert.ok(g.sim.countries[me].research);
  g.action('h', { t: 'move', army: 999, to: 0 });
  assert.equal(priv.h.at(-1).t, 'nope');
  // Событие приходит лично игроку.
  g.sim.countries[me].nextEvent = g.sim.day + 1;
  await until(() => priv.h.some((m) => m.t === 'event'));
  const ev = priv.h.find((m) => m.t === 'event');
  g.action('h', { t: 'decide', id: ev.id, choice: 0 });
  assert.equal(g.sim.pending.length, 0);
  const target = g.sim.neighborsOf(me)[0];
  g.action('h', { t: 'war', c: target });
  assert.ok(g.sim.atWar(me, target));
  assert.ok(log.some((m) => m.t === 'tick' && m.dip?.wars.length));
  await until(() => state.ended, 30000);
  const r = state.ended.ranking;
  assert.equal(r.length, 2);
  const full = log.filter((m) => m.t === 'full').at(-1);
  assert.equal(full.phase, 'over');
  assert.ok(full.chart.ids.includes(me) && full.chart.rows.length >= 1);
  g.stop();
});
