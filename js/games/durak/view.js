import { esc } from '../../core/util.js';
import { sfx } from '../../core/sfx.js';
import { avatar, card, suitSymbol, timerBar, stopTimerBar, toast } from '../../ui/common.js';
import { beats, rv } from './engine.js';

export function mount(root, api) {
  const { t, tn } = api;
  root.innerHTML = `
    <div class="dk">
      <div class="dk-opps"></div>
      <div class="dk-mid">
        <div class="dk-deck"></div>
        <div class="dk-table"></div>
      </div>
      <div class="dk-status"></div>
      <div class="timer dk-timer"></div>
      <div class="dk-hand"></div>
      <div class="dk-actions"></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  let st = null;
  let hand = [];
  let selected = null;
  let lastEvent = null;

  const name = (id) => esc(api.seat(id)?.name || '?');
  const iAmDefender = () => st?.defender === api.me;
  const iCanThrow = () => st && st.throwers.includes(api.me) && (st.phase === 'attack' || st.phase === 'taking');
  const ranks = () => new Set(st.table.flatMap((p) => (p.d ? [p.a[0], p.d[0]] : [p.a[0]])));
  const unbeaten = () => st.table.filter((p) => !p.d).length;
  const defCount = () => st.players.find((p) => p.id === st.defender)?.count ?? 0;

  function canAttack(c) {
    if (!iCanThrow() || st.table.length >= st.limit) return false;
    if (!st.table.length) return st.attacker === api.me;
    if (!ranks().has(c[0])) return false;
    return st.phase === 'taking' || unbeaten() < defCount();
  }
  const canDefend = (c) => iAmDefender() && st.phase === 'attack' && st.table.some((p) => !p.d && beats(p.a, c, st.trump));

  function sortHand(cards) {
    const order = ['S', 'C', 'D', 'H'].filter((s) => s !== st?.trump).concat(st?.trump || []);
    return cards.slice().sort((a, b) => order.indexOf(a[1]) - order.indexOf(b[1]) || rv(a) - rv(b));
  }

  function renderOpps() {
    const n = st.players.length;
    const myIdx = st.players.findIndex((p) => p.id === api.me);
    const list = myIdx >= 0 ? [...st.players.slice(myIdx + 1), ...st.players.slice(0, myIdx)] : st.players;
    $('.dk-opps').innerHTML = list
      .map((p) => {
        const s = api.seat(p.id);
        let role = '';
        if (st.durak === p.id) role = '🤡';
        else if (p.out) role = `🏁${p.place || ''}`;
        else if (p.id === st.defender) role = '🛡️';
        else if (p.id === st.attacker) role = '⚔️';
        else if (st.passed.includes(p.id)) role = '✓';
        const backs = Array.from({ length: Math.min(p.count, 8) }, () => '<i class="mini-back"></i>').join('');
        return `<div class="dk-opp ${p.out ? 'out' : ''} ${p.id === st.defender ? 'def' : ''}" style="--pc:${s?.color}">
          ${avatar(s, 34)}<span class="dk-role">${role}</span>
          <div class="dk-oname">${esc(s?.name || '?')}</div>
          <div class="dk-fan">${backs}<b>${p.count}</b></div>
        </div>`;
      })
      .join('');
    root.querySelector('.dk').style.setProperty('--n', n);
  }

  function renderMid() {
    const trump = suitSymbol(st.trump);
    $('.dk-deck').innerHTML = st.deck
      ? `<div class="dk-stack">${st.trumpCard ? card(st.trumpCard, 'sm dk-trump') : ''}${card(null, 'sm')}<b>${st.deck}</b></div>`
      : `<div class="dk-trumpsuit ${'HD'.includes(st.trump) ? 'red' : ''}">${trump}</div>`;
    $('.dk-deck').insertAdjacentHTML('beforeend', `<div class="dk-discard">${t('durak.discard')}: ${st.discard}</div>`);
    const sel = selected && hand.includes(selected) ? selected : null;
    $('.dk-table').innerHTML = st.table.length
      ? st.table
          .map((p, i) => {
            const target = sel && !p.d && beats(p.a, sel, st.trump);
            return `<div class="dk-pair ${target ? 'target' : ''}" data-pair="${i}">${card(p.a, 'md')}${p.d ? card(p.d, 'md dk-def') : ''}</div>`;
          })
          .join('')
      : `<div class="dk-empty muted">${st.phase === 'over' ? '' : t('durak.emptyTable')}</div>`;
  }

  function status() {
    if (st.phase === 'over') return st.durak ? (st.durak === api.me ? t('durak.youDurak') : t('durak.isDurak', { name: name(st.durak) })) : t('durak.draw');
    const meP = st.players.find((p) => p.id === api.me);
    if (!meP) return t('game.spectating');
    if (meP.out) return t('durak.youOut');
    if (st.phase === 'pause') return lastEvent?.t === 'took' ? t('durak.took', { name: name(lastEvent.id), n: tn('n.cards', lastEvent.n) }) : t('durak.beaten');
    if (st.phase === 'taking') return iAmDefender() ? t('durak.youTake') : t('durak.taking', { name: name(st.defender) });
    if (!st.table.length) return st.attacker === api.me ? t('durak.yourMove') : t('durak.moves', { name: name(st.attacker) });
    if (iAmDefender()) return unbeaten() ? t('durak.defend') : t('durak.waitThrow');
    if (iCanThrow()) return unbeaten() ? t('durak.canThrow') : t('durak.throwOrDone');
    return t('durak.defends', { name: name(st.defender) });
  }

  function renderMe() {
    const sorted = sortHand(hand);
    $('.dk-hand').innerHTML = sorted
      .map((c) => {
        const ok = canAttack(c) || canDefend(c);
        return `<button class="dk-card ${ok ? 'ok' : ''} ${c === selected ? 'sel' : ''}" data-card="${c}">${card(c, 'md')}</button>`;
      })
      .join('');
    $('.dk-hand').style.setProperty('--cards', sorted.length);
    $('.dk-status').textContent = status();
    const btns = [];
    if (iAmDefender() && st.phase === 'attack' && unbeaten()) btns.push(`<button class="btn danger" data-a="take">${t('durak.take')}</button>`);
    if (iCanThrow() && st.table.length && !st.passed.includes(api.me)) {
      btns.push(`<button class="btn primary" data-a="pass">${st.phase === 'taking' ? t('durak.enough') : unbeaten() ? t('durak.pass') : t('durak.done')}</button>`);
    }
    $('.dk-actions').innerHTML = btns.join('');
    const timer = $('.dk-timer');
    if (st.left != null) timerBar(timer, st.left, st.phase === 'taking' ? 7000 : st.table.length && !unbeaten() ? 12000 : 30000);
    else stopTimerBar(timer);
  }

  function render() {
    if (!st) return;
    api.setInfo(`${t('durak.trump')}: ${suitSymbol(st.trump)} · ${t('durak.deck')}: ${st.deck}`);
    renderOpps();
    renderMid();
    renderMe();
  }

  root.addEventListener('click', (e) => {
    if (!st) return;
    const a = e.target.closest('[data-a]');
    if (a) {
      api.act({ t: a.dataset.a });
      selected = null;
      return;
    }
    const pair = e.target.closest('[data-pair]');
    if (pair && selected) {
      api.act({ t: 'defend', card: selected, target: +pair.dataset.pair });
      selected = null;
      sfx.card();
      return;
    }
    const c = e.target.closest('[data-card]')?.dataset.card;
    if (!c || !hand.includes(c)) return;
    if (canDefend(c)) {
      const targets = st.table.map((p, i) => (!p.d && beats(p.a, c, st.trump) ? i : -1)).filter((i) => i >= 0);
      if (targets.length === 1) {
        api.act({ t: 'defend', card: c, target: targets[0] });
        selected = null;
        sfx.card();
      } else {
        selected = selected === c ? null : c;
        render();
      }
      return;
    }
    if (canAttack(c)) {
      api.act({ t: 'attack', card: c });
      sfx.card();
      return;
    }
    sfx.wrong();
  });

  return {
    msg(d) {
      if (d.t === 'state') {
        if (d.event && JSON.stringify(d.event) !== JSON.stringify(lastEvent)) {
          lastEvent = d.event;
          if (d.event.t === 'took' && d.event.id !== api.me) toast(t('durak.took', { name: name(d.event.id), n: tn('n.cards', d.event.n) }));
          if (d.event.t === 'attack' || d.event.t === 'defend') sfx.card();
        }
        const myTurnBefore = st && ((st.attacker === api.me && !st.table.length) || (st.defender === api.me && st.table.some((p) => !p.d)));
        st = d;
        const myTurnNow = (st.attacker === api.me && !st.table.length) || (st.defender === api.me && st.table.some((p) => !p.d));
        if (myTurnNow && !myTurnBefore) sfx.turn();
        render();
      } else if (d.t === 'hand') {
        hand = d.cards;
        if (selected && !hand.includes(selected)) selected = null;
        render();
      }
    },
    destroy() {},
  };
}
