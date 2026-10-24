import { Board } from './board.js';
import { LEVELS } from './logic.js';
import { sfx } from '../../core/sfx.js';
import { esc } from '../../core/util.js';
import { avatar } from '../../ui/common.js';

const MEDALS = ['🥇', '🥈', '🥉'];

// Экран «Слов»: полоска игроков сверху и поле с буквами (или два поля
// «лицом к лицу», если играют вдвоём на одном телефоне).
export function mount(root, api) {
  const { t, tn } = api;
  const split = api.localSeats.length > 1;
  const mine = api.localSeats.filter((id) => api.seat(id));
  root.innerHTML = `
    <div class="w-strip" ${split ? 'hidden' : ''}></div>
    <div class="w-boards ${split ? 'split' : ''}"></div>
    <div class="w-over" hidden></div>`;
  const strip = root.querySelector('.w-strip');
  const wrap = root.querySelector('.w-boards');
  const over = root.querySelector('.w-over');
  const boards = {};
  let scores = Object.fromEntries(api.seats.map((s) => [s.id, 0]));
  let round = null;
  let level = null;
  let prog = {};
  let order = [];
  let first = null;
  let cdTimer = null;
  let nextTimer = null;

  const mk = (id, cls) => {
    const el = document.createElement('div');
    el.className = `board ${cls}`;
    el.style.setProperty('--pc', api.seat(id)?.color || '#4dabf7');
    wrap.append(el);
    boards[id] = new Board(el, {
      ticks: id === api.me,
      onSolve: ({ ms, hints }) => api.act({ t: 'solve', i: round?.i, ms, hints }, id),
      onProgress: (n) => api.act({ t: 'prog', i: round?.i, n }, id),
    });
  };
  if (split) {
    mk(mine[1], 'flipped');
    const mid = document.createElement('div');
    mid.className = 'midstrip';
    mid.innerHTML = `<span class="ms-level"></span><span class="ms-count"></span>`;
    wrap.append(mid);
    mk(mine[0], '');
  } else if (mine.length) {
    mk(mine[0], '');
  } else {
    wrap.innerHTML = `<div class="spectate card">${t('game.spectating')}</div>`;
  }

  function renderStrip() {
    if (split) {
      for (const id of mine) boards[id]?.setHead(api.seat(id).name, scores[id] ?? 0);
      return;
    }
    const lead = Math.max(...Object.values(scores));
    strip.innerHTML = api.seats
      .map((s) => {
        const place = order.indexOf(s.id);
        const len = round?.word?.length || 1;
        const pct = place >= 0 ? 100 : Math.round(((prog[s.id] || 0) / len) * 100);
        const badge = place >= 0 ? MEDALS[place] || `#${place + 1}` : s.id === first ? '⚡' : '';
        return `<div class="w-chip ${s.id === api.me ? 'me' : ''} ${place >= 0 ? 'done' : ''}" style="--pc:${s.color}">
          ${avatar(s, 28)}
          <div class="w-chip-txt"><span class="w-name">${esc(s.name)}${lead > 0 && scores[s.id] === lead ? ' 👑' : ''}</span><b>${scores[s.id] ?? 0}</b></div>
          <span class="w-badge">${badge}</span>
          <i class="w-prog" style="width:${pct}%"></i>
        </div>`;
      })
      .join('');
  }

  function setLabels(a, b) {
    api.setInfo(`${a} · ${b}`);
    root.querySelectorAll('.ms-level').forEach((el) => (el.textContent = a));
    root.querySelectorAll('.ms-count').forEach((el) => (el.textContent = b));
  }

  function countdown(d) {
    clearInterval(cdTimer);
    const lv = LEVELS[d.level - 1];
    const copies = split ? 2 : 1;
    const draw = (n) => {
      over.innerHTML = Array.from(
        { length: copies },
        (_, k) => `<div class="cd ${k ? 'flipped' : ''}">
          <div class="cd-level">${t('words.level', { n: d.level })} · ${t('words.tier' + lv.tier)}</div>
          <div class="cd-info">${tn('n.words', d.total)} · ${tn('n.letters', lv.len[0])}${lv.len[1] > lv.len[0] ? '–' + lv.len[1] : ''} · ${t('words.perWord', { s: d.time })}</div>
          <div class="cd-num">${n}</div></div>`,
      ).join('');
    };
    over.hidden = false;
    over.className = 'w-over countdown';
    let n = 3;
    draw(n);
    sfx.tick();
    cdTimer = setInterval(() => {
      if (--n <= 0) return clearInterval(cdTimer);
      draw(n);
      sfx.tick();
    }, d.countdown / 3);
  }

  function levelEnd(d) {
    clearInterval(nextTimer);
    const rows = api.seats
      .slice()
      .sort((a, b) => (d.scores[b.id] || 0) - (d.scores[a.id] || 0))
      .map(
        (s, i) => `<tr class="${s.id === api.me ? 'me' : ''}"><td>${MEDALS[i] || i + 1}</td><td>${avatar(s, 24)} ${esc(s.name)}</td>
          <td>+${d.levelScores[s.id] || 0}</td><td><b>${d.scores[s.id] || 0}</b></td></tr>`,
      )
      .join('');
    const words = d.history.map((h) => `<span class="w-hist ${h.winner ? '' : 'none'}" style="--pc:${api.seat(h.winner)?.color || '#888'}">${h.word}</span>`).join('');
    const nl = LEVELS[d.next - 1];
    over.className = 'w-over level-end';
    over.hidden = false;
    over.innerHTML = `<div class="card le-card">
      <h2>${t('words.levelDone', { n: d.level })}</h2>
      <table class="tbl"><thead><tr><th></th><th></th><th>${t('words.thisLevel')}</th><th>${t('words.total')}</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="w-hists">${words}</div>
      <p class="muted">${t('words.next', { n: d.next })}: ${tn('n.words', nl.words)} · ${t('words.perWord', { s: nl.time })}</p>
      ${api.isHost ? `<button class="btn primary big" data-next>${t('words.goNext')} <span class="le-left"></span></button>` : `<p class="le-wait">${t('words.autoNext')} <span class="le-left"></span></p>`}
    </div>`;
    over.querySelector('[data-next]')?.addEventListener('click', () => api.act({ t: 'next' }));
    const end = Date.now() + d.left;
    const tick = () => {
      const s = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      over.querySelectorAll('.le-left').forEach((el) => (el.textContent = `(${s})`));
    };
    tick();
    nextTimer = setInterval(tick, 500);
  }

  function result(d) {
    scores = d.scores;
    order = d.order.map((o) => o.id);
    const winner = d.order[0];
    for (const id of mine) {
      const b = boards[id];
      const idx = order.indexOf(id);
      const word = `<span class="word">${d.word}</span>`;
      let outcome;
      let text;
      if (idx >= 0) {
        const o = d.order[idx];
        outcome = 'win';
        text = `${MEDALS[idx] || '✅'} <b>+${o.pts}</b> · ${(o.ms / 1000).toFixed(1)} ${t('common.sec')}`;
      } else if (winner) {
        outcome = 'lose';
        text = `⚡ ${t('words.faster', { name: esc(api.seat(winner.id)?.name || '?') })}<br>${word}`;
      } else {
        outcome = 'timeout';
        text = `⏰ ${t('words.timeUp')}<br>${word}`;
      }
      b?.showResult(d, { outcome, text });
    }
    if (split) (winner ? sfx.win : sfx.timeout)();
    else if (order[0] === api.me) sfx.win();
    else if (order.includes(api.me)) sfx.tap();
    else if (winner) sfx.lose();
    else sfx.timeout();
    renderStrip();
  }

  function msg(d) {
    switch (d.t) {
      case 'level': {
        if (level && level.level === d.level && d.countdown === 0 && round) {
          scores = d.scores;
          renderStrip();
          break;
        }
        level = d;
        scores = d.scores;
        round = null;
        order = [];
        clearInterval(nextTimer);
        Object.values(boards).forEach((b) => b.idle());
        const lv = LEVELS[d.level - 1];
        setLabels(t('words.level', { n: d.level }), t('words.tier' + lv.tier));
        renderStrip();
        if (d.countdown > 0) countdown(d);
        else over.hidden = true;
        break;
      }
      case 'round':
        clearInterval(cdTimer);
        over.hidden = true;
        // При переподключении тот же раунд не сбрасываем — буквы остаются на местах.
        if (round && round.i === d.i && level && boards[api.me]?.r?.i === d.i && d.elapsed != null) break;
        round = d;
        scores = d.scores;
        prog = {};
        order = [];
        first = null;
        setLabels(t('words.level', { n: level?.level ?? '' }), t('words.wordOf', { i: d.i + 1, n: d.total }));
        Object.values(boards).forEach((b) => b.setRound(d));
        renderStrip();
        if (!d.elapsed) sfx.go();
        break;
      case 'prog':
        if (!round || d.i !== round.i) break;
        prog[d.p] = d.n;
        renderStrip();
        break;
      case 'first':
        first = d.p;
        renderStrip();
        break;
      case 'result':
        result(d);
        break;
      case 'levelEnd':
        Object.values(boards).forEach((b) => b.stopTimer());
        levelEnd(d);
        break;
    }
  }

  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, textarea')) return;
    const b = boards[api.me];
    if (!b) return;
    if (e.key === 'Backspace') e.preventDefault();
    b.handleKey(e);
  };
  document.addEventListener('keydown', onKey);

  return {
    msg,
    destroy() {
      clearInterval(cdTimer);
      clearInterval(nextTimer);
      document.removeEventListener('keydown', onKey);
      Object.values(boards).forEach((b) => b.destroy());
    },
  };
}
