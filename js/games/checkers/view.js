import { esc } from '../../core/util.js';
import { sfx } from '../../core/sfx.js';
import { avatar, confirmBox } from '../../ui/common.js';
import { legalMoves, colorOf } from './rules.js';

export function mount(root, api) {
  const { t, tn } = api;
  root.innerHTML = `
    <div class="bd">
      <div class="bd-player bd-top"></div>
      <div class="bd-board ck-board"></div>
      <div class="bd-player bd-bottom"></div>
      <div class="bd-status"></div>
      <div class="bd-actions"></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const boardEl = $('.bd-board');
  let st = null;
  let b = [];
  let moves = [];
  let sel = -1;

  const myColor = () => (st?.sides.w === api.me ? 'w' : st?.sides.b === api.me ? 'b' : null);
  const flip = () => myColor() === 'b';
  const name = (id) => esc(api.seat(id)?.name || '?');
  const count = (c) => b.filter((p) => colorOf(p) === c).length;

  function playerRow(color) {
    const p = api.seat(st.sides[color]);
    const lost = 12 - count(color);
    const turn = !st.result && st.turn === color;
    return `<div class="bd-who ${turn ? 'turn' : ''}">${avatar(p, 34)}<b>${esc(p?.name || '?')}</b><i class="ck-man ${color} mini"></i></div>
      <div class="bd-cap">${lost ? tn('checkers.lost', lost) : ''}</div>`;
  }

  function status() {
    if (st.result) {
      const w = st.result.winner;
      if (!w) return t('checkers.draw');
      const id = st.sides[w];
      if (id === api.me) return `🏆 ${t('chess.youWin')}`;
      return myColor() ? t('chess.youLose') + (st.result.reason === 'resign' ? ` · ${t('chess.why.resign')}` : '') : t('chess.wins', { name: name(id) });
    }
    const mover = st.sides[st.turn];
    if (mover !== api.me) return t('chess.thinks', { name: name(mover) });
    return moves[0]?.taken.length ? t('checkers.mustCapture') : t('chess.yourMove');
  }

  function render() {
    const targets = new Map();
    for (const m of moves.filter((x) => x.path[0] === sel)) targets.set(m.path.at(-1), m);
    const via = new Set(moves.filter((x) => x.path[0] === sel).flatMap((m) => m.path.slice(1, -1)));
    const movable = new Set(moves.map((m) => m.path[0]));
    const lastPath = new Set(st.last?.path || []);
    const html = [];
    for (let vr = 0; vr < 8; vr++) {
      for (let vf = 0; vf < 8; vf++) {
        const r = flip() ? vr : 7 - vr;
        const f = flip() ? 7 - vf : vf;
        const i = r * 8 + f;
        const p = b[i];
        const dark = (r + f) % 2 === 0;
        const cls = [dark ? 'dk' : 'lt', lastPath.has(i) ? 'last' : '', i === sel ? 'sel' : '', targets.has(i) ? 'dot' : '', via.has(i) ? 'via' : '', movable.has(i) && sel < 0 ? 'can' : ''].join(' ');
        html.push(`<button class="sq ${cls}" data-i="${i}">${p ? `<i class="ck-man ${colorOf(p)} ${p === 'W' || p === 'B' ? 'king' : ''}"></i>` : ''}</button>`);
      }
    }
    boardEl.innerHTML = html.join('');
    $('.bd-bottom').innerHTML = playerRow(flip() ? 'b' : 'w');
    $('.bd-top').innerHTML = playerRow(flip() ? 'w' : 'b');
    $('.bd-status').textContent = status();
    $('.bd-actions').innerHTML = myColor() && !st.result ? `<button class="btn small" data-a="resign">🏳️ ${t('chess.resign')}</button>` : '';
    api.setInfo(t('chess.moveNo', { n: Math.floor(st.count / 2) + 1 }));
  }

  boardEl.addEventListener('click', (e) => {
    const el = e.target.closest('[data-i]');
    if (!el || !st || st.result || st.turn !== myColor()) return;
    const i = Number(el.dataset.i);
    const m = moves.find((x) => x.path[0] === sel && x.path.at(-1) === i);
    if (m) {
      api.act({ t: 'move', path: [m.path[0], i] });
      sfx.card();
      sel = -1;
      return;
    }
    if (moves.some((x) => x.path[0] === i)) {
      sel = sel === i ? -1 : i;
      sfx.tap();
    } else {
      if (colorOf(b[i]) === myColor()) sfx.wrong();
      sel = -1;
    }
    render();
  });

  root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]');
    if (a?.dataset.a === 'resign' && (await confirmBox(t('chess.resignConfirm'), t('chess.resign')))) api.act({ t: 'resign' });
  });

  return {
    msg(d) {
      if (d.t !== 'state') return;
      const prev = st?.count;
      st = d;
      b = d.board.split('').map((c) => (c === '.' ? '' : c));
      moves = !d.result && d.turn === myColor() ? legalMoves({ b, turn: d.turn, quiet: 0 }) : [];
      // Ходить можно только одной шашкой — выбираем её сразу.
      const from = new Set(moves.map((m) => m.path[0]));
      sel = from.size === 1 ? [...from][0] : from.has(sel) ? sel : -1;
      if (prev != null && prev !== d.count) {
        sfx.card();
        if (d.turn === myColor()) sfx.turn();
      }
      render();
    },
    destroy() {},
  };
}
