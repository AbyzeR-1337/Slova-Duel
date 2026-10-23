import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, scramble, pickWords, wordPoints, pickWinner, leader } from '../js/logic.js';
import { WORDS } from '../js/words.js';

test('первый уровень — 10 слов, дальше слов больше, а времени меньше', () => {
  assert.equal(LEVELS[0].words, 10);
  for (let i = 1; i < LEVELS.length; i++) {
    assert.ok(LEVELS[i].words > LEVELS[i - 1].words);
    assert.ok(LEVELS[i].time < LEVELS[i - 1].time);
    assert.ok(LEVELS[i].pause < LEVELS[i - 1].pause);
  }
});

test('перемешанное слово состоит из тех же букв и не совпадает с ответом', () => {
  for (const list of Object.values(WORDS)) {
    for (const { word } of list) {
      for (let k = 0; k < 20; k++) {
        const s = scramble(word);
        assert.deepEqual([...s].sort(), [...word].sort());
        assert.notEqual(s.join(''), word);
      }
    }
  }
});

test('выбор слов для уровня без повторов', () => {
  for (const l of LEVELS) {
    const words = pickWords(l.n).map((w) => w.word);
    assert.equal(words.length, l.words);
    assert.equal(new Set(words).size, words.length);
  }
});

test('очки: быстрее — больше, подсказки уменьшают, уровни дороже', () => {
  const fast = wordPoints(1, 1000, 30000);
  const slow = wordPoints(1, 25000, 30000);
  assert.ok(fast > slow);
  assert.ok(wordPoints(1, 1000, 30000, 1) < fast);
  assert.ok(wordPoints(1, 1000, 30000, 2) < wordPoints(1, 1000, 30000, 1));
  assert.ok(wordPoints(5, 1000, 30000) > fast);
  assert.equal(wordPoints(1, 0, 30000), 200);
  assert.equal(wordPoints(1, 30000, 30000), 100);
});

test('победитель раунда и лидер', () => {
  assert.equal(pickWinner({}), null);
  assert.equal(pickWinner({ p1: { ms: 900 }, p2: { ms: 700 } }), 'p2');
  assert.equal(leader({ p1: 10, p2: 10 }), null);
  assert.equal(leader({ p1: 30, p2: 10 }), 'p1');
  assert.equal(leader({ p1: 5 }), 'p1');
});
