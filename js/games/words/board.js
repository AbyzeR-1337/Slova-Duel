import { MAX_HINTS } from './logic.js';
import { sfx } from '../../core/sfx.js';
import { t } from '../../core/i18n.js';

// Раскладка ЙЦУКЕН по физическим клавишам — чтобы на компьютере
// можно было печатать, даже если включена английская раскладка.
const KEYMAP = {
  KeyQ: 'Й', KeyW: 'Ц', KeyE: 'У', KeyR: 'К', KeyT: 'Е', KeyY: 'Н', KeyU: 'Г', KeyI: 'Ш',
  KeyO: 'Щ', KeyP: 'З', BracketLeft: 'Х', BracketRight: 'Ъ', KeyA: 'Ф', KeyS: 'Ы', KeyD: 'В',
  KeyF: 'А', KeyG: 'П', KeyH: 'Р', KeyJ: 'О', KeyK: 'Л', KeyL: 'Д', Semicolon: 'Ж',
  Quote: 'Э', KeyZ: 'Я', KeyX: 'Ч', KeyC: 'С', KeyV: 'М', KeyB: 'И', KeyN: 'Т', KeyM: 'Ь',
  Comma: 'Б', Period: 'Ю',
};

const TEMPLATE = `
  <div class="board-head"><span class="bh-name"></span><b class="bh-score">0</b></div>
  <div class="timer"><div class="timer-fill"></div><span class="timer-text"></span></div>
  <div class="clue"></div>
  <div class="slots"></div>
  <div class="tiles"></div>
  <div class="controls">
    <button class="btn ctl hint" type="button">💡 <span class="hint-label"></span> <span class="hint-left"></span></button>
    <button class="btn ctl back" type="button">⌫</button>
  </div>
  <div class="board-msg" hidden></div>
`;

function onTap(el, fn) {
  // pointerdown срабатывает сразу при касании — важно, когда соревнуешься на скорость.
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    fn(e);
  });
  // Клавиатура (Enter/пробел на кнопке) даёт click без pointerdown.
  el.addEventListener('click', (e) => {
    if (e.detail === 0) fn(e);
  });
}

export class Board {
  constructor(root, { onSolve, onProgress, ticks = true }) {
    this.root = root;
    this.onSolve = onSolve;
    this.onProgress = onProgress;
    this.ticks = ticks;
    root.innerHTML = TEMPLATE;
    const q = (s) => root.querySelector(s);
    this.el = {
      name: q('.bh-name'),
      score: q('.bh-score'),
      timer: q('.timer'),
      fill: q('.timer-fill'),
      time: q('.timer-text'),
      clue: q('.clue'),
      slots: q('.slots'),
      tiles: q('.tiles'),
      hint: q('.hint'),
      hintLeft: q('.hint-left'),
      back: q('.back'),
      msg: q('.board-msg'),
    };
    onTap(this.el.tiles, (e) => {
      const t = e.target.closest('.tile');
      if (t) this.place(Number(t.dataset.id));
    });
    onTap(this.el.slots, (e) => {
      const s = e.target.closest('.slot');
      if (s) this.remove(Number(s.dataset.i));
    });
    q('.hint-label').textContent = t('words.hint');
    this.el.back.setAttribute('aria-label', t('words.erase'));
    onTap(this.el.hint, () => this.hint());
    onTap(this.el.back, () => this.backspace());
    this.idle();
  }

  setHead(name, score) {
    this.el.name.textContent = name;
    this.el.score.textContent = score;
  }

  idle() {
    this.stopTimer();
    this.r = null;
    this.done = true;
    this.root.classList.remove('solved', 'expired', 'won', 'lost');
    this.el.clue.textContent = t('words.ready');
    this.el.slots.innerHTML = '';
    this.el.tiles.innerHTML = '';
    this.el.msg.hidden = true;
    this.el.fill.style.transform = 'scaleX(1)';
    this.el.time.textContent = '';
  }

  setRound(r) {
    this.stopTimer();
    this.r = r;
    this.word = r.word;
    this.tiles = r.letters.map((ch, id) => ({ ch, id, used: false }));
    this.slots = Array(r.word.length).fill(null);
    this.locked = 0;
    this.hints = 0;
    this.done = false;
    this.busy = false;
    this.start = performance.now() - (r.elapsed || 0);
    this.deadline = this.start + r.dur;
    this.lastTick = null;
    this.root.classList.remove('solved', 'expired', 'won', 'lost');
    const n = r.word.length;
    this.root.style.setProperty('--n', n);
    // До 5 букв — в один ряд, длиннее — в два.
    this.root.style.setProperty('--per', n <= 5 ? n : Math.ceil(n / 2));
    this.el.msg.hidden = true;
    this.el.clue.textContent = r.clue;
    this.el.slots.innerHTML = this.slots.map((_, i) => `<div class="slot" data-i="${i}"></div>`).join('');
    this.el.tiles.innerHTML = this.tiles
      .map((t) => `<button class="tile" type="button" data-id="${t.id}">${t.ch}</button>`)
      .join('');
    this.render();
    this.tick();
  }

