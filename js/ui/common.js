import { esc } from '../core/util.js';
import { t } from '../core/i18n.js';
import { SUIT_SYMBOL, isRed } from '../games/cards/deck.js';

// Аватар игрока: эмодзи в рамке выбранной формы и цвета.
export function avatar(p, size = 40, cls = '') {
  if (!p) return '';
  return `<span class="ava shape-${p.shape || 'circle'} ${cls}" style="--ac:${p.color || '#888'};--as:${size}px" aria-hidden="true"><i>${esc(p.avatar || '🙂')}</i></span>`;
}

export function rankLabel(r) {
  if (r === 'T') return '10';
  return 'JQKA'.includes(r) ? t('rank.' + r) : r;
}

// Игральная карта. '??' или пусто — рубашкой вверх.
export function card(c, cls = '') {
  if (!c || c === '??') return `<div class="pc back ${cls}"></div>`;
  return `<div class="pc ${isRed(c) ? 'red' : 'black'} ${cls}" data-card="${c}"><span class="pc-r">${rankLabel(c[0])}<br>${SUIT_SYMBOL[c[1]]}</span><span class="pc-s">${SUIT_SYMBOL[c[1]]}</span></div>`;
}

export const suitSymbol = (s) => SUIT_SYMBOL[s] || '';

export function toast(text, ms = 2200) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.append(el);
  }
  el.textContent = text;
  el.hidden = false;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), ms);
}

// Простое модальное окно: заголовок, текст и кнопки. Возвращает выбранный id.
export function modal({ title = '', text = '', html = '', buttons = [{ id: 'ok', label: 'OK', primary: true }] }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal card" role="dialog" aria-modal="true">
      ${title ? `<h3>${esc(title)}</h3>` : ''}${text ? `<p>${esc(text)}</p>` : ''}${html}
      <div class="modal-btns">${buttons
        .map((b) => `<button class="btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}" data-id="${b.id}">${esc(b.label)}</button>`)
        .join('')}</div></div>`;
    const done = (id) => {
      // Значения полей ввода сохраняем до того, как окно исчезнет.
      modal.values = Object.fromEntries([...wrap.querySelectorAll('input[id]')].map((i) => [i.id, i.value]));
      wrap.remove();
      resolve(id);
    };
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-id]');
      if (b) done(b.dataset.id);
      else if (e.target === wrap) done(null);
    });
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') done(buttons.find((b) => b.primary)?.id ?? buttons[0].id);
      if (e.key === 'Escape') done(null);
    });
    document.body.append(wrap);
    (wrap.querySelector('input') || wrap.querySelector('.btn.primary, .btn'))?.focus();
  });
}

export const confirmBox = (text, yes, no = t('common.cancel')) =>
  modal({ text, buttons: [{ id: 'no', label: no }, { id: 'yes', label: yes, primary: true }] }).then((r) => r === 'yes');

// Полоска таймера: обновляется сама, пока жив элемент.
export function timerBar(el, leftMs, totalMs) {
  const fill = el.querySelector('.tb-fill') || el.appendChild(Object.assign(document.createElement('div'), { className: 'tb-fill' }));
  const end = performance.now() + leftMs;
  cancelAnimationFrame(el._raf);
  const tick = () => {
    const left = Math.max(0, end - performance.now());
    fill.style.transform = `scaleX(${totalMs ? left / totalMs : 0})`;
    el.classList.toggle('low', left < 5000);
    if (left > 0 && el.isConnected) el._raf = requestAnimationFrame(tick);
  };
  tick();
}

export function stopTimerBar(el) {
  if (!el) return;
  cancelAnimationFrame(el._raf);
  const fill = el.querySelector('.tb-fill');
  if (fill) fill.style.transform = 'scaleX(0)';
}

// Нажатие «сразу при касании» — для игр на скорость.
export function onTap(el, fn) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    fn(e);
  });
  el.addEventListener('click', (e) => {
    if (e.detail === 0) fn(e);
  });
}
