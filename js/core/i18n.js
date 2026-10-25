import ru from '../i18n/ru.js';
import en from '../i18n/en.js';
import uk from '../i18n/uk.js';
import es from '../i18n/es.js';
import de from '../i18n/de.js';
import ru2 from '../i18n/ru2.js';
import en2 from '../i18n/en2.js';
import uk2 from '../i18n/uk2.js';
import es2 from '../i18n/es2.js';
import de2 from '../i18n/de2.js';

export const LANGS = [
  { id: 'ru', name: 'Русский', flag: '🇷🇺' },
  { id: 'uk', name: 'Українська', flag: '🇺🇦' },
  { id: 'en', name: 'English', flag: '🇬🇧' },
  { id: 'es', name: 'Español', flag: '🇪🇸' },
  { id: 'de', name: 'Deutsch', flag: '🇩🇪' },
];

export const DICTS = { ru: { ...ru, ...ru2 }, en: { ...en, ...en2 }, uk: { ...uk, ...uk2 }, es: { ...es, ...es2 }, de: { ...de, ...de2 } };

let lang = 'ru';
let rules = new Intl.PluralRules('ru');

export function detectLang() {
  const nav = (globalThis.navigator?.languages || [globalThis.navigator?.language || 'ru']).map((l) => String(l).slice(0, 2));
  return nav.find((l) => DICTS[l]) || 'en';
}

export function setLang(id) {
  lang = DICTS[id] ? id : 'ru';
  rules = new Intl.PluralRules(lang);
  if (globalThis.document) document.documentElement.lang = lang;
}

export const getLang = () => lang;

function lookup(key) {
  return DICTS[lang][key] ?? DICTS.en[key] ?? DICTS.ru[key];
}

function fill(s, vars) {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s;
}

// t('key', {name: 'Аня'}) → строка на текущем языке.
export function t(key, vars) {
  const v = lookup(key);
  if (v == null) return key;
  return fill(typeof v === 'string' ? v : v.other ?? v.many ?? '', vars);
}

// tn('n.words', 5) → «5 слов» с правильным склонением.
export function tn(key, n, vars = {}) {
  const v = lookup(key);
  if (v == null) return `${n} ${key}`;
  const s = typeof v === 'string' ? v : v[rules.select(n)] ?? v.other ?? v.many;
  return fill(s, { n, ...vars });
}

// Подставляет переводы в статичную разметку: data-i18n, data-i18n-ph, data-i18n-aria.
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
}
