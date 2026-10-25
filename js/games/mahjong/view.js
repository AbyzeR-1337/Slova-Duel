import { esc } from '../../core/util.js';
import { sfx } from '../../core/sfx.js';
import { avatar, timerBar, stopTimerBar, toast } from '../../ui/common.js';
import { isFree, matches, moves } from './tiles.js';

// Лица костей: цифры мастей крупно, чтобы читались на телефоне.
const WIND = { E: '東', S: '南', W: '西', N: '北' };
const FLOWER = { f1: '🌸', f2: '🌼', f3: '🌺', f4: '🌻', s1: '🌱', s2: '☀️', s3: '🍂', s4: '❄️' };
const DRAGON = { r: '中', g: '發', w: '▢' };

export function face(k) {
  if (FLOWER[k]) return `<span class="mj-emo">${FLOWER[k]}</span>`;
  const s = k[0];
  const v = k[1];
  if (s === 'c') return `<b class="mj-num red">${v}</b><small class="red">萬</small>`;
  if (s === 'b') return `<b class="mj-num green">${v}</b><small>🎋</small>`;
  if (s === 'p') return `<b class="mj-num blue">${v}</b><small class="blue">◎</small>`;
  if (s === 'w') return `<b class="mj-han">${WIND[v]}</b><small>${v}</small>`;
  if (s === 'D') return `<b class="mj-han ${v === 'r' ? 'red' : v === 'g' ? 'green' : 'blue'}">${DRAGON[v]}</b>`;
  return k;
}

