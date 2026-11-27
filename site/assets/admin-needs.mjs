// "Needs you" and the console's pages. Pure: it takes what the console already loaded and returns only the things a
// person has to act on, and which page a link opens. A source that could not be read is reported as unknown, never as
// "all good".

const DAY = 86_400_000;
const plural = (n, one, many = one + 's') => n + ' ' + (n === 1 ? one : many);

/**
 * @param {object} d whatever loaded; a key that is `undefined` was not read, `null` means "could not be read".
 * @param {number} nowMs
 * @returns {{ items: Array<{ id: string, urgent: boolean, title: string, detail: string, view: string }>, unknown: string[] }}
 */
export function needsYou(d, nowMs = Date.now()) {
  const items = [];
  const unknown = [];
  const add = (id, title, detail, view, urgent = false) => items.push({ id, urgent, title, detail, view });

  if (d.refunds === null) unknown.push('refunds owed');
  else if (d.refunds?.length) {
    const pence = d.refunds.reduce((sum, r) => sum + (r.pence ?? 0), 0);
    add('refunds', plural(d.refunds.length, 'refund') + ' owed after account deletion',
      '£' + (pence / 100).toFixed(2) + ' in unused cloud balance to pay back through Paddle, then mark each one refunded.', 'refunds');
  }

  if (d.safety === null) unknown.push('safety');
  else if (d.safety) {
    const open = (Array.isArray(d.safety.notices) ? d.safety.notices : []).filter(n => n.status === 'open');
    const urgent = open.some(n => n.urgent);
    if (open.length) add('safety-notices', plural(open.length, 'gallery report') + ' to answer' + (urgent ? ' (urgent)' : ''),
      'Choose no action, remove the photo or revoke the gallery. The reporter sees your reason.', 'safety', urgent);
  }

  if (d.messages === null) unknown.push('messages');
  else if (d.messages) {
    const fresh = d.messages.filter(m => m.status === 'new');
    if (fresh.length) add('messages', plural(fresh.length, 'new message'), 'From the website contact form. Reply from your own email, then mark it answered.', 'messages');
  }

  const contactMail = d.overview?.contactMailProblem;
  if (contactMail) add('contact-mail', 'A contact message could not be emailed to you',
    'It is safe in Messages: ' + contactMail.problem + '. Check Emails under Switches; this clears when the next message is emailed.', 'messages');

  if (d.paddleKey?.lastRunOk === false) add('paddle-key', 'The weekly Paddle key renewal failed',
    (d.paddleKey.lastRunReason ? d.paddleKey.lastRunReason + '. ' : '') + 'It tries again next week; renew the key in Paddle if it keeps failing.', 'payments', true);
  else if (d.paddleKey?.expiresAt && Date.parse(d.paddleKey.expiresAt) - nowMs < 14 * DAY) add('paddle-key', 'The Paddle API key expires soon',
    'It expires on ' + d.paddleKey.expiresAt.slice(0, 10) + ' and has not renewed itself. Renew it in Paddle.', 'payments', true);

  // Self-healing things stay off this list: one failed learning batch retries by itself, and email over the daily
  // limit waits for tomorrow by itself. Only a job that keeps failing needs a person.
  const runs = d.learning?.runs ?? [];
  if (runs.length >= 2 && runs[0].status === 'failed' && runs[1].status === 'failed') add('learning', 'Model training has failed twice in a row',
    'Each failed batch still counts towards this month’s training limit. Check the training job log, or switch Model training off until it is fixed.', 'learning');

  const t = d.tax?.turnover;
  if (t?.backward || t?.forward) add('vat', 'UK VAT registration is due',
    'Tell HMRC by ' + (t.backward ?? t.forward).notificationDue + '.', 'tax', true);

  items.sort((a, b) => Number(b.urgent) - Number(a.urgent));
  return { items, unknown };
}

/**
 * The console's pages, in the order of the menu. Each lists the sections it shows. The hash is a page name or any
 * section inside one, so a link straight to a section (#refunds, #flags) opens its page and scrolls to it.
 */
export const VIEWS = {
  today: { label: 'Today', sections: ['today', 'needs'] },
  switches: { label: 'Switches', sections: ['switches'] },
  people: { label: 'People and licences', sections: ['grant', 'licensees', 'issue', 'revoke', 'usage'] },
  money: { label: 'Payments and money', sections: ['payments', 'refunds', 'accounts', 'pricing'] },
  messages: { label: 'Messages', sections: ['messages', 'safety', 'news'] },
  advanced: { label: 'Advanced', sections: ['flags', 'monitoring', 'audit', 'tax', 'price-review', 'mail', 'learning', 'compliance', 'overview', 'notifications'] },
};

/** Page names from the earlier console, so old bookmarks still land somewhere sensible. */
const OLD_NAMES = { licences: 'people', service: 'advanced', records: 'advanced', news: 'messages' };

/** The page a location hash opens: a page name, an older page name, or any section inside a page. Else Today. */
export function viewForHash(hash) {
  const id = String(hash ?? '').replace(/^#/, '');
  if (VIEWS[id]) return id;
  if (OLD_NAMES[id]) return OLD_NAMES[id];
  for (const [name, view] of Object.entries(VIEWS)) if (view.sections.includes(id)) return name;
  return 'today';
}
