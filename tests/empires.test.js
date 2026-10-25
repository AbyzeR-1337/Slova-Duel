import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, neighbors, hexDist, mulberry32, SIZES } from '../js/games/empires/world.js';
import { Sim, REG, REG_COST } from '../js/games/empires/sim.js';
import { EmpiresGame } from '../js/games/empires/engine.js';
import { fakeCtx, until } from './helpers.js';

test('мир: детерминирован, один материк, все земли поделены', () => {
  for (const size of Object.keys(SIZES)) {
    const a = generateWorld({ seed: 77, size, lang: 'ru' });
    const b = generateWorld({ seed: 77, size, lang: 'ru' });
    assert.deepEqual(a, b);
    const land = a.terrain.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
    // Связность суши.
    const seen = new Set([land[0]]);
    const st = [land[0]];
    while (st.length) for (const j of neighbors(a.w, a.h, st.pop())) if (a.terrain[j] && !seen.has(j)) seen.add(j), st.push(j);
    assert.equal(seen.size, land.length);
    for (const i of land) assert.ok(a.owner[i] >= 0 && a.dev[i] >= 1);
    assert.ok(a.countries.length >= SIZES[size].countries - 2);
    assert.equal(new Set(a.countries.map((c) => c.name)).size, a.countries.length);
    for (const c of a.countries) assert.match(c.name, /^[А-ЯЁ][а-яё]+$/);
  }
  const en = generateWorld({ seed: 5, size: 'small', lang: 'en' });
  for (const c of en.countries) assert.match(c.name, /^[A-Z][a-z]+$/);
  assert.equal(hexDist(10, 0, 9), 9);
});

test('симуляция: набор, поход, сражение, осада и захват столицы', () => {
  const world = generateWorld({ seed: 3, size: 'small', lang: 'en' });
  const sim = new Sim(world, { rng: mulberry32(1) });
  for (const c of sim.countries) c.player = 'human'; // отключаем ИИ
  // Две соседние страны.
  const a = 0;
  const b = sim.neighborsOf(a)[0];
  const capB = sim.countries[b].cap;
  sim.countries[a].gold = 500;
  for (let k = 0; k < 10; k++) assert.ok(sim.recruit(a));
  assert.equal(sim.countries[a].gold, 500 - 10 * REG_COST);
  const army = [...sim.armies.values()].find((x) => x.c === a);
  assert.ok(army.size >= 10 * REG);
  assert.equal(sim.order(a, army.id, capB), false); // без войны нельзя
  assert.ok(sim.declareWar(a, b));
  assert.ok(sim.events.some((e) => e.t === 'war' && e.a === a && e.b === b));
  assert.ok(sim.order(a, army.id, capB));
  let fought = false;
  for (let d = 0; d < 400 && sim.owner[capB] !== a; d++) {
    sim.tick();
    fought ||= [...sim.armies.values()].some((x) => x.fighting);
  }
  assert.ok(fought);
  assert.equal(sim.owner[capB], a);
  const B = sim.countries[b];
  assert.ok(!B.alive || B.cap !== capB);
  // Мир и перемирие.
  if (B.alive) {
    assert.ok(sim.makePeace(a, b));
    assert.equal(sim.canDeclare(a, b), false);
  }
});

test('симуляция: союзник жертвы вступает в войну, мир через предложение', () => {
  const world = generateWorld({ seed: 9, size: 'small', lang: 'en' });
  const sim = new Sim(world, { rng: () => 0.01 });
  const [a, b, d] = [0, 1, 2];
  assert.ok(sim.makeAlliance(b, d));
  assert.ok(sim.declareWar(a, b));
  assert.ok(sim.atWar(d, a));
  assert.equal(sim.declareWar(b, d), false); // союзнику войну не объявить
  sim.countries[b].player = 'p';
  const o = sim.propose('peace', a, b);
  assert.equal(o.kind, 'peace');
  assert.ok(sim.answer(b, o.id, true));
  assert.equal(sim.atWar(a, b), false);
  // ИИ при rng≈0 соглашается на мир.
  assert.equal(sim.propose('peace', d, a), true);
});

test('симуляция ИИ: мир живёт, страны воюют и исчезают', () => {
  const sim = new Sim(generateWorld({ seed: 3, size: 'medium', lang: 'en' }), { rng: mulberry32(9) });
  const n0 = sim.countries.length;
  const total = sim.landCount;
  let wars = 0;
  for (let d = 0; d < 1500; d++) {
    sim.tick();
    wars += sim.events.filter((e) => e.t === 'war').length;
    sim.events = [];
  }
  assert.ok(wars > 5);
  assert.ok(sim.countries.filter((c) => c.alive).length < n0);
  assert.equal(sim.owner.filter((o) => o >= 0).length, total);
  for (const a of sim.armies.values()) assert.ok(sim.countries[a.c].alive && a.size > 0);
});

test('империи: выбор стран, ходы игрока, итог по времени', async () => {
  const { ctx, log, priv, state } = fakeCtx(['h', { id: 'bot', bot: true }], { map: 'small', time: 10, speed: 'fast', ai: 'war' });
  const g = new EmpiresGame(ctx, { rng: mulberry32(2), timeScale: 0.0005 });
  g.start();
  assert.equal(log[0].t, 'world');
  const pickable = g.sim.countries.find((c) => !g.seats.some((s) => s.c === c.id)).id;
  g.action('h', { t: 'pick', c: pickable });
  await until(() => g.phase === 'play');
  const me = g.seat('h').c;
  assert.equal(me, pickable);
  assert.notEqual(g.seat('bot').c, null);
  assert.notEqual(g.seat('bot').c, me);
  assert.equal(g.sim.countries[me].player, 'h');
  g.sim.countries[me].gold = 100;
  g.action('h', { t: 'recruit' });
  assert.ok(g.sim.troops(me) >= 3 * REG);
  g.action('h', { t: 'move', army: 999, to: 0 });
  assert.equal(priv.h.at(-1).t, 'nope');
  const target = g.sim.neighborsOf(me)[0];
  g.action('h', { t: 'war', c: target });
  assert.ok(g.sim.atWar(me, target));
  assert.ok(log.some((m) => m.t === 'tick' && m.dip?.wars.length));
  await until(() => state.ended, 30000);
  const r = state.ended.ranking;
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((x) => x.place), [1, 2]);
  const full = log.filter((m) => m.t === 'full').at(-1);
  assert.equal(full.phase, 'over');
  g.stop();
});
