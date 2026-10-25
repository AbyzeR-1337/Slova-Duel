import { esc } from '../../core/util.js';
import { sfx } from '../../core/sfx.js';
import { avatar, timerBar, stopTimerBar } from '../../ui/common.js';
import { chatBox } from '../chat.js';
import { CATS } from './engine.js';

export const CAT_ICON = { bio: '🧬', prof: '💼', health: '❤️', hobby: '🎨', phobia: '😱', bag: '🎒', fact: '📜' };
const PHASE_MS = { intro: 12000, reveal: 30000, vote: 30000, verdict: 8000, over: 9000 };

export function mount(root, api) {
  const { t, tn } = api;
  root.innerHTML = `
    <div class="bk">
      <details class="bk-world card" open><summary class="bk-cat"></summary><div class="bk-info"></div></details>
      <div class="bk-phase"></div>
      <div class="timer bk-timer"></div>
      <div class="bk-scroll">
        <div class="bk-mine"></div>
        <div class="bk-players"></div>
      </div>
      <div class="bk-actions"></div>
      <div class="bk-chat ct"></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  let st = null;
  let mine = null;
  let lastPhase = '';
  const talkMs = (Number(api.settings.talk) || 90) * 1000;

  const name = (id) => esc(api.seat(id)?.name || '?');
  const meP = () => st?.players.find((p) => p.id === api.me);
  const alive = () => !!meP()?.alive;

  const chat = chatBox($('.bk-chat'), api, {
    placeholder: t('bunker.chatPh'),
    format: (m) => t('bunker.say.' + m.key, { name: m.who ? name(m.who) : '', card: esc(m.card || '') }),
  });
  chat.onSend((text) => api.act({ t: 'chat', text }));

  function phaseText() {
    if (!st) return '';
    const p = meP();
    switch (st.phase) {
      case 'intro':
        return t('bunker.intro', { n: st.capacity });
      case 'reveal':
        return p?.alive ? (p.done ? t('bunker.waitReveal') : t('bunker.reveal')) : t('bunker.watch');
      case 'talk':
        return st.voteRound ? t('bunker.talkVote') : t('bunker.talk');
      case 'vote':
        return alive() ? (st.votes[api.me] ? t('bunker.voted') : t('bunker.vote')) : t('bunker.watch');
      case 'verdict':
        return st.last ? t(st.last.lot ? 'bunker.outLot' : 'bunker.out', { name: name(st.last.id) }) : '';
      case 'over':
        return p ? (p.alive ? `🛡️ ${t('bunker.saved')}` : `☢️ ${t('bunker.lost')}`) : t('bunker.end');
    }
    return '';
  }

  function render() {
    if (!st) return;
    const w = st.world;
    if (w) {
      $('.bk-cat').innerHTML = `☢️ <b>${esc(w.cat.title)}</b>`;
      $('.bk-info').innerHTML = `<p>${esc(w.cat.text)}</p>
        <div class="bk-stats"><span>🏠 ${t('bunker.size', { n: w.size })}</span><span>⏳ ${tn('n.months', w.stay)}</span><span>👥 ${t('bunker.places', { n: w.capacity })}</span></div>
        <ul class="bk-feat">${w.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`;
    }
    $('.bk-phase').innerHTML = `<b>${st.round ? t('bunker.round', { n: st.round, total: st.rounds }) : t('bunker.phase.intro')}</b> · ${phaseText()}`;
    const p = meP();
    const canReveal = st.phase === 'reveal' && p?.alive && !p.done;
    if (mine) {
      $('.bk-mine').innerHTML = `<h4>${t('bunker.myCards')}</h4><div class="bk-cards">${CATS.map((c) => {
        const open = p && c in p.open;
        return `<button class="bk-card ${open ? 'open' : 'hidden'} ${canReveal && !open ? 'can' : ''}" data-cat="${c}" ${canReveal && !open ? '' : 'disabled'}>
          <span class="bk-ci">${CAT_ICON[c]} ${t('bunker.cat.' + c)} ${open ? '' : '🔒'}</span><b>${esc(mine[c])}</b></button>`;
      }).join('')}</div>`;
    } else $('.bk-mine').innerHTML = '';
    const tally = {};
    for (const v of Object.values(st.votes)) if (v) tally[v] = (tally[v] || 0) + 1;
    const canVote = st.phase === 'vote' && alive() && !st.votes[api.me];
    $('.bk-players').innerHTML = st.players
      .filter((x) => x.id !== api.me || !mine)
      .map((x) => {
        const s = api.seat(x.id);
        const chips = CATS.filter((c) => c in x.open)
          .map((c) => `<span class="bk-chip"><i>${CAT_ICON[c]}</i>${esc(x.open[c])}</span>`)
          .join('');
        const can = canVote && x.alive && x.id !== api.me;
        const marks = [x.done ? '✓' : '', st.ready.includes(x.id) && st.phase === 'talk' ? '✋' : '', st.votes[api.me] === x.id ? '🗳️' : ''].join(' ');
        return `<div class="bk-p ${x.alive ? '' : 'out'} ${can ? 'can' : ''}" data-id="${x.id}" style="--pc:${s?.color}">
          <div class="bk-ph">${avatar(s, 30)}<b>${esc(s?.name || '?')}</b><span class="bk-marks">${marks}</span>${tally[x.id] ? `<b class="bk-votes">${tally[x.id]}</b>` : ''}${x.alive ? '' : '<span class="bk-gone">☢️</span>'}</div>
          <div class="bk-chips">${chips}</div></div>`;
      })
      .join('');
    const btns = [];
    if (st.phase === 'talk' && alive()) btns.push(`<button class="btn ${st.ready.includes(api.me) ? '' : 'primary'}" data-a="ready">${st.ready.includes(api.me) ? t('mafia.notReady') : st.voteRound ? t('mafia.ready') : t('bunker.next')}</button>`);
    $('.bk-actions').innerHTML = btns.join('');
    chat.enable(alive() && st.phase !== 'intro' && st.phase !== 'over');
    const total = st.phase === 'talk' ? talkMs : PHASE_MS[st.phase];
    if (st.left != null && total && st.phase !== 'over') timerBar($('.bk-timer'), st.left, total);
    else stopTimerBar($('.bk-timer'));
    // Свои карты сверху, когда нужно открыть карту; в остальное время — игроки.
    root.querySelector('.bk').classList.toggle('mine-first', canReveal);
    api.setInfo(t('bunker.places', { n: st.capacity }) + ` · ${st.players.filter((x) => x.alive).length}/${st.players.length}`);
  }

  root.addEventListener('click', (e) => {
    const cat = e.target.closest('[data-cat]')?.dataset.cat;
    if (cat) {
      api.act({ t: 'reveal', cat });
      sfx.card();
      return;
    }
    if (e.target.closest('[data-a="ready"]')) return api.act({ t: 'ready' });
    const id = e.target.closest('.bk-p.can')?.dataset.id;
    if (id) {
      api.act({ t: 'vote', target: id });
      sfx.tap();
    }
  });

  function onPhase() {
    if (st.phase === lastPhase) return;
    const prev = lastPhase;
    lastPhase = st.phase;
    if (prev === 'intro' || (prev === '' && st.phase !== 'intro')) $('.bk-world').open = false;
    if (st.phase === 'reveal' || st.phase === 'vote') sfx.turn();
    if (st.phase === 'verdict' && st.last) {
      sfx.lose();
      chat.add({ sys: true, text: `☢️ ${phaseText()}` });
    }
    if (st.phase === 'talk' && st.round) chat.add({ sys: true, text: `🗣️ ${t('bunker.round', { n: st.round, total: st.rounds })}` });
  }

  return {
    msg(d) {
      if (d.t === 'chat') return chat.add(d);
      if (d.t === 'me') {
        mine = d.cards;
        return render();
      }
      if (d.t !== 'state') return;
      st = d;
      onPhase();
      render();
    },
    destroy() {},
  };
}
