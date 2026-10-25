import { esc } from '../core/util.js';
import { avatar } from '../ui/common.js';

// Общий чат для «Мафии» и «Бункера»: лента сообщений и поле ввода.
// Реплики ботов приходят ключом перевода — их собирает format().
export function chatBox(root, api, { format, placeholder }) {
  root.innerHTML = `<div class="ct-feed"></div>
    <form class="ct-form" autocomplete="off"><input class="ct-input" maxlength="160" enterkeyhint="send" placeholder="${esc(placeholder)}"><button class="btn primary" type="submit">➤</button></form>`;
  const feed = root.querySelector('.ct-feed');
  const form = root.querySelector('.ct-form');
  const input = root.querySelector('.ct-input');
  const seen = new Set();
  let onSend = null;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || !onSend) return;
    onSend(text);
    input.value = '';
  });

  return {
    add(m) {
      if (m.k && seen.has(m.k)) return;
      if (m.k) seen.add(m.k);
      const s = api.seat(m.id);
      const text = m.text != null ? esc(m.text) : format(m);
      const el = document.createElement('div');
      el.className = `ct-msg ${m.id === api.me ? 'me' : ''} ${m.night ? 'night' : ''} ${m.sys ? 'sys' : ''}`;
      el.innerHTML = m.sys ? `<span>${text}</span>` : `${avatar(s, 22)}<div><b style="color:${s?.color || 'inherit'}">${esc(s?.name || '?')}</b> ${text}</div>`;
      const stick = feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 30;
      feed.append(el);
      while (feed.children.length > 80) feed.firstChild.remove();
      if (stick) feed.scrollTop = feed.scrollHeight;
    },
    enable(on, ph) {
      form.hidden = !on;
      if (ph) input.placeholder = ph;
    },
    onSend(fn) {
      onSend = fn;
    },
  };
}