  render() {
    const slotEls = this.el.slots.children;
    this.slots.forEach((id, i) => {
      const el = slotEls[i];
      el.textContent = id == null ? '' : this.tiles[id].ch;
      el.classList.toggle('filled', id != null);
      el.classList.toggle('locked', i < this.locked);
    });
    const tileEls = this.el.tiles.children;
    this.tiles.forEach((t) => tileEls[t.id].classList.toggle('used', t.used));
    const left = MAX_HINTS - this.hints;
    this.el.hintLeft.textContent = left > 0 ? `(${left})` : '';
    this.el.hint.disabled = this.done || left <= 0;
    this.el.back.disabled = this.done;
  }

  filled() {
    return this.slots.filter((s) => s != null).length;
  }

  changed() {
    this.render();
    this.onProgress?.(this.filled());
  }

  canAct() {
    return this.r && !this.done && !this.busy;
  }

  place(id) {
    if (!this.canAct()) return;
    const tile = this.tiles[id];
    if (!tile || tile.used) return;
    const idx = this.slots.indexOf(null);
    if (idx < 0) return;
    tile.used = true;
    this.slots[idx] = id;
    sfx.tap();
    this.changed();
    if (this.slots.indexOf(null) < 0) this.check();
  }

  remove(i) {
    if (!this.canAct() || i < this.locked || this.slots[i] == null) return;
    this.tiles[this.slots[i]].used = false;
    this.slots[i] = null;
    sfx.back();
    this.changed();
  }

  backspace() {
    for (let i = this.slots.length - 1; i >= this.locked; i--) {
      if (this.slots[i] != null) return this.remove(i);
    }
  }

  // Подсказка ставит на место следующую букву слова (и уменьшает награду).
  hint() {
    if (!this.canAct() || this.hints >= MAX_HINTS) return;
    this.hints++;
    this.tiles.forEach((t) => (t.used = false));
    this.slots.fill(null);
    for (let k = 0; k < this.hints; k++) {
      const t = this.tiles.find((x) => !x.used && x.ch === this.word[k]);
      t.used = true;
      this.slots[k] = t.id;
    }
    this.locked = this.hints;
    sfx.tap();
    this.changed();
  }

  check() {
    const guess = this.slots.map((id) => this.tiles[id].ch).join('');
    if (guess === this.word) {
      this.done = true;
      const ms = Math.round(performance.now() - this.start);
      this.root.classList.add('solved');
      this.render();
      this.onSolve?.({ ms, hints: this.hints });
      return;
    }
    this.busy = true;
    sfx.wrong();
    this.el.slots.classList.remove('shake');
    void this.el.slots.offsetWidth;
    this.el.slots.classList.add('shake');
    setTimeout(() => {
      this.busy = false;
      if (this.done) return;
      for (let i = this.locked; i < this.slots.length; i++) {
        if (this.slots[i] != null) this.tiles[this.slots[i]].used = false;
        this.slots[i] = null;
      }
      this.changed();
    }, 450);
  }

  handleKey(e) {
    if (e.key === 'Backspace') return this.backspace();
    let ch = e.key.length === 1 ? e.key.toUpperCase() : '';
    const cyr = this.tiles?.some((x) => /[А-ЯІЇЄҐ]/.test(x.ch));
    if (cyr && !/[А-ЯІЇЄҐ]/.test(ch)) ch = KEYMAP[e.code] || '';
    if (ch === 'Ё') ch = 'Е';
    if (!ch || !this.tiles) return;
    const t = this.tiles.find((x) => !x.used && x.ch === ch);
    if (t) this.place(t.id);
  }

  tick() {
    const now = performance.now();
    const left = Math.max(0, this.deadline - now);
    const frac = left / this.r.dur;
    this.el.fill.style.transform = `scaleX(${frac})`;
    const sec = Math.ceil(left / 1000);
    this.el.time.textContent = sec;
    this.el.timer.classList.toggle('low', left < 5000);
    if (this.ticks && !this.done && sec <= 3 && sec > 0 && sec !== this.lastTick) {
      this.lastTick = sec;
      sfx.tick();
    }
    if (left <= 0) {
      if (!this.done) {
        this.done = true;
        this.root.classList.add('expired');
        this.render();
      }
      return;
    }
    this.raf = requestAnimationFrame(() => this.tick());
  }

  stopTimer() {
    cancelAnimationFrame(this.raf);
  }

  // res — сообщение 'result' от ведущего; text — что написать игроку.
  showResult(res, { outcome, text }) {
    this.stopTimer();
    this.done = true;
    this.busy = false;
    if (this.r && this.r.i === res.i) {
      // Показываем правильное слово целиком.
      const slotEls = this.el.slots.children;
      [...res.word].forEach((ch, i) => {
        if (slotEls[i]) {
          slotEls[i].textContent = ch;
          slotEls[i].classList.add('filled');
        }
      });
      this.tiles.forEach((t) => (t.used = true));
      [...this.el.tiles.children].forEach((el) => el.classList.add('used'));
    }
    this.root.classList.remove('solved', 'expired');
    this.root.classList.toggle('won', outcome === 'win');
    this.root.classList.toggle('lost', outcome !== 'win');
    this.el.hint.disabled = true;
    this.el.back.disabled = true;
    this.el.msg.className = `board-msg ${outcome}`;
    this.el.msg.innerHTML = text;
    this.el.msg.hidden = false;
  }

  destroy() {
    this.stopTimer();
  }
}