export function mount(root, api) {
  const { t } = api;
  root.innerHTML = `
    <div class="mj">
      <div class="mj-race"></div>
      <div class="timer mj-timer"></div>
      <div class="mj-wrap"><div class="mj-board"></div></div>
      <div class="mj-status"></div>
      <div class="mj-actions">
        <button class="btn" data-a="hint">💡 <span class="mj-hints"></span></button>
        <button class="btn" data-a="shuffle">🔀 ${t('mahjong.shuffle')}</button>
      </div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const boardEl = $('.mj-board');
  const wrap = $('.mj-wrap');
  let pos = null;
  let kinds = [];
  let st = null;
  let sel = -1;
  let hint = null;
  let hints = 3;
  const pending = new Set();
  const limit = (Number(api.settings.time) || 5) * 60000;
  let geo = null;

  const present = () => kinds.map((k, i) => !!k && !pending.has(i));
  const playing = () => st && !st.over && st.players.some((p) => p.id === api.me);

  function layoutGeo() {
    const W = Math.max(...pos.map((p) => p.x)) + 2;
    const H = Math.max(...pos.map((p) => p.y)) + 2;
    const Z = Math.max(...pos.map((p) => p.z)) + 1;
    const avW = wrap.clientWidth - 8;
    const avH = wrap.clientHeight - 8;
    // Ширина кости по ширине и высоте доступного места (кость 1 : 1.3).
    const tw = Math.max(18, Math.min(64, avW / (W / 2 + 0.25), avH / ((H / 2) * 1.3 + 0.25)));
    const th = tw * 1.3;
    const lift = tw * 0.09;
    geo = { tw, th, lift, w: (W / 2) * tw + Z * lift, h: (H / 2) * th + Z * lift, Z };
  }

  function render() {
    if (!pos) return;
    if (!geo) layoutGeo();
    const { tw, th, lift, w, h, Z } = geo;
    boardEl.style.width = `${w}px`;
    boardEl.style.height = `${h}px`;
    boardEl.style.setProperty('--tw', `${tw}px`);
    const pr = present();
    const html = [];
    for (let i = 0; i < pos.length; i++) {
      if (!pr[i]) continue;
      const p = pos[i];
      const free = isFree(pos, pr, i);
      const x = (p.x / 2) * tw + (Z - p.z) * lift;
      const y = (p.y / 2) * th + (Z - p.z) * lift;
      const cls = ['mj-tile', free ? 'free' : 'blocked', i === sel ? 'sel' : '', hint && (hint.a === i || hint.b === i) ? 'hint' : ''].join(' ');
      html.push(`<button class="${cls}" data-i="${i}" style="left:${x}px;top:${y}px;width:${tw}px;height:${th}px;z-index:${p.z * 1000 + p.y * 20 + p.x}">${face(kinds[i])}</button>`);
    }
    boardEl.innerHTML = html.join('');
    $('.mj-hints').textContent = `${t('mahjong.hint')} · ${hints}`;
    $('[data-a="hint"]').disabled = !hints || !playing();
    $('[data-a="shuffle"]').disabled = !playing();
    renderRace();
  }

  function renderRace() {
    if (!st) return;
    const list = st.players.slice().sort((a, b) => a.left - b.left);
    $('.mj-race').innerHTML = list
      .map((p) => {
        const s = api.seat(p.id);
        const done = st.total - p.left;
        return `<div class="mj-runner ${p.id === api.me ? 'me' : ''}" style="--pc:${s?.color}">${avatar(s, 26)}<span class="mj-rname">${esc(s?.name || '?')}</span><b>${p.left}</b>
          <i class="mj-prog" style="width:${(done / st.total) * 100}%"></i></div>`;
      })
      .join('');
    let status = '';
    if (st.over) {
      const w = st.over.winner;
      status = w ? (w === api.me ? `🏆 ${t('mahjong.youWin')}` : t('mahjong.won', { name: esc(api.seat(w)?.name || '?') })) : t('mahjong.timeUp');
    } else if (!st.players.some((p) => p.id === api.me)) status = t('game.spectating');
    else status = t('mahjong.left', { n: st.players.find((p) => p.id === api.me)?.left ?? 0 });
    $('.mj-status').textContent = status;
    if (st.left != null && !st.over) timerBar($('.mj-timer'), st.left, limit);
    else stopTimerBar($('.mj-timer'));
    api.setInfo(t('mahjong.size.' + (api.settings.size || 'small')));
  }

  boardEl.addEventListener('click', (e) => {
    const el = e.target.closest('[data-i]');
    if (!el || !playing()) return;
    const i = Number(el.dataset.i);
    const pr = present();
    if (!isFree(pos, pr, i)) {
      sfx.wrong();
      el.classList.add('nope');
      setTimeout(() => el.classList.remove('nope'), 300);
      return;
    }
    if (sel === i) {
      sel = -1;
      return render();
    }
    if (sel >= 0 && matches(kinds[sel], kinds[i])) {
      api.act({ t: 'pair', a: sel, b: i });
      pending.add(sel);
      pending.add(i);
      sel = -1;
      hint = null;
      sfx.card();
      if (!moves(pos, kinds.map((k, j) => (pending.has(j) ? null : k))).length && pr.filter(Boolean).length > 2) toast(t('mahjong.noMoves'));
      return render();
    }
    sel = i;
    sfx.tap();
    render();
  });

  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a || !playing()) return;
    api.act({ t: a });
    sel = -1;
  });

  const onResize = () => {
    geo = null;
    render();
  };
  window.addEventListener('resize', onResize);

  return {
    msg(d) {
      if (d.t === 'layout') {
        pos = d.pos;
        kinds = d.kinds.slice();
        pending.clear();
        geo = null;
        requestAnimationFrame(render);
      } else if (d.t === 'board') {
        kinds = d.kinds.slice();
        hints = d.hints;
        pending.clear();
        if (sel >= 0 && !kinds[sel]) sel = -1;
        if (d.shuffled) toast(d.shuffled === 'auto' ? t('mahjong.autoShuffle') : t('mahjong.shuffled'));
        render();
      } else if (d.t === 'hint') {
        hint = d;
        hints = d.hints;
        render();
      } else if (d.t === 'state') {
        st = d;
        render();
      }
    },
    destroy() {
      window.removeEventListener('resize', onResize);
    },
  };
}
