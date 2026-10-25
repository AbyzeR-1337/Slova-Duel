import { esc } from '../../core/util.js';
import { sfx } from '../../core/sfx.js';
import { avatar, confirmBox } from '../../ui/common.js';
import { play } from './rules.js';

// Доска го — SVG: линии, звёздные пункты, камни. На больших досках первый
// тап ставит «призрак» камня, второй — подтверждает ход.
const STARS = {
  9: [2, 4, 6],
  13: [3, 6, 9],
  19: [3, 9, 15],
};

export function mount(root, api) {
  const { t } = api;
  root.innerHTML = `
    <div class="bd">
      <div class="bd-player bd-top"></div>
      <div class="bd-board go-board"><svg class="go-svg"></svg></div>
      <div class="bd-player bd-bottom"></div>
      <div class="bd-status"></div>
      <div class="bd-actions"></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const svg = $('.go-svg');
  let st = null;
  let ghost = -1;

  const myColor = () => (st?.sides.b === api.me ? 'b' : st?.sides.w === api.me ? 'w' : null);
  const name = (id) => esc(api.seat(id)?.name || '?');
  const state = () => ({ n: st.n, b: st.board.split('').map(Number), turn: st.turn === 'b' ? 1 : 2, ko: st.ko, passes: st.passes, caps: { 1: st.caps.b, 2: st.caps.w }, moves: st.moves, last: st.last });

  function playerRow(color) {
    const p = api.seat(st.sides[color]);
    const turn = !st.result && st.turn === color;
    const extra = color === 'w' ? ` · ${t('go.komi', { n: st.komi })}` : '';
    const score = st.result?.score ? ` · <b>${st.result.score[color]}</b>` : '';
    return `<div class="bd-who ${turn ? 'turn' : ''}">${avatar(p, 34)}<b>${esc(p?.name || '?')}</b><i class="go-mini ${color}"></i></div>
      <div class="bd-cap">${t('go.caps', { n: st.caps[color] })}${extra}${score}</div>`;
  }

  function status() {
    if (st.result) {
      const w = st.result.winner;
      const id = st.sides[w];
      const sc = st.result.score ? ` ${st.result.score.b} : ${st.result.score.w}` : '';
      if (id === api.me) return `🏆 ${t('chess.youWin')}${sc ? ' ·' + sc : ''}`;
      if (st.result.reason === 'resign') return myColor() ? `${t('chess.youLose')} · ${t('chess.why.resign')}` : t('chess.wins', { name: name(id) });
      return `${myColor() ? t('chess.youLose') : t('chess.wins', { name: name(id) })} ·${sc}`;
    }
    const mover = st.sides[st.turn];
    const passed = st.passes ? ` · ${t('go.passed')}` : '';
    if (mover === api.me) return (ghost >= 0 ? t('go.confirm') : t('chess.yourMove')) + passed;
    return t('chess.thinks', { name: name(mover) }) + passed;
  }

  function render() {
    const n = st.n;
    const size = 100;
    const cell = size / n;
    const off = cell / 2;
    const xy = (i) => [off + (i % n) * cell, off + Math.floor(i / n) * cell];
    const lines = [];
    for (let k = 0; k < n; k++) {
      const p = off + k * cell;
      lines.push(`<line x1="${off}" y1="${p}" x2="${size - off}" y2="${p}"/><line x1="${p}" y1="${off}" x2="${p}" y2="${size - off}"/>`);
    }
    const stars = (STARS[n] || []).flatMap((a) => (STARS[n] || []).map((c) => `<circle class="go-star" cx="${off + c * cell}" cy="${off + a * cell}" r="${cell * 0.12}"/>`));
    const stones = [];
    const b = st.board;
    for (let i = 0; i < n * n; i++) {
      const [x, y] = xy(i);
      if (b[i] !== '0') stones.push(`<circle class="go-stone ${b[i] === '1' ? 'b' : 'w'}" cx="${x}" cy="${y}" r="${cell * 0.47}"/>`);
      if (st.territory && st.territory[i] !== '.' && b[i] === '0') stones.push(`<rect class="go-terr ${st.territory[i]}" x="${x - cell * 0.18}" y="${y - cell * 0.18}" width="${cell * 0.36}" height="${cell * 0.36}"/>`);
    }
    if (st.last >= 0) {
      const [x, y] = xy(st.last);
      stones.push(`<circle class="go-last ${b[st.last] === '1' ? 'on-b' : 'on-w'}" cx="${x}" cy="${y}" r="${cell * 0.18}"/>`);
    }
    if (ghost >= 0) {
      const [x, y] = xy(ghost);
      stones.push(`<circle class="go-stone ghost ${myColor()}" cx="${x}" cy="${y}" r="${cell * 0.47}"/>`);
    }
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.innerHTML = `<rect class="go-wood" x="0" y="0" width="${size}" height="${size}" rx="1.5"/><g class="go-lines" stroke-width="${n > 13 ? 0.18 : 0.25}">${lines.join('')}</g>${stars.join('')}${stones.join('')}`;
    $('.bd-bottom').innerHTML = playerRow(myColor() === 'w' ? 'w' : 'b');
    $('.bd-top').innerHTML = playerRow(myColor() === 'w' ? 'b' : 'w');
    $('.bd-status').textContent = status();
    const mine = myColor() && !st.result;
    $('.bd-actions').innerHTML = mine
      ? `<button class="btn small" data-a="pass" ${st.turn !== myColor() ? 'disabled' : ''}>✋ ${t('go.pass')}</button><button class="btn small" data-a="resign">🏳️ ${t('chess.resign')}</button>`
      : '';
    api.setInfo(`${n}×${n} · ${t('chess.moveNo', { n: st.moves + 1 })}`);
  }

  svg.addEventListener('click', (e) => {
    if (!st || st.result || st.turn !== myColor()) return;
    const r = svg.getBoundingClientRect();
    const n = st.n;
    const fx = Math.floor(((e.clientX - r.left) / r.width) * n);
    const fy = Math.floor(((e.clientY - r.top) / r.height) * n);
    if (fx < 0 || fy < 0 || fx >= n || fy >= n) return;
    const i = fy * n + fx;
    if (!play(state(), i)) {
      sfx.wrong();
      ghost = -1;
      return render();
    }
    if (n > 9 && ghost !== i) {
      ghost = i;
      sfx.tap();
      return render();
    }
    ghost = -1;
    api.act({ t: 'play', i });
    sfx.card();
  });

  root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'pass' && (await confirmBox(t('go.passConfirm'), t('go.pass')))) api.act({ t: 'pass' });
    if (a === 'resign' && (await confirmBox(t('chess.resignConfirm'), t('chess.resign')))) api.act({ t: 'resign' });
  });

  return {
    msg(d) {
      if (d.t !== 'state') return;
      const prev = st?.moves;
      st = d;
      ghost = -1;
      if (prev != null && prev !== d.moves) {
        sfx.card();
        if (d.turn === myColor()) sfx.turn();
      }
      render();
    },
    destroy() {},
  };
}
