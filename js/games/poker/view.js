import { esc } from '../../core/util.js';
import { sfx } from '../../core/sfx.js';
import { avatar, card, timerBar, stopTimerBar } from '../../ui/common.js';
import { bestHand, CATS } from './eval.js';

// Покерный стол: места игроков по кругу, я — внизу.
export function mount(root, api) {
  const { t } = api;
  root.innerHTML = `
    <div class="pk">
      <div class="pk-table">
        <div class="pk-felt">
          <div class="pk-board"></div>
          <div class="pk-pot"></div>
          <div class="pk-msg"></div>
        </div>
        <div class="pk-seats"></div>
      </div>
      <div class="pk-me">
        <div class="pk-mine">
          <div class="pk-mycards"></div>
          <div class="pk-mystat"><b class="pk-chips"></b><span class="pk-strength"></span></div>
        </div>
        <div class="timer pk-timer"></div>
        <div class="pk-raise" hidden>
          <div class="pk-presets"></div>
          <div class="pk-slide"><input type="range" class="pk-range"><b class="pk-amount"></b></div>
        </div>
        <div class="pk-actions"></div>
        <p class="pk-wait muted"></p>
      </div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const seatsEl = $('.pk-seats');
  const actions = $('.pk-actions');
  const raiseBox = $('.pk-raise');
  const range = $('.pk-range');
  let st = null;
  let hole = [];
  let holeHand = 0;
  let show = null;
  let raiseOpen = false;
  let lastBoard = 0;
  let wasMyTurn = false;

  const me = () => st?.players.find((p) => p.id === api.me);

  function seatPos(i, n, myIdx) {
    const j = myIdx >= 0 ? (i - myIdx + n) % n : i;
    const a = Math.PI / 2 + (j * 2 * Math.PI) / n;
    return { x: 50 + 41 * Math.cos(a), y: 50 + 39 * Math.sin(a) };
  }

  function renderSeats() {
    const n = st.players.length;
    const myIdx = st.players.findIndex((p) => p.id === api.me);
    const winners = new Map((show?.wins || []).map((w) => [w.id, w.amount]));
    seatsEl.innerHTML = st.players
      .map((p, i) => {
        const s = api.seat(p.id);
        const { x, y } = seatPos(i, n, myIdx);
        const revealed = show?.hands?.[p.id]?.cards;
        const cards = p.out ? '' : revealed ? revealed.map((c) => card(c, 'xs')).join('') : p.id === api.me && hole.length ? '' : p.cards ? card(null, 'xs') + card(null, 'xs') : '';
        const cls = [p.id === st.toAct && 'turn', p.folded && 'folded', p.out && 'out', winners.has(p.id) && 'winner', p.id === api.me && 'me'].filter(Boolean).join(' ');
        const last = winners.has(p.id) ? `+${winners.get(p.id)}` : p.last ? t('poker.act.' + p.last) : '';
        return `<div class="pk-seat ${cls} ${y > 55 ? 'lower' : ''}" style="left:${x}%;top:${y}%;--pc:${s?.color}">
          <div class="pk-ava">${avatar(s, 36)}${p.id === st.button ? '<span class="pk-dealer">D</span>' : ''}
            ${cards ? `<div class="pk-cards">${cards}</div>` : ''}
            ${last ? `<div class="pk-last ${winners.has(p.id) ? 'win' : ''}">${esc(last)}</div>` : ''}</div>
          <div class="pk-name">${esc(s?.name || '?')}</div>
          <div class="pk-stack">${p.out ? '—' : p.chips}</div>
          ${p.bet ? `<div class="pk-bet">${p.bet}</div>` : ''}
          ${p.id === st.toAct && st.left != null ? '<div class="timer pk-seat-timer"></div>' : ''}
        </div>`;
      })
      .join('');
    const tEl = seatsEl.querySelector('.pk-seat-timer');
    if (tEl) timerBar(tEl, st.left, 30000);
  }

  function renderCenter() {
    $('.pk-board').innerHTML = [0, 1, 2, 3, 4].map((i) => (st.board[i] ? card(st.board[i], 'sm deal') : '<div class="pc slot sm"></div>')).join('');
    $('.pk-pot').textContent = st.pot ? `${t('poker.pot')}: ${st.pot}` : '';
    let m = '';
    if (show && show.hand === st.hand) {
      m = show.wins
        .map((w) => {
          const h = show.hands[w.id];
          return `${esc(api.seat(w.id)?.name || '?')} +${w.amount}${h ? ` · ${t('poker.cat.' + CATS[h.cat])}` : ''}`;
        })
        .join('<br>');
    } else if (st.street === 'over') m = t('game.over');
    $('.pk-msg').innerHTML = m;
    if (st.board.length > lastBoard) sfx.card();
    lastBoard = st.board.length;
  }

  function renderMe() {
    const p = me();
    const mine = $('.pk-mine');
    if (!p) {
      mine.hidden = true;
      actions.innerHTML = '';
      $('.pk-wait').textContent = t('game.spectating');
      return;
    }
    mine.hidden = false;
    const cards = holeHand === st.hand ? hole : [];
    $('.pk-mycards').innerHTML = p.out ? `<span class="muted">${t('poker.busted')}</span>` : cards.map((c) => card(c, 'lg' + (p.folded ? ' dim' : ''))).join('');
    $('.pk-chips').textContent = `🪙 ${p.chips}`;
    let strength = '';
    if (cards.length === 2 && !p.folded) {
      if (st.board.length >= 3) strength = t('poker.cat.' + CATS[bestHand([...cards, ...st.board]).cat]);
      else if (cards[0][0] === cards[1][0]) strength = t('poker.cat.pair');
    }
    $('.pk-strength').textContent = strength;
    const myTurn = st.toAct === api.me;
    if (myTurn && !wasMyTurn) sfx.turn();
    wasMyTurn = myTurn;
    const timer = $('.pk-timer');
    if (myTurn && st.left != null) timerBar(timer, st.left, 30000);
    else stopTimerBar(timer);
    if (!myTurn) {
      raiseOpen = false;
      raiseBox.hidden = true;
      actions.innerHTML = '';
      const who = api.seat(st.toAct);
      $('.pk-wait').textContent = who ? t('poker.waiting', { name: who.name }) : '';
      return;
    }
    $('.pk-wait').textContent = '';
    const toCall = st.currentBet - p.bet;
    const maxTo = p.bet + p.chips;
    const minTo = Math.min(maxTo, Math.max(st.currentBet + st.minRaise, st.bb));
    const canRaise = maxTo > st.currentBet;
    if (canRaise) {
      range.min = minTo;
      range.max = maxTo;
      range.step = Math.max(1, Math.floor(st.bb / 2));
      if (!raiseOpen || +range.value < minTo || +range.value > maxTo) range.value = minTo;
    }
    actions.innerHTML = `
      ${toCall > 0 ? `<button class="btn pk-fold" data-a="fold">${t('poker.fold')}</button>` : ''}
      <button class="btn pk-call" data-a="${toCall > 0 ? 'call' : 'check'}">${toCall > 0 ? `${t('poker.call')} ${Math.min(toCall, p.chips)}` : t('poker.check')}</button>
      ${canRaise ? `<button class="btn primary pk-raise-btn" data-a="raise">${raiseOpen ? `${st.currentBet ? t('poker.raiseTo') : t('poker.bet')} ${range.value}` : st.currentBet ? t('poker.raise') : t('poker.bet')}</button>` : ''}`;
    if (canRaise) {
      $('.pk-amount').textContent = range.value;
      const pot = st.pot + toCall;
      const presets = [
        ['min', minTo],
        ['half', st.currentBet + Math.round(pot / 2)],
        ['pot', st.currentBet + pot],
        ['allin', maxTo],
      ].filter(([, v], i, arr) => v >= minTo && v <= maxTo && arr.findIndex((x) => x[1] === v) === i);
      $('.pk-presets').innerHTML = presets.map(([k, v]) => `<button class="chip" data-to="${v}">${t('poker.preset.' + k)}</button>`).join('');
    }
    raiseBox.hidden = !raiseOpen;
  }

  function render() {
    if (!st) return;
    api.setInfo(`${t('poker.hand', { n: st.hand })}${st.handsLimit ? '/' + st.handsLimit : ''} · ${Math.floor(st.bb / 2)}/${st.bb}`);
    renderSeats();
    renderCenter();
    renderMe();
  }

  root.addEventListener('click', (e) => {
    const preset = e.target.closest('[data-to]');
    if (preset) {
      range.value = preset.dataset.to;
      $('.pk-amount').textContent = range.value;
      renderMe();
      return;
    }
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'raise') {
      if (!raiseOpen) {
        raiseOpen = true;
        renderMe();
        return;
      }
      const to = +range.value;
      const p = me();
      api.act(to >= p.bet + p.chips ? { t: 'allin' } : { t: 'raise', to });
    } else api.act({ t: a });
    raiseOpen = false;
    sfx.chip();
  });
  range.addEventListener('input', () => {
    $('.pk-amount').textContent = range.value;
    const btn = actions.querySelector('.pk-raise-btn');
    if (btn) btn.textContent = `${st.currentBet ? t('poker.raiseTo') : t('poker.bet')} ${range.value}`;
  });

  return {
    msg(d) {
      if (d.t === 'state') {
        if (st && d.hand !== st.hand) show = null;
        st = d;
        render();
      } else if (d.t === 'hole') {
        hole = d.cards;
        holeHand = d.hand;
        sfx.card();
        render();
      } else if (d.t === 'show') {
        show = d;
        if (d.wins.some((w) => w.id === api.me)) sfx.win();
        render();
      }
    },
    destroy() {},
  };
}
