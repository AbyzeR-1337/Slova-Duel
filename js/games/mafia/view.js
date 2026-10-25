import { esc } from '../../core/util.js';
import { sfx } from '../../core/sfx.js';
import { avatar, timerBar, stopTimerBar, toast } from '../../ui/common.js';
import { chatBox } from '../chat.js';
import { ROLE_ICON } from './engine.js';

const PHASE_ICON = { intro: '🎭', night: '🌙', morning: '🌅', day: '☀️', vote: '🗳️', verdict: '⚖️', over: '🏁' };
const PHASE_MS = { intro: 7000, night: 35000, morning: 7000, vote: 30000, verdict: 7000 };

export function mount(root, api) {
  const { t } = api;
  root.innerHTML = `
    <div class="mf">
      <div class="mf-head"><div class="mf-phase"></div><button class="mf-role" data-a="role"></button></div>
      <div class="timer mf-timer"></div>
      <div class="mf-hint"></div>
      <div class="mf-grid"></div>
      <div class="mf-actions"></div>
      <div class="mf-chat ct"></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  let st = null;
  let me = null;
  let showRole = false;
  let lastPhase = '';
  const dayMs = (Number(api.settings.day) || 90) * 1000;

  const name = (id) => esc(api.seat(id)?.name || '?');
  const alive = () => !!st?.alive.includes(api.me);
  const playing = () => !!me;

  const chat = chatBox($('.mf-chat'), api, {
    placeholder: t('mafia.chatPh'),
    format: (m) => t('mafia.say.' + m.key, { name: m.who ? name(m.who) : '' }),
  });
  chat.onSend((text) => api.act({ t: 'chat', text }));

  function nightVerb() {
    if (!me) return '';
    return { mafia: t('mafia.night.mafia'), doctor: t('mafia.night.doctor'), detective: t('mafia.night.detective') }[me.role] || t('mafia.night.civilian');
  }

  function hint() {
    if (!st) return '';
    if (st.phase === 'over') return st.winner === 'town' ? `🕊️ ${t('mafia.townWins')}` : `🔪 ${t('mafia.mafiaWins')}`;
    if (!playing()) return t('game.spectating');
    if (!alive()) return t('mafia.youDead');
    switch (st.phase) {
      case 'intro':
        return t('mafia.intro', { n: st.mafia });
      case 'night':
        return nightVerb();
      case 'morning':
        return st.last?.killed ? t('mafia.killed', { name: name(st.last.killed) }) : st.last?.saved ? t('mafia.saved') : t('mafia.quiet');
      case 'day':
        return t('mafia.discuss');
      case 'vote':
        return st.votes[api.me] !== undefined ? t('mafia.voted') : t('mafia.vote');
      case 'verdict':
        return st.last?.out ? t('mafia.out', { name: name(st.last.out) }) : st.last?.tie ? t('mafia.tie') : t('mafia.noOne');
    }
    return '';
  }

  // Кого можно выбрать ночью/на голосовании.
  function canPick(id) {
    if (!alive() || !st.alive.includes(id)) return false;
    if (st.phase === 'vote') return id !== api.me && st.votes[api.me] === undefined;
    if (st.phase !== 'night' || !me) return false;
    if (me.role === 'mafia') return !me.team.includes(id);
    if (me.role === 'doctor') return id !== me.lastHeal && !me.pick;
    if (me.role === 'detective') return id !== api.me && !(id in me.checks) && !me.pick;
    return false;
  }

  function render() {
    if (!st) return;
    $('.mf-phase').innerHTML = `${PHASE_ICON[st.phase] || ''} <b>${t('mafia.phase.' + st.phase)}</b>${st.day ? ` <span class="muted">· ${t('mafia.day', { n: st.day })}</span>` : ''}`;
    $('.mf-role').hidden = !me;
    if (me) $('.mf-role').innerHTML = showRole ? `${ROLE_ICON[me.role]} ${t('mafia.role.' + me.role)}` : `🂠 ${t('mafia.myRole')}`;
    $('.mf-hint').textContent = hint();
    const tally = {};
    for (const v of Object.values(st.votes)) if (v) tally[v] = (tally[v] || 0) + 1;
    const deadRole = Object.fromEntries(st.dead.map((d) => [d.id, d.role]));
    $('.mf-grid').innerHTML = api.seats
      .map((s) => {
        const id = s.id;
        const dead = !st.alive.includes(id);
        const role = st.roles?.[id] || deadRole[id] || (showRole && me?.team.includes(id) ? 'mafia' : null);
        const check = me?.checks?.[id];
        const marks = [];
        if (role) marks.push(ROLE_ICON[role]);
        if (check !== undefined && !role) marks.push(check ? '🔪?' : '✅');
        if (st.phase === 'day' && st.ready.includes(id)) marks.push('✋');
        const picked = me?.pick === id || (st.phase === 'vote' && st.votes[api.me] === id);
        const mates = me?.role === 'mafia' ? Object.entries(me.picks || {}).filter(([, tg]) => tg === id).length : 0;
        return `<button class="mf-p ${dead ? 'dead' : ''} ${canPick(id) ? 'can' : ''} ${picked ? 'picked' : ''} ${id === api.me ? 'me' : ''}" data-id="${id}" style="--pc:${s.color}">
          ${avatar(s, 42)}<span class="mf-name">${esc(s.name)}</span><span class="mf-marks">${marks.join(' ')}</span>
          ${tally[id] ? `<b class="mf-votes">${tally[id]}</b>` : ''}${mates && !picked ? `<b class="mf-mates">🔪${mates}</b>` : ''}${dead ? '<i class="mf-x">✝</i>' : ''}
        </button>`;
      })
      .join('');
    const btns = [];
    if (st.phase === 'day' && alive()) btns.push(`<button class="btn ${st.ready.includes(api.me) ? '' : 'primary'}" data-a="ready">${st.ready.includes(api.me) ? t('mafia.notReady') : t('mafia.ready')}</button>`);
    if (st.phase === 'vote' && alive() && st.votes[api.me] === undefined) btns.push(`<button class="btn" data-a="skip">${t('mafia.skip')}</button>`);
    $('.mf-actions').innerHTML = btns.join('');
    const canChat = alive() && (st.phase === 'day' || st.phase === 'vote' || st.phase === 'morning' || st.phase === 'verdict' || (st.phase === 'night' && me?.role === 'mafia'));
    chat.enable(canChat, st.phase === 'night' ? t('mafia.nightChatPh') : t('mafia.chatPh'));
    const total = st.phase === 'day' ? dayMs : PHASE_MS[st.phase];
    if (st.left != null && total) timerBar($('.mf-timer'), st.left, total);
    else stopTimerBar($('.mf-timer'));
    root.querySelector('.mf').dataset.phase = st.phase;
    api.setInfo(t('mafia.alive', { n: st.alive.length }));
  }

  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'role') {
      showRole = !showRole;
      return render();
    }
    if (a === 'ready') return api.act({ t: 'ready' });
    if (a === 'skip') return api.act({ t: 'vote', target: null });
    const id = e.target.closest('[data-id]')?.dataset.id;
    if (!id || !st || !canPick(id)) return;
    api.act(st.phase === 'vote' ? { t: 'vote', target: id } : { t: 'night', target: id });
    sfx.tap();
  });

  function onPhase() {
    if (st.phase === lastPhase) return;
    lastPhase = st.phase;
    if (st.phase === 'night') {
      sfx.lose();
      chat.add({ sys: true, text: `🌙 ${t('mafia.phase.night')} · ${t('mafia.day', { n: st.day })}` });
    }
    if (st.phase === 'morning') {
      sfx.go();
      chat.add({ sys: true, text: `🌅 ${hint()}` });
    }
    if (st.phase === 'vote') sfx.turn();
    if (st.phase === 'verdict') chat.add({ sys: true, text: `⚖️ ${hint()}` });
    if (st.phase === 'intro' && me) {
      showRole = true;
      toast(`${ROLE_ICON[me.role]} ${t('mafia.youAre', { role: t('mafia.role.' + me.role) })}`, 3500);
    }
  }

  return {
    msg(d) {
      if (d.t === 'chat') return chat.add(d);
      if (d.t === 'me') {
        const prevChecks = me?.checks || {};
        const first = !me;
        me = d;
        for (const [id, isMafia] of Object.entries(d.checks)) if (!(id in prevChecks)) toast(isMafia ? `🔪 ${t('mafia.checkMafia', { name: name(id) })}` : `✅ ${t('mafia.checkClean', { name: name(id) })}`, 3500);
        if (first && st?.phase === 'intro') {
          lastPhase = '';
          onPhase();
        }
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
