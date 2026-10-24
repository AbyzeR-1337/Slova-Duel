import { esc, uid } from '../../core/util.js';
import { sfx } from '../../core/sfx.js';
import { avatar, timerBar, stopTimerBar, toast } from '../../ui/common.js';

const COLORS = ['#222222', '#e03131', '#f76707', '#fcc419', '#37b24d', '#1c7ed6', '#7048e8', '#e64980', '#8d6e63', '#868e96'];
const SIZES = [4, 10, 24];
const W = 1000;
const H = 750;
const FLUSH_MS = 70;

export function mount(root, api) {
  const { t } = api;
  root.innerHTML = `
    <div class="cr">
      <div class="cr-top">
        <div class="cr-who"></div>
        <div class="cr-mask"></div>
      </div>
      <div class="timer cr-timer"></div>
      <div class="cr-board">
        <canvas class="cr-canvas" width="${W}" height="${H}"></canvas>
        <div class="cr-feed"></div>
        <div class="cr-over" hidden></div>
      </div>
      <div class="cr-tools" hidden>
        <div class="cr-colors">${COLORS.map((c, i) => `<button class="cr-color ${i ? '' : 'sel'}" data-color="${c}" style="--c:${c}"></button>`).join('')}</div>
        <div class="cr-sizes">${SIZES.map((s, i) => `<button class="cr-size ${i === 1 ? 'sel' : ''}" data-size="${s}"><i style="--s:${s / 2 + 4}px"></i></button>`).join('')}
          <button class="cr-tool" data-tool="eraser" aria-label="${t('croc.eraser')}">🧽</button>
          <button class="cr-tool" data-tool="undo" aria-label="${t('croc.undo')}">↶</button>
          <button class="cr-tool" data-tool="clear" aria-label="${t('croc.clear')}">🗑️</button></div>
      </div>
      <form class="cr-guess" hidden autocomplete="off">
        <input class="cr-input" maxlength="40" enterkeyhint="send" placeholder="${t('croc.guessPh')}">
        <button class="btn primary" type="submit">➤</button>
      </form>
      <div class="cr-scores"></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const canvas = $('.cr-canvas');
  const g = canvas.getContext('2d');
  const feed = $('.cr-feed');
  const over = $('.cr-over');
  const input = $('.cr-input');
  let st = null;
  let word = null;
  let options = null;
  let strokes = [];
  const mine = new Set();
  let color = COLORS[0];
  let size = SIZES[1];
  let eraser = false;
  let current = null;
  let pendingPts = [];
  let flushTimer = null;
  let feedItems = [];

  const isDrawer = () => st?.drawer === api.me && st.phase === 'draw';
  const name = (id) => esc(api.seat(id)?.name || '?');

  /* ---------- холст ---------- */

  function clearCanvas() {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W, H);
  }

  function seg(s, from) {
    const p = s.p;
    g.strokeStyle = s.c;
    g.fillStyle = s.c;
    g.lineWidth = s.w;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    if (p.length === 2 && from === 0) {
      g.beginPath();
      g.arc(p[0], p[1], s.w / 2, 0, Math.PI * 2);
      g.fill();
      return;
    }
    g.beginPath();
    const start = Math.max(0, from - 2);
    g.moveTo(p[start], p[start + 1]);
    for (let i = start + 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
    g.stroke();
  }

  function redraw() {
    clearCanvas();
    for (const s of strokes) seg(s, 0);
  }

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * W), Math.round(((e.clientY - r.top) / r.height) * H)];
  }

  function flush() {
    if (!current || !pendingPts.length) return;
    api.act({ t: 'stroke', id: current.id, c: current.c, w: current.w, p: pendingPts, n: current.fresh });
    current.fresh = false;
    pendingPts = [];
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!isDrawer()) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    current = { id: uid().slice(0, 8), c: eraser ? '#ffffff' : color, w: eraser ? 40 : size, p: [x, y], fresh: true };
    mine.add(current.id);
    strokes.push(current);
    pendingPts = [x, y];
    seg(current, 0);
    clearInterval(flushTimer);
    flushTimer = setInterval(flush, FLUSH_MS);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!current || !isDrawer()) return;
    e.preventDefault();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events) {
      const [x, y] = pos(ev);
      const p = current.p;
      if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) < 3) continue;
      p.push(x, y);
      pendingPts.push(x, y);
      seg(current, p.length - 2);
    }
  });
  const end = () => {
    if (!current) return;
    flush();
    clearInterval(flushTimer);
    current = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  root.querySelector('.cr-tools').addEventListener('click', (e) => {
    const c = e.target.closest('[data-color]');
    const s = e.target.closest('[data-size]');
    const tool = e.target.closest('[data-tool]')?.dataset.tool;
    if (c) {
      color = c.dataset.color;
      eraser = false;
    }
    if (s) size = +s.dataset.size;
    if (tool === 'eraser') eraser = !eraser;
    if (tool === 'undo') api.act({ t: 'undo' });
    if (tool === 'clear') api.act({ t: 'clear' });
    root.querySelectorAll('.cr-color').forEach((b) => b.classList.toggle('sel', !eraser && b.dataset.color === color));
    root.querySelectorAll('.cr-size').forEach((b) => b.classList.toggle('sel', +b.dataset.size === size));
    root.querySelector('[data-tool="eraser"]').classList.toggle('sel', eraser);
  });

  /* ---------- угадывание ---------- */

  $('.cr-guess').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    api.act({ t: 'guess', text });
    input.value = '';
  });

  function addFeed(html, cls = '') {
    feedItems.push({ html, cls, at: Date.now() });
    feedItems = feedItems.slice(-6);
    feed.innerHTML = feedItems.map((f) => `<div class="cr-line ${f.cls}">${f.html}</div>`).join('');
  }

  /* ---------- отрисовка состояния ---------- */

  function renderScores() {
    $('.cr-scores').innerHTML = api.seats
      .map((s) => {
        const mark = s.id === st.drawer ? '✏️' : st.guessed.includes(s.id) ? '✅' : '';
        return `<div class="cr-chip ${s.id === api.me ? 'me' : ''}" style="--pc:${s.color}">${avatar(s, 24)}<span>${esc(s.name)}</span><b>${st.scores[s.id] ?? 0}</b><i>${mark}</i></div>`;
      })
      .join('');
  }

  function render() {
    if (!st) return;
    api.setInfo(t('croc.round', { r: st.round, n: st.rounds }));
    const drawer = api.seat(st.drawer);
    $('.cr-who').innerHTML = drawer ? `${avatar(drawer, 30)} <span>${st.drawer === api.me ? t('croc.youDraw') : t('croc.draws', { name: name(st.drawer) })}</span>` : '';
    const mask = st.drawer === api.me && word && st.phase === 'draw' ? word : st.mask;
    $('.cr-mask').innerHTML = mask ? [...mask].map((ch) => (ch === ' ' ? '<i class="sp"></i>' : `<b>${esc(ch === '_' ? '' : ch)}</b>`)).join('') : '';
    $('.cr-mask').classList.toggle('mine', st.drawer === api.me);
    const timer = $('.cr-timer');
    if (st.left != null) timerBar(timer, st.left, st.total);
    else stopTimerBar(timer);
    $('.cr-tools').hidden = !isDrawer();
    const seated = api.seats.some((s) => s.id === api.me);
    const canGuess = seated && st.phase === 'draw' && st.drawer !== api.me;
    const guessed = st.guessed.includes(api.me);
    $('.cr-guess').hidden = !canGuess;
    input.disabled = guessed;
    input.placeholder = guessed ? t('croc.guessed') : t('croc.guessPh');
    canvas.classList.toggle('drawing', isDrawer());
    if (st.phase === 'choose') {
      over.hidden = false;
      over.innerHTML =
        st.drawer === api.me && options
          ? `<div class="cr-choose"><p>${t('croc.choose')}</p>${options.map((w, i) => `<button class="btn big" data-choose="${i}">${esc(w)}</button>`).join('')}</div>`
          : `<div class="cr-choose"><p>${t('croc.choosing', { name: name(st.drawer) })}</p></div>`;
    } else if (st.phase !== 'reveal') over.hidden = true;
    renderScores();
  }

  over.addEventListener('click', (e) => {
    const b = e.target.closest('[data-choose]');
    if (b) api.act({ t: 'choose', i: +b.dataset.choose });
  });

  clearCanvas();

  return {
    msg(d) {
      switch (d.t) {
        case 'state': {
          const was = st;
          st = d;
          if (was && was.turn !== d.turn) {
            word = null;
            options = null;
            feedItems = [];
            feed.innerHTML = '';
          }
          if (was?.phase === 'choose' && d.phase === 'draw' && d.drawer === api.me) sfx.go();
          render();
          break;
        }
        case 'options':
          options = d.words;
          render();
          break;
        case 'word':
          word = d.word;
          render();
          break;
        case 'strokes':
          strokes = d.list.map((s) => ({ ...s, p: s.p.slice() }));
          redraw();
          break;
        case 's': {
          if (mine.has(d.id)) break;
          let s = strokes.find((x) => x.id === d.id);
          if (d.n || !s) {
            s = { id: d.id, c: d.c, w: d.w, p: [] };
            strokes.push(s);
          }
          const from = s.p.length;
          s.p.push(...d.p);
          seg(s, from);
          break;
        }
        case 'undo':
          strokes.pop();
          redraw();
          break;
        case 'clear':
          strokes = [];
          redraw();
          break;
        case 'chat':
          addFeed(`<b>${name(d.id)}:</b> ${esc(d.text)}`);
          break;
        case 'close':
          toast(t('croc.close'));
          sfx.tick();
          break;
        case 'correct':
          addFeed(`✅ ${t('croc.gotIt', { name: name(d.id) })} +${d.pts}`, 'ok');
          if (d.id === api.me) sfx.win();
          else sfx.tap();
          break;
        case 'reveal':
          over.hidden = false;
          over.innerHTML = `<div class="cr-reveal"><p>${t('croc.itWas')}</p><b>${esc(d.word || '')}</b><p class="muted">${
            Object.keys(d.guessed).length ? Object.entries(d.guessed).map(([id, pts]) => `${name(id)} +${pts}`).join(' · ') : t('croc.nobody')
          }</p></div>`;
          sfx.timeout();
          break;
      }
    },
    destroy() {
      clearInterval(flushTimer);
    },
  };
}
