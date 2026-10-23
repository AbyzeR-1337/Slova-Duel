import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../js/engine.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function setup(opts = {}) {
  const log = [];
  const m = new Match({
    players: ['p1', 'p2'],
    names: { p1: 'Аня', p2: 'Боря' },
    send: (msg) => log.push(msg),
    timeScale: 0.01, // уровень длится доли секунды
    ...opts,
  });
  const next = async (t) => {
    for (let k = 0; k < 400; k++) {
      const found = log.find((x) => x.t === t && !x.seen);
      if (found) {
        found.seen = true;
        return found;
      }
      await wait(2);
    }
    throw new Error('нет сообщения ' + t);
  };
  return { m, log, next };
}

test('быстрейший из заявивших забирает слово (с окном ожидания)', async () => {
  const { m, next } = setup({ grace: 30 });
  m.start(1);
  const level = await next('level');
  assert.equal(level.total, 10);
  const r = await next('round');
  assert.equal(r.letters.length, r.word.length);
  m.claim('p1', { i: r.i, ms: 200, hints: 0 });
  m.claim('p1', { i: r.i, ms: 100, hints: 0 }); // повтор игнорируется
  await wait(5);
  m.claim('p2', { i: r.i, ms: 150, hints: 0 }); // пришёл позже, но собрал быстрее
  const res = await next('result');
  assert.equal(res.winner, 'p2');
  assert.equal(res.margin, 50);
  assert.ok(res.points > 0);
  assert.equal(res.scores.p2, res.points);
  m.stop();
});

test('никто не успел — очков нет, следующий раунд идёт сам', async () => {
  const { m, next } = setup();
  m.start(2);
  await next('level');
  const r = await next('round');
  const res = await next('result');
  assert.equal(res.winner, null);
  assert.equal(res.word, r.word);
  const r2 = await next('round');
  assert.equal(r2.i, 1);
  m.stop();
});

test('чужие и некорректные заявки игнорируются', async () => {
  const { m, next, log } = setup({ grace: 1000 });
  m.start(1);
  const r = await next('round');
  m.claim('p3', { i: r.i, ms: 10 });
  m.claim('p1', { i: r.i + 1, ms: 10 });
  m.claim('p1', { i: r.i, ms: -5 });
  m.claim('p1', { i: r.i, ms: 'abc' });
  m.claim('p1', { i: r.i, ms: r.dur * 10 });
  assert.equal(log.filter((x) => x.t === 'result').length, 0);
  m.stop();
});

test('уровень заканчивается, после готовности обоих начинается следующий', async () => {
  const { m, next } = setup({ timeScale: 0.002 });
  m.start(1);
  await next('level');
  for (let i = 0; i < 10; i++) {
    const r = await next('round');
    m.claim(i % 2 ? 'p2' : 'p1', { i: r.i, ms: 1, hints: 0 });
    await next('result');
  }
  const end = await next('levelEnd');
  assert.equal(end.level, 1);
  assert.equal(end.history.length, 10);
  assert.equal(end.final, false);
  assert.equal(end.levelScores.p1, end.levelScores.p2);
  assert.equal(end.levelWinner, null);
  m.setReady('p1');
  assert.equal(m.phase, 'levelEnd');
  m.setReady('p2');
  const l2 = await next('level');
  assert.equal(l2.level, 2);
  assert.equal(l2.total, 12);
  assert.deepEqual(l2.scores, end.scores);
  m.stop();
});

test('после последнего уровня — итог матча и возврат в лобби', async () => {
  const { m, next } = setup({ timeScale: 0.001 });
  m.start(5);
  for (let i = 0; i < 18; i++) {
    const r = await next('round');
    m.claim('p1', { i: r.i, ms: 1, hints: 0 });
    await next('result');
  }
  const end = await next('levelEnd');
  assert.equal(end.final, true);
  assert.equal(end.matchWinner, 'p1');
  m.setReady('p1');
  m.setReady('p2');
  const lobby = await next('lobby');
  assert.equal(m.phase, 'lobby');
  assert.equal(lobby.names.p1, 'Аня');
});

test('снимок состояния для переподключившегося игрока', async () => {
  const { m, next } = setup();
  m.lobby(3);
  assert.deepEqual(m.snapshot().map((x) => x.t), ['lobby']);
  m.start(3);
  await next('level');
  const r = await next('round');
  const snap = m.snapshot();
  assert.deepEqual(snap.map((x) => x.t), ['level', 'round']);
  assert.equal(snap[0].countdown, 0);
  assert.equal(snap[1].i, r.i);
  assert.ok(snap[1].elapsed >= 0);
  assert.ok(snap[1].seq > snap[0].seq);
  m.stop();
});
