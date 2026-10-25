import { esc } from '../../core/util.js';
import { sfx } from '../../core/sfx.js';
import { avatar, modal, timerBar, stopTimerBar, toast } from '../../ui/common.js';

export const ITEM_ICON = { glass: '🔍', soda: '🥤', cuffs: '⛓️', saw: '🪚', medkit: '💊', phone: '📱', invert: '🔄' };

// Ружьё рисуем сами: эмодзи 🔫 на iPhone — водяной пистолет.
const GUN = `<svg class="rr-gun-svg" viewBox="0 0 200 54" aria-hidden="true">
  <path d="M6 30 L58 22 L70 22 L74 30 L66 46 L46 52 L40 44 L10 42 Z" fill="#6b4226"/>
  <rect x="68" y="18" width="40" height="16" rx="3" fill="#3b3b3b"/>
  <rect x="104" y="20" width="92" height="7" rx="2" fill="#8d8d8d"/>
  <rect x="104" y="27" width="86" height="6" rx="2" fill="#6f6f6f"/>
  <path d="M84 34 L96 34 L92 46 L84 46 Z" fill="#2b2b2b"/>
  <rect x="112" y="33" width="44" height="7" rx="3" fill="#7a4a2a"/>
</svg>`;

export function mount(root, api) {
  const { t } = api;
  root.innerHTML = `
    <div class="rr">
      <div class="rr-opps"></div>
      <div class="rr-table">
        <div class="rr-load"></div>
        <div class="rr-gun">${GUN}<span class="rr-saw" hidden>🪚×2</span></div>
        <div class="rr-shells"></div>
        <div class="rr-feed"></div>
      </div>
      <div class="rr-status"></div>
      <div class="timer rr-timer"></div>
      <div class="rr-me"></div>
      <div class="rr-items"></div>
      <div class="rr-actions"></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  let st = null;
  let known = {};
  let knownLoad = 0;
  let lastK = 0;

  const name = (id) => esc(api.seat(id)?.name || '?');
  const me = () => st?.players.find((p) => p.id === api.me);
  const myTurn = () => st && !st.over && st.turn === api.me && me() && !me().out;
  const hearts = (p) => '<span class="rr-hp">' + Array.from({ length: p.maxHp }, (_, i) => (i < p.hp ? '❤️' : '🖤')).join('') + '</span>';

  function eventText(e) {
    switch (e.t) {
      case 'load':
        return t('roulette.ev.load', { live: e.live, blank: e.blank });
      case 'shot': {
        const self = e.id === e.target;
        if (e.shell === 'L') return self ? t('roulette.ev.selfLive', { name: name(e.id), n: e.dmg }) : t('roulette.ev.live', { name: name(e.id), target: name(e.target), n: e.dmg });
        return self ? t('roulette.ev.selfBlank', { name: name(e.id) }) : t('roulette.ev.blank', { name: name(e.id), target: name(e.target) });
      }
      case 'item':
        return `${ITEM_ICON[e.item]} ${t('roulette.ev.item', { name: name(e.id), item: t('roulette.item.' + e.item) })}${e.target ? ' → ' + name(e.target) : ''}${e.shell ? ` (${e.shell === 'L' ? '🔴' : '⚪'})` : ''}`;
      case 'skip':
        return `⛓️ ${t('roulette.ev.skip', { name: name(e.id) })}`;
      case 'out':
        return `💀 ${t('roulette.ev.out', { name: name(e.id) })}`;
      case 'won':
        return e.id === api.me ? `🏆 ${t('roulette.youWin')}` : `🏆 ${t('roulette.won', { name: name(e.id) })}`;
    }
    return '';
  }

  function render() {
    if (!st) return;
    const others = st.players.filter((p) => p.id !== api.me);
    const targets = others.filter((p) => !p.out);
    // Соперников несколько — стреляем нажатием на соперника.
    const tapToShoot = myTurn() && targets.length > 1;
    $('.rr-opps').innerHTML = others
      .map((p) => {
        const s = api.seat(p.id);
        const items = p.items.slice(0, 4).map((it) => ITEM_ICON[it]).join('') + (p.items.length > 4 ? `<small>+${p.items.length - 4}</small>` : '');
        return `<button class="rr-opp ${p.out ? 'out' : ''} ${st.turn === p.id ? 'turn' : ''} ${tapToShoot && !p.out ? 'target' : ''}" ${tapToShoot && !p.out ? `data-shoot="${p.id}"` : 'disabled'} style="--pc:${s?.color}">
          ${avatar(s, 30)}${p.cuffed ? '<b class="rr-cuff">⛓️</b>' : ''}
          <span class="rr-oname">${esc(s?.name || '?')}</span>${p.out ? '<span>💀</span>' : hearts(p)}
          <span class="rr-oitems">${items}</span></button>`;
      })
      .join('');
    const total = st.loaded.live + st.loaded.blank;
    $('.rr-load').innerHTML = `${t('roulette.loaded')}: <b class="live">🔴 ${st.loaded.live}</b> <b class="blank">⚪ ${st.loaded.blank}</b>`;
    const myKnown = knownLoad === st.load ? known : {};
    const cells = [];
    for (let i = 0; i < total; i++) {
      if (i < st.fired.length) cells.push(`<i class="sh ${st.fired[i] === 'L' ? 'L' : 'B'} gone"></i>`);
      else {
        const k = myKnown[i];
        cells.push(`<i class="sh ${k ? k + ' seen' : 'q'} ${i === st.fired.length ? 'cur' : ''}">${k ? '👁' : '?'}</i>`);
      }
    }
    $('.rr-shells').innerHTML = cells.join('');
    $('.rr-saw').hidden = !st.saw;
    $('.rr-feed').innerHTML = st.log
      .slice(-2)
      .map((e) => `<div>${eventText(e)}</div>`)
      .join('');
    const m = me();
    let status = '';
    if (st.over) status = eventText(st.log.at(-1));
    else if (!m) status = t('game.spectating');
    else if (m.out) status = t('roulette.youOut');
    else if (myTurn()) status = st.saw ? t('roulette.yourTurnSaw') : tapToShoot ? t('roulette.tapRival') : t('roulette.yourTurn');
    else status = t('roulette.turnOf', { name: name(st.turn) });
    $('.rr-status').textContent = status;
    if (m) {
      const s = api.seat(api.me);
      $('.rr-me').innerHTML = `<div class="rr-mine ${myTurn() ? 'turn' : ''} ${m.out ? 'out' : ''}">${avatar(s, 30)}${m.cuffed ? '<b class="rr-cuff">⛓️</b>' : ''}<b>${esc(s?.name || '')}</b>${m.out ? '💀' : hearts(m)}</div>`;
      $('.rr-items').innerHTML = m.items
        .map((it, k) => `<button class="rr-item" data-item="${it}" data-k="${k}" ${myTurn() ? '' : 'disabled'} title="${esc(t('roulette.desc.' + it))}">${ITEM_ICON[it]}<small>${t('roulette.item.' + it)}</small></button>`)
        .join('');
    } else {
      $('.rr-me').innerHTML = '';
      $('.rr-items').innerHTML = '';
    }
    const btns = [];
    if (myTurn()) {
      btns.push(`<button class="btn rr-shoot self" data-shoot="${api.me}">💥 ${t('roulette.shootSelf')}</button>`);
      if (targets.length === 1) btns.push(`<button class="btn danger rr-shoot" data-shoot="${targets[0].id}">💥 ${t('roulette.shootOpp')}</button>`);
    }
    $('.rr-actions').innerHTML = btns.join('');
    if (st.left != null) timerBar($('.rr-timer'), st.left, 30000);
    else stopTimerBar($('.rr-timer'));
    api.setInfo(t('roulette.round', { n: st.load }));
  }

  async function useItem(it) {
    if (!myTurn()) return;
    const a = { t: 'use', item: it };
    if (it === 'cuffs') {
      const opts = st.players.filter((p) => p.id !== api.me && !p.out);
      if (opts.length > 1) {
        const target = await modal({ title: t('roulette.cuffWho'), buttons: opts.map((p) => ({ id: p.id, label: api.seat(p.id)?.name || '?' })) });
        if (!target) return;
        a.target = target;
      } else a.target = opts[0]?.id;
    }
    api.act(a);
    sfx.tap();
  }

  root.addEventListener('click', (e) => {
    const it = e.target.closest('[data-item]')?.dataset.item;
    if (it) return useItem(it);
    const target = e.target.closest('[data-shoot]')?.dataset.shoot;
    if (target && myTurn()) api.act({ t: 'shoot', target });
  });

  function flash(kind) {
    const el = root.querySelector('.rr');
    el.classList.remove('boom', 'click');
    void el.offsetWidth;
    el.classList.add(kind);
  }

  return {
    msg(d) {
      if (d.t === 'known') {
        if (d.load !== knownLoad || JSON.stringify(d.known) !== JSON.stringify(known)) {
          const fresh = Object.keys(d.known).filter((k) => !(k in known) || d.load !== knownLoad);
          known = d.known;
          knownLoad = d.load;
          for (const k of fresh) toast(`👁 ${t('roulette.peek', { n: Number(k) + 1, shell: known[k] === 'L' ? '🔴' : '⚪' })}`);
        }
        return render();
      }
      if (d.t !== 'state') return;
      const wasMine = myTurn();
      st = d;
      // Новые события: звук и вспышка.
      for (const e of d.log) {
        if (e.k <= lastK) continue;
        if (lastK) {
          if (e.t === 'shot' && e.shell === 'L') {
            sfx.wrong();
            flash('boom');
          } else if (e.t === 'shot') {
            sfx.tick();
            flash('click');
          } else if (e.t === 'load') sfx.chip();
          else if (e.t === 'item') sfx.tap();
        }
        lastK = e.k;
      }
      if (myTurn() && !wasMine) sfx.turn();
      render();
    },
    destroy() {},
  };
}
