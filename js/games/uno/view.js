import { esc } from '../../core/util.js';
import { sfx } from '../../core/sfx.js';
import { avatar, modal, timerBar, stopTimerBar, toast } from '../../ui/common.js';
import { COLORS } from './engine.js';

const SYM = { S: '⊘', R: '⇄', D: '+2', W: '✦', F: '+4' };
const COLOR_HEX = { r: '#e03131', y: '#f5b800', g: '#2f9e44', b: '#1971c2' };
const DOT = { r: '🔴', y: '🟡', g: '🟢', b: '🔵' };

export function unoCard(c, cls = '') {
  if (!c) return `<div class="uc back ${cls}"><span>UNO</span></div>`;
  const v = SYM[c[1]] || c[1];
  return `<div class="uc c-${c[0]} ${cls}"><em>${v}</em><span>${v}</span><em class="rb">${v}</em></div>`;
}

export function mount(root, api) {
  const { t, tn } = api;
  root.innerHTML = `
    <div class="un">
      <div class="un-opps"></div>
      <div class="un-mid">
        <button class="un-pile" data-a="draw"><div class="uc back"><span>UNO</span></div><b class="un-pilen"></b></button>
        <div class="un-top"></div>
        <div class="un-info"><div class="un-color"></div><div class="un-dir"></div></div>
      </div>
      <div class="un-status"></div>
      <div class="timer un-timer"></div>
      <div class="un-hand"></div>
      <div class="un-actions"></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  let st = null;
  let hand = [];
  let drawn = null;
  let lastEvent = '';

  const name = (id) => esc(api.seat(id)?.name || '?');
  const myTurn = () => st && !st.over && st.turn === api.me;
  const me = () => st?.players.find((p) => p.id === api.me);

  function playable(c) {
    if (!myTurn()) return false;
    if (drawn && c !== drawn) return false;
    if (st.pending) return (c[1] === 'D' && st.top[1] === 'D') || c[1] === 'F';
    return c[0] === 'w' || c[0] === st.color || c[1] === st.top[1];
  }

  function eventText(e) {
    if (!e) return '';
    if (e.t === 'played') {
      if (e.victim) return t('uno.ev.hit', { name: name(e.id), victim: name(e.victim), n: e.n });
      if (e.card[0] === 'w') return t('uno.ev.wild', { name: name(e.id), color: t('uno.color.' + e.color) });
      return '';
    }
    if (e.t === 'drew') return e.n > 1 ? t('uno.ev.drewMany', { name: name(e.id), n: tn('n.cards', e.n) }) : '';
    if (e.t === 'uno') return t('uno.ev.uno', { name: name(e.id) });
    if (e.t === 'caught') return t('uno.ev.caught', { name: name(e.id), victim: name(e.victim) });
    if (e.t === 'won') return e.id === api.me ? `🏆 ${t('uno.youWin')}` : t('uno.won', { name: name(e.id) });
    return '';
  }

  function render() {
    if (!st) return;
    const n = st.players.length;
    const myIdx = st.players.findIndex((p) => p.id === api.me);
    const order = myIdx >= 0 ? [...st.players.slice(myIdx + 1), ...st.players.slice(0, myIdx)] : st.players;
    $('.un-opps').innerHTML = order
      .map((p) => {
        const s = api.seat(p.id);
        const badge = st.vulnerable === p.id ? '<b class="un-badge bad">1!</b>' : p.count === 1 ? '<b class="un-badge">UNO</b>' : '';
        return `<div class="un-opp ${st.turn === p.id ? 'turn' : ''}" style="--pc:${s?.color}">${avatar(s, 34)}${badge}
          <div class="un-oname">${esc(s?.name || '?')}</div><div class="un-count">🂠 ${p.count}</div></div>`;
      })
      .join('');
    root.querySelector('.un').style.setProperty('--n', n);
    $('.un-top').innerHTML = unoCard(st.top, 'big');
    $('.un-pilen').textContent = st.pile;
    $('.un-color').innerHTML = `<i style="background:${COLOR_HEX[st.color]}"></i>${t('uno.color.' + st.color)}`;
    $('.un-dir').textContent = st.dir > 0 ? '↻' : '↺';
    $('.un-pile').classList.toggle('ok', myTurn() && !drawn);
    let status;
    if (st.over) status = eventText(st.event);
    else if (myTurn()) status = st.pending ? t('uno.stack', { n: st.pending }) : drawn ? t('uno.drawnPlay') : t('uno.yourTurn');
    else status = t('uno.turnOf', { name: name(st.turn) }) + (st.pending ? ` · +${st.pending}` : '');
    $('.un-status').textContent = status;
    const sorted = hand.slice().sort((a, b) => 'rygbw'.indexOf(a[0]) - 'rygbw'.indexOf(b[0]) || a[1].localeCompare(b[1]));
    $('.un-hand').innerHTML = sorted.map((c, k) => `<button class="un-card ${playable(c) ? 'ok' : ''} ${c === drawn ? 'new' : ''}" data-card="${c}" data-k="${k}">${unoCard(c)}</button>`).join('');
    $('.un-hand').style.setProperty('--cards', sorted.length);
    const btns = [];
    const mine = me();
    if (mine && !st.over && hand.length <= 2 && !mine.armed && st.vulnerable !== api.me && hand.length > 0) btns.push(`<button class="btn primary" data-a="uno">📣 UNO!</button>`);
    if (st.vulnerable === api.me) btns.push(`<button class="btn danger" data-a="uno">📣 UNO!</button>`);
    if (st.vulnerable && st.vulnerable !== api.me && mine) btns.push(`<button class="btn danger" data-a="catch">🫵 ${t('uno.catch', { name: name(st.vulnerable) })}</button>`);
    if (myTurn() && drawn) btns.push(`<button class="btn" data-a="pass">${t('uno.keep')}</button>`);
    if (myTurn() && st.pending) btns.push(`<button class="btn" data-a="draw">${t('uno.take', { n: st.pending })}</button>`);
    $('.un-actions').innerHTML = btns.join('');
    if (st.left != null) timerBar($('.un-timer'), st.left, 25000);
    else stopTimerBar($('.un-timer'));
    api.setInfo(t('uno.deck', { n: st.pile }));
  }

  root.addEventListener('click', async (e) => {
    if (!st) return;
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a) {
      if (a === 'draw' && (!myTurn() || (drawn && !st.pending))) return sfx.wrong();
      api.act({ t: a });
      if (a === 'draw') sfx.card();
      return;
    }
    const c = e.target.closest('[data-card]')?.dataset.card;
    if (!c) return;
    if (!playable(c)) return sfx.wrong();
    let color;
    if (c[0] === 'w') {
      color = await modal({
        title: t('uno.pickColor'),
        buttons: COLORS.map((k) => ({ id: k, label: `${DOT[k]} ${t('uno.color.' + k)}` })),
      });
      if (!color) return;
    }
    api.act({ t: 'play', card: c, color });
    sfx.card();
  });

  return {
    msg(d) {
      if (d.t === 'hand') {
        hand = d.cards;
        drawn = d.drawn;
        return render();
      }
      if (d.t !== 'state') return;
      const wasMine = myTurn();
      st = d;
      if (!myTurn()) drawn = null;
      const key = JSON.stringify(d.event);
      if (key !== lastEvent) {
        lastEvent = key;
        const text = eventText(d.event);
        if (text && !d.over) toast(text);
        if (d.event?.t === 'played') sfx.card();
        if (d.event?.t === 'caught' || d.event?.victim === api.me) sfx.wrong();
      }
      if (myTurn() && !wasMine) sfx.turn();
      render();
    },
    destroy() {},
  };
}
