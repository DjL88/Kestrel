// InFlight website: language choice and text. The words themselves are in i18n-strings.js (one table, every language).
// Elements opt in with data-i18n="key" (text), data-i18n-html="key" (trusted markup from the table) and
// data-i18n-attr="aria-label:key;title:key". Scripts call KestrelI18n.t(key, vars) or KestrelI18n.bind(el, key, vars).
(() => {
  'use strict';
  const LANGUAGES = [
    ['en-GB', 'English (UK)'], ['en-US', 'English (US)'], ['cy', 'Cymraeg'], ['gd', 'Gàidhlig'], ['ga', 'Gaeilge'],
    ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['nl', 'Nederlands'], ['it', 'Italiano'], ['pt', 'Português'],
    ['da', 'Dansk'], ['sv', 'Svenska'], ['nb', 'Norsk bokmål'], ['fi', 'Suomi'], ['is', 'Íslenska'],
  ];
  const STRINGS = window.KESTREL_STRINGS || {};
  const SOURCE = 'en-GB';
  const STORAGE_KEY = 'kestrel-site-language';
  const supported = LANGUAGES.map(([code]) => code);

  /** Maps a browser language tag to a site language, or '' when there is none. */
  function match(tag) {
    if (!tag) return '';
    const lower = String(tag).toLowerCase();
    const exact = supported.find((code) => code.toLowerCase() === lower);
    if (exact) return exact;
    const base = lower.split('-')[0];
    if (base === 'en') return /-(us|pr|um|vi|as|gu|mp)$/.test(lower) ? 'en-US' : 'en-GB';
    if (base === 'no' || base === 'nn') return 'nb';
    return supported.find((code) => code === base) || '';
  }
  function detect() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (supported.includes(saved)) return saved;
    } catch { /* storage may be blocked */ }
    const wanted = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
    for (const tag of wanted) { const found = match(tag); if (found) return found; }
    return SOURCE;
  }

  let language = detect();
  const listeners = [];

  function t(key, vars) {
    const own = STRINGS[language] || {};
    let text = own[key] ?? (STRINGS[SOURCE] || {})[key] ?? key;
    if (vars) text = text.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));
    return text;
  }
  function applyTo(el) {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key, el.dataset.i18nVars ? JSON.parse(el.dataset.i18nVars) : undefined);
    if (el.dataset.i18nHtml) el.innerHTML = t(el.dataset.i18nHtml);
    if (el.dataset.i18nAttr) {
      for (const pair of el.dataset.i18nAttr.split(';')) {
        const [attr, attrKey] = pair.split(':');
        if (attr && attrKey) el.setAttribute(attr, t(attrKey));
      }
    }
  }
  function apply(root = document) {
    root.querySelectorAll('[data-i18n],[data-i18n-html],[data-i18n-attr]').forEach(applyTo);
    document.documentElement.lang = language;
    document.title = t('pageTitle');
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('metaDescription'));
  }
  /** Sets an element's text from the table and keeps it in step when the language changes. */
  function bind(el, key, vars) {
    el.dataset.i18n = key;
    if (vars) el.dataset.i18nVars = JSON.stringify(vars); else delete el.dataset.i18nVars;
    applyTo(el);
  }
  function setLanguage(next) {
    if (!supported.includes(next)) return;
    language = next;
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* storage may be blocked */ }
    apply();
    const select = document.getElementById('language-select');
    if (select) select.value = next;
    listeners.forEach((listener) => listener(next));
  }

  window.KestrelI18n = {
    t, bind, apply, setLanguage, match,
    onChange: (listener) => listeners.push(listener),
    get language() { return language; },
    languages: LANGUAGES,
  };

  const select = document.getElementById('language-select');
  if (select) {
    for (const [code, name] of LANGUAGES) {
      const option = new Option(name, code);
      option.lang = code;
      select.add(option);
    }
    select.value = language;
    select.addEventListener('change', () => setLanguage(select.value));
  }
  apply();
})();
