import { esc } from '../../core/util.js';
import { sfx } from '../../core/sfx.js';
import { avatar, card, timerBar, stopTimerBar } from '../../ui/common.js';

export function mount(root, api) {
  const { t } = api;
  root.innerHTML = `
    <div class="bj">
      <div class="bj-dealer">
        <div class="bj-label">🎩 ${t('bj.dealer')} <b class="bj-dtotal"></b></div>
        <div class="bj-cards bj-dcards"></div>
      </div>
      <div class="bj-others"></div>
      <div class="bj-me">
        <div class="bj-mystat"></div>
        <div class="bj-cards bj-mycards"></div>
        <div class="bj-result"></div>
        <div class="timer bj-timer"></div>
        <div class="bj-actions"></div>
      </div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  let st = null;
  let pending = 0;
  let lastCards = 0;

  const RESULT = { win: '🎉', bj: '🃏', push: '🤝', lose: '💸' };

  function renderOthers() {
    $('.bj-others').innerHTML = st.players
      .filter((p) => p.id !== api.me)
      .map((p) => {
        const s = api.seat(p.id);
        const res = p.result ? `<span class="bj-res ${p.result}">${RESULT[p.result]} ${p.delta > 0 ? '+' : ''}${p.delta}</span>` : p.status === 'bust' ? `<span class="bj-res lose">💥</span>` : '';
        return `<div class="bj-row ${p.out ? 'out' : ''}" style="--pc:${s?.color}">
          ${avatar(s, 30)}
          <div class="bj-rinfo"><b>${esc(s?.name || '?')}</b><span>🪙 ${p.chips}${p.bet ? ` · ${t('bj.bet')} ${p.bet}` : ''}</span></div>
          <div class="bj-rcards">${p.hand.map((c) => card(c, 'xs')).join('')}</div>
          <div class="bj-rtotal">${p.hand.length ? p.total : p.status === 'ready' ? '✓' : p.status === 'betting' ? '…' : ''}</div>
          ${res}
        </div>`;
      })
      .join('');
  }

  function renderMe() {
    const p = st.players.find((x) => x.id === api.me);
    const actions = $('.bj-actions');
    if (!p) {
      $('.bj-mystat').textContent = t('game.spectating');
      actions.innerHTML = '';
      return;
    }
    $('.bj-mystat').innerHTML = `🪙 <b>${p.chips}</b>${p.bet ? ` · ${t('bj.bet')} <b>${p.bet}</b>` : ''}`;
    $('.bj-mycards').innerHTML = p.hand.map((c) => card(c, 'lg deal')).join('') + (p.hand.length ? `<span class="bj-total">${p.total}</span>` : '');
    let res = '';
    if (p.out) res = t('bj.broke');
    else if (p.result) res = `${RESULT[p.result]} ${t('bj.res.' + p.result)} ${p.delta > 0 ? '+' : ''}${p.delta}`;
    else if (p.status === 'bust') res = `💥 ${t('bj.bust')}`;
    else if (p.status === 'blackjack') res = `🃏 ${t('bj.res.bj')}!`;
    $('.bj-result').textContent = res;
    $('.bj-result').className = `bj-result ${p.result || ''}`;
    const timer = $('.bj-timer');
    const waiting = (st.phase === 'bet' && p.status === 'betting') || (st.phase === 'play' && p.status === 'playing');
    if (waiting && st.left != null) timerBar(timer, st.left, st.phase === 'bet' ? 15000 : 25000);
    else stopTimerBar(timer);
    if (st.phase === 'bet' && p.status === 'betting') {
      if (!pending) pending = Math.min(p.chips, st.minBet);
      pending = Math.max(Math.min(p.chips, st.minBet), Math.min(pending, p.chips));
      const steps = [st.minBet, st.minBet * 5, st.minBet * 10].filter((v, i, a) => a.indexOf(v) === i);
      actions.innerHTML = `
        <div class="bj-chips">${steps.map((v) => `<button class="chip bj-chip" data-add="${v}">+${v}</button>`).join('')}
          <button class="chip" data-add="x2">×2</button><button class="chip" data-add="max">${t('bj.max')}</button><button class="chip" data-add="reset">↺</button></div>
        <button class="btn primary big" data-a="bet">${t('bj.placeBet', { n: pending })}</button>`;
    } else if (st.phase === 'play' && p.status === 'playing') {
      actions.innerHTML = `
        <button class="btn primary" data-a="hit">${t('bj.hit')}</button>
        <button class="btn" data-a="stand">${t('bj.stand')}</button>
        ${p.hand.length === 2 && p.chips >= p.bet ? `<button class="btn" data-a="double">${t('bj.double')}</button>` : ''}`;
    } else {
      actions.innerHTML = `<p class="muted">${st.phase === 'bet' ? t('bj.waitBets') : st.phase === 'play' ? t('bj.waitOthers') : st.phase === 'dealer' ? t('bj.dealerTurn') : ''}</p>`;
    }
  }

  function render() {
    if (!st) return;
    api.setInfo(`${t('bj.round', { n: st.round, total: st.rounds })} · ${t('bj.minBet')} ${st.minBet}`);
    $('.bj-dcards').innerHTML = st.dealer.map((c) => card(c, 'md deal')).join('');
    $('.bj-dtotal').textContent = st.dealer.length ? st.dealerTotal : '';
    const cards = st.dealer.length + st.players.reduce((s, p) => s + p.hand.length, 0);
    if (cards > lastCards) sfx.card();
    lastCards = cards;
    renderOthers();
    renderMe();
  }

  root.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]')?.dataset.add;
    const p = st?.players.find((x) => x.id === api.me);
    if (add && p) {
      if (add === 'reset') pending = st.minBet;
      else if (add === 'x2') pending *= 2;
      else if (add === 'max') pending = p.chips;
      else pending += +add;
      sfx.chip();
      renderMe();
      return;
    }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'bet') {
      api.act({ t: 'bet', amount: pending });
      pending = 0;
      sfx.chip();
    } else api.act({ t: a });
  });

  return {
    msg(d) {
      if (d.t !== 'state') return;
      const before = st?.players.find((x) => x.id === api.me);
      st = d;
      const now = st.players.find((x) => x.id === api.me);
      if (now?.result && !before?.result) (now.delta > 0 ? sfx.win : now.delta < 0 ? sfx.lose : sfx.tap)();
      if (now?.status === 'playing' && before?.status !== 'playing') sfx.turn();
      render();
    },
    destroy() {},
  };
}
