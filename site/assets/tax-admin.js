const get = id => document.getElementById(id);
const signIn = get('sign-in');
const dashboard = get('dashboard');
const settingsForm = get('tax-settings');
const ossForm = get('oss');
const status = get('status');
let token;
let localTaxes = {};
const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const now = new Date();
ossForm.elements.year.value = now.getFullYear();
ossForm.elements.quarter.value = Math.floor(now.getMonth() / 3) + 1;

async function api(path, body) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch('/v1/' + path, {
    method: body ? 'POST' : 'GET', headers,
    body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
  });
  if (response.status === 401 && token) resetSession();
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('The admin service is unavailable.');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? 'The request could not be completed.');
  return result;
}

function resetSession() {
  token = undefined;
  localTaxes = {};
  settingsForm.reset();
  get('turnover').value = 0;
  get('turnover-value').textContent = '';
  get('turnover-state').textContent = '';
  dashboard.hidden = true;
  signIn.hidden = false;
}

async function updateDashboard() {
  const { settings, turnover, thresholdPence, warningPence } = await api('admin/tax');
  get('turnover').max = thresholdPence / 100;
  get('turnover').value = Math.max(0, turnover.rollingPence / 100);
  get('turnover-value').textContent = money.format(turnover.rollingPence / 100) + ' of ' + money.format(thresholdPence / 100);
  const notices = [];
  if (turnover.state === 'warning') notices.push('Turnover has reached the ' + money.format(warningPence / 100) + ' warning level.');
  if (turnover.backward) notices.push('Month-end breach. Notify HMRC by ' + turnover.backward.notificationDue + '. Effective date ' + turnover.backward.effectiveDate + '.');
  if (turnover.forward) notices.push('30-day forecast breach. Notify HMRC by ' + turnover.forward.notificationDue + '. Effective date ' + turnover.forward.effectiveDate + '.');
  get('turnover-state').textContent = notices.join(' ');
  settingsForm.elements.ukVatRegistered.checked = settings.ukVatRegistered;
  settingsForm.elements.ukVatNumber.value = settings.ukVatNumber ?? '';
  settingsForm.elements.b2cPricing.value = settings.b2cPricing;
  localTaxes = settings.localTaxes;
}

function listen(element, event, work) {
  element.addEventListener(event, async event => {
    event.preventDefault();
    const button = element.querySelector('button') ?? element;
    button.disabled = true;
    status.textContent = '';
    try { await work(); }
    catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
}

listen(signIn, 'submit', async () => {
  const { email, password } = Object.fromEntries(new FormData(signIn));
  signIn.elements.password.value = '';
  const session = await api('auth/session', { email, password });
  token = session.accessToken;
  try { await updateDashboard(); }
  catch (error) { resetSession(); throw error; }
  signIn.hidden = true;
  dashboard.hidden = false;
  get('sign-out').focus();
});

listen(get('sign-out'), 'click', () => {
  resetSession();
  signIn.elements.email.focus();
});

listen(get('refresh'), 'click', updateDashboard);

listen(settingsForm, 'submit', async () => {
  const { ukVatRegistered, ukVatNumber, b2cPricing } = settingsForm.elements;
  await api('admin/tax/settings', {
    ukVatRegistered: ukVatRegistered.checked,
    ukVatNumber: ukVatNumber.value,
    b2cPricing: b2cPricing.value,
    localTaxes,
  });
  status.textContent = 'Tax settings saved.';
});

listen(ossForm, 'submit', async () => {
  const parameters = new URLSearchParams(new FormData(ossForm));
  const { year, quarter, rows } = await api('admin/tax/oss?' + parameters);
  const lines = ['country,rate_basis_points,net_gbp_pence,tax_gbp_pence'];
  for (const row of rows) lines.push([row.country, row.rateBasisPoints, row.netPence, row.taxPence].join(','));
  const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'kestrel-oss-' + year + '-Q' + quarter + '.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status.textContent = 'Quarterly summary downloaded.';
});
