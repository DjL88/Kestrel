(() => {
  const t = (key, fallback) => (window.KestrelI18n ? window.KestrelI18n.t(key) : fallback);
  const form = document.querySelector('#contact-form');
  const status = document.querySelector('#contact-status');
  const submit = form?.querySelector('button[type="submit"]');
  if (!form || !status || !submit) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const fields = new FormData(form);
    const body = {
      name: String(fields.get('name') ?? '').trim(),
      email: String(fields.get('email') ?? '').trim(),
      message: String(fields.get('message') ?? '').trim(),
      website: String(fields.get('website') ?? ''),
      consent: fields.has('consent'),
    };
    if (!body.name || !body.email || !body.message || !body.consent) {
      status.textContent = t('contactMissing', 'Enter your name, email and message, and tick the permission box.');
      return;
    }
    submit.disabled = true;
    status.textContent = t('contactSending', 'Sending your message…');
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 429) {
        status.textContent = t('contactTooMany', 'Too many messages just now. Please try again later.');
        return;
      }
      if (!response.ok || (await response.json()).received !== true) throw new Error('Message not confirmed');
      form.reset();
      status.textContent = t('contactReceived', 'Message received. We’ll reply by email.');
    } catch {
      status.textContent = t('contactFailed', 'We couldn’t confirm your message was received. Your message is still here if you’d like to try again.');
    } finally {
      submit.disabled = false;
    }
  });
  submit.disabled = false;
})();
