import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS } from '../js/words.js';
import { LEVELS } from '../js/logic.js';

test('в каждом уровне хватает слов с запасом', () => {
  for (const l of LEVELS) {
    assert.ok(WORDS[l.n].length >= l.words * 1.5, `уровень ${l.n}: ${WORDS[l.n].length} слов`);
  }
});

test('слова только из заглавных русских букв, без Ё, и длина растёт с уровнем', () => {
  for (const l of LEVELS) {
    for (const { word, clue } of WORDS[l.n]) {
      assert.match(word, /^[А-ЯЁ]+$/u, word);
      assert.ok(!word.includes('Ё'), `${word}: буква Ё путается с Е`);
      assert.equal(word.length, l.n + 3, `${word} не подходит уровню ${l.n}`);
      assert.ok(clue && clue.length > 5, `${word}: нет подсказки`);
      assert.ok(!clue.toUpperCase().includes(word), `${word}: подсказка выдаёт ответ`);
    }
  }
});

test('слова не повторяются', () => {
  const all = Object.values(WORDS).flat().map((w) => w.word);
  assert.equal(new Set(all).size, all.length);
});
