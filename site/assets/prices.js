// InFlight website: the planned Pro price, from ONE table. These are tidy local prices near £29 / €29 / $29, not
// exchange-rate conversions. Prices are shown before any local tax until VAT and sales tax are confirmed.
// Nothing can be bought here: the Buy button stays disabled until checkout (Paddle) is live.
(() => {
  'use strict';
  const PRO_PRICE = { GBP: 29, EUR: 29, USD: 29, CAD: 39, AUD: 45, NZD: 49, CHF: 29, DKK: 299, SEK: 299, NOK: 299, ISK: 4490 };
  // The monthly option, also tidy local prices near £2.99. Not yet signed off by the owner for every currency.
  const PRO_MONTH = { GBP: 2.99, EUR: 2.99, USD: 2.99, CAD: 3.99, AUD: 4.49, NZD: 4.99, CHF: 2.99, DKK: 29, SEK: 29, NOK: 29, ISK: 449 };
  // Unambiguous where a plain symbol is clear; otherwise the prefixed symbol (CA$, A$, NZ$, CHF, kr).
  const NARROW = new Set(['GBP', 'EUR', 'USD']);
  const EURO = 'AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MC MT NL PT SI SK SM VA AD ME XK'.split(' ');
  const BY_REGION = { GB: 'GBP', IM: 'GBP', JE: 'GBP', GG: 'GBP', US: 'USD', CA: 'CAD', AU: 'AUD', NZ: 'NZD', CH: 'CHF', LI: 'CHF',
    DK: 'DKK', SE: 'SEK', NO: 'NOK', IS: 'ISK' };
  for (const region of EURO) BY_REGION[region] = 'EUR';
  // When the browser gives no region, the site language decides.
  const BY_LANGUAGE = { 'en-GB': 'GBP', 'en-US': 'USD', cy: 'GBP', gd: 'GBP', ga: 'EUR', fr: 'EUR', de: 'EUR', es: 'EUR', nl: 'EUR',
    it: 'EUR', pt: 'EUR', da: 'DKK', sv: 'SEK', nb: 'NOK', fi: 'EUR', is: 'ISK' };
  const STORAGE_KEY = 'kestrel-site-currency';
  const i18n = window.KestrelI18n;

  function regionOf(tag) {
    try { return new Intl.Locale(tag).region || ''; } catch { return (String(tag).split('-')[1] || '').toUpperCase(); }
  }
  function automatic() {
    const wanted = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
    for (const tag of wanted) {
      const region = regionOf(tag);
      if (region) return BY_REGION[region] || 'USD';
    }
    return BY_LANGUAGE[i18n ? i18n.language : 'en-GB'] || 'GBP';
  }
  function chosen() {
    try { const saved = localStorage.getItem(STORAGE_KEY); if (saved && PRO_PRICE[saved]) return saved; } catch { /* blocked */ }
    return 'auto';
  }
  function format(currency, locale, table = PRO_PRICE) {
    const amount = table[currency];
    const digits = Number.isInteger(amount) ? 0 : 2;
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: NARROW.has(currency) ? 'narrowSymbol' : 'symbol',
        minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
    } catch { return `${currency} ${amount}`; }
  }

  const select = document.getElementById('currency-select');
  // The pricing card and the plan choices (when shown) carry the same price.
  const prices = document.querySelectorAll('#pro-price, [data-pro-price]');
  const monthly = document.querySelectorAll('#pro-price-month, [data-pro-price-month]');
  function render() {
    const locale = i18n ? i18n.language : 'en-GB';
    const auto = automatic();
    const choice = chosen();
    const currency = choice === 'auto' ? auto : choice;
    for (const price of prices) { price.textContent = format(currency, locale); price.dataset.currency = currency; }
    for (const price of monthly) { price.textContent = format(currency, locale, PRO_MONTH); price.dataset.currency = currency; }
    if (select) {
      select.textContent = '';
      const t = (key, vars) => (i18n ? i18n.t(key, vars) : `Automatic (${vars.currency})`);
      select.add(new Option(t('currencyAuto', { currency: format(auto, locale) }), 'auto'));
      for (const code of Object.keys(PRO_PRICE)) select.add(new Option(`${code} · ${format(code, locale)}`, code));
      select.value = choice;
    }
  }
  select?.addEventListener('change', () => {
    try { if (select.value === 'auto') localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, select.value); } catch { /* blocked */ }
    render();
  });
  i18n?.onChange(render);
  window.KestrelPrices = { PRO_PRICE, PRO_MONTH, automatic, format };
  render();
})();
