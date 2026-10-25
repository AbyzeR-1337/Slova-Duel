import { esc } from '../../core/util.js';
import { sfx } from '../../core/sfx.js';
import { avatar, modal, confirmBox } from '../../ui/common.js';
import { parseFen, legalMoves, colorOf, sqName } from './rules.js';

// Фигуры рисуем закрашенными символами и красим через CSS; ︎ — чтобы
// iPhone не превращал пешку в эмодзи.
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const glyph = (p) => GLYPH[p.toLowerCase()] + '︎';
const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };

export function mount(root, api) {
  const { t } = api;
  root.innerHTML = `
    <div class="bd">
      <div class="bd-player bd-top"></div>
      <div class="bd-board ch-board"></div>
      <div class="bd-player bd-bottom"></div>
      <div class="bd-status"></div>
      <div class="bd-moves"></div>
      <div class="bd-actions"></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const boardEl = $('.bd-board');
  let st = null;
  let s = null;
  let moves = [];
  let sel = -1;
  let clockTimer = null;
  let clockBase = 0;

  const myColor = () => (st?.white === api.me ? 'w' : st?.black === api.me ? 'b' : null);
  const flip = () => myColor() === 'b';
  const name = (id) => esc(api.seat(id)?.name || '?');

  // Сколько фигур съедено у каждой стороны.
  function captured() {
    const left = { w: {}, b: {} };
    for (const p of s.b) if (p && p.toLowerCase() !== 'k') left[colorOf(p)][p.toLowerCase()] = (left[colorOf(p)][p.toLowerCase()] || 0) + 1;
    const lost = { w: [], b: [] };
    let mat = 0;
    for (const c of ['w', 'b']) {
      for (const k of 'qrbnp') {
        const n = Math.max(0, START_COUNT[k] - (left[c][k] || 0));
        for (let i = 0; i < n; i++) lost[c].push(k);
        mat += (c === 'w' ? -1 : 1) * n * VALUE[k];
      }
    }
    return { lost, mat };
  }

  function fmtClock(ms) {
    const sec = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }

  function playerRow(color) {
    const id = color === 'w' ? st.white : st.black;
    const p = api.seat(id);
    const { lost, mat } = captured();
    // Под игроком — фигуры соперника, которые он съел.
    const eaten = lost[color === 'w' ? 'b' : 'w'];
    const adv = color === 'w' ? mat : -mat;
    const clock = st.clocks ? `<span class="bd-clock ${st.running === color ? 'run' : ''}" data-clock="${color}">${fmtClock(st.clocks[color])}</span>` : '';
    const turn = !st.result && s.turn === color;
    return `<div class="bd-who ${turn ? 'turn' : ''}">${avatar(p, 34)}<b>${esc(p?.name || '?')}</b><i class="ch-dot ${color}"></i></div>
      <div class="bd-cap ch-cap ${color === 'w' ? 'eat-b' : 'eat-w'}">${eaten.map((k) => `<span>${glyph(k)}</span>`).join('')}${adv > 0 ? `<small>+${adv}</small>` : ''}</div>${clock}`;
  }

  function status() {
    if (st.result) {
      const r = st.result;
      if (!r.winner) return t('chess.draw.' + r.reason);
      const win = r.winner === 'w' ? st.white : st.black;
      const why = t('chess.why.' + r.reason);
      return win === api.me ? `🏆 ${t('chess.youWin')} · ${why}` : myColor() ? `${t('chess.youLose')} · ${why}` : `${t('chess.wins', { name: name(win) })} · ${why}`;
    }
    const mover = s.turn === 'w' ? st.white : st.black;
    if (mover === api.me) return st.check ? `⚠️ ${t('chess.checkYou')}` : t('chess.yourMove');
    return `${st.check ? '⚠️ ' + t('chess.check') + ' · ' : ''}${t('chess.thinks', { name: name(mover) })}`;
  }

  function renderBoard() {
    const kingInCheck = st.check ? s.b.findIndex((p) => p === (s.turn === 'w' ? 'K' : 'k')) : -1;
    const targets = new Set(moves.filter((m) => m.from === sel).map((m) => m.to));
    const html = [];
    for (let vr = 0; vr < 8; vr++) {
      for (let vf = 0; vf < 8; vf++) {
        const r = flip() ? vr : 7 - vr;
        const f = flip() ? 7 - vf : vf;
        const i = r * 8 + f;
        const p = s.b[i];
        const dark = (r + f) % 2 === 0;
        const cls = [dark ? 'dk' : 'lt', st.last && (st.last.from === i || st.last.to === i) ? 'last' : '', i === sel ? 'sel' : '', targets.has(i) ? (p ? 'hit' : 'dot') : '', i === kingInCheck ? 'chk' : ''].join(' ');
        const coord = (vf === 0 ? `<em class="rk">${r + 1}</em>` : '') + (vr === 7 ? `<em class="fl">${'abcdefgh'[f]}</em>` : '');
        html.push(`<button class="sq ${cls}" data-i="${i}" aria-label="${sqName(i)}">${p ? `<span class="pc8 ${colorOf(p)}">${glyph(p)}</span>` : ''}${coord}</button>`);
      }
    }
    boardEl.innerHTML = html.join('');
  }

  function render() {
    if (!st) return;
    $('.bd-bottom').innerHTML = playerRow(flip() ? 'b' : 'w');
    $('.bd-top').innerHTML = playerRow(flip() ? 'w' : 'b');
    renderBoard();
    $('.bd-status').textContent = status();
    // Последние ходы: номер хода перед ходом белых, «…» — если список начинается с хода чёрных.
    const log = st.log || [];
    const shown = log.slice(-8);
    const ply0 = st.moves - shown.length;
    $('.bd-moves').innerHTML = shown
      .map((m, k) => {
        const ply = ply0 + k;
        const no = ply % 2 === 0 ? `<b>${ply / 2 + 1}.</b>` : k === 0 ? `<b>${(ply + 1) / 2}…</b>` : '';
        return `${no}<span>${esc(m)}</span>`;
      })
      .join(' ');
    $('.bd-actions').innerHTML = myColor() && !st.result ? `<button class="btn small" data-a="resign">🏳️ ${t('chess.resign')}</button>` : '';
    api.setInfo(t('chess.moveNo', { n: Math.floor(st.moves / 2) + 1 }));
    tickClocks();
  }

  function tickClocks() {
    clearInterval(clockTimer);
    if (!st.clocks || !st.running) return;
    const base = st.clocks[st.running];
    const color = st.running;
    clockBase = performance.now();
    clockTimer = setInterval(() => {
      const el = root.querySelector(`[data-clock="${color}"]`);
      if (el) el.textContent = fmtClock(base - (performance.now() - clockBase));
    }, 250);
  }

  async function tryMove(from, to) {
    const opts = moves.filter((m) => m.from === from && m.to === to);
    if (!opts.length) return false;
    let promo;
    if (opts.some((m) => m.promo)) {
      const color = myColor();
      const pick = await modal({
        title: t('chess.promote'),
        html: `<div class="ch-promo">${'qrbn'.split('').map((k) => `<span class="pc8 ${color}">${glyph(k)}</span>`).join('')}</div>`,
        buttons: 'qrbn'.split('').map((k) => ({ id: k, label: glyph(k), primary: k === 'q' })),
      });
      if (!pick) return true;
      promo = pick;
    }
    api.act({ t: 'move', from, to, promo });
    sfx.card();
    sel = -1;
    return true;
  }

  boardEl.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-i]');
    if (!b || !st || st.result) return;
    const i = Number(b.dataset.i);
    const mine = myColor();
    if (!mine || s.turn !== mine) return;
    if (sel >= 0 && i !== sel && (await tryMove(sel, i))) return;
    if (colorOf(s.b[i]) === mine && moves.some((m) => m.from === i)) {
      sel = sel === i ? -1 : i;
      sfx.tap();
    } else {
      sel = -1;
      if (s.b[i]) sfx.wrong();
    }
    renderBoard();
  });

  root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]');
    if (a?.dataset.a === 'resign' && (await confirmBox(t('chess.resignConfirm'), t('chess.resign')))) api.act({ t: 'resign' });
  });

  return {
    msg(d) {
      if (d.t !== 'state') return;
      const prevMoves = st?.moves;
      st = d;
      s = parseFen(d.fen);
      moves = myColor() === s.turn && !d.result ? legalMoves(s) : [];
      if (sel >= 0 && !moves.some((m) => m.from === sel)) sel = -1;
      if (prevMoves != null && d.moves !== prevMoves) {
        if (d.check) sfx.wrong();
        else sfx.card();
        if (myColor() === s.turn) sfx.turn();
      }
      render();
    },
    destroy() {
      clearInterval(clockTimer);
    },
  };
}
