// InFlight client gallery: photographs a photographer chose to share, and nothing else (no menus, no editing, no
// project). The link's secret is in the address fragment (#t=…), which browsers never send to a server, and it is only
// ever posted to this site's own /v1/gallery routes (Firebase Hosting forwards them to the control plane).
const $ = (id) => document.getElementById(id);
const token = new URLSearchParams(location.hash.slice(1)).get('t') || '';
let password = '';
let gallery = null;
let index = 0;
const favourites = new Set();
const visitor = (() => {
  try {
    const saved = localStorage.getItem('inflight.gallery.visitor');
    if (saved) return saved;
    const made = crypto.randomUUID().replace(/-/g, '');
    localStorage.setItem('inflight.gallery.visitor', made);
    return made;
  } catch { return crypto.randomUUID().replace(/-/g, ''); }
})();

async function post(path, body) {
  const response = await fetch('/v1/gallery/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(data?.error?.message || 'Could not open the gallery. Try again shortly.'), { code: data?.error?.code });
  return data;
}

function say(text) { $('status').hidden = false; $('status').textContent = text; }
function note(text) { $('note').textContent = text; }

async function open() {
  if (!token) { say('This gallery link is incomplete. Ask the photographer to send it again.'); return; }
  try {
    gallery = await post('open', { token, ...(password ? { password } : {}) });
  } catch (error) {
    if (error.code === 'GALLERY_PASSWORD') { $('status').hidden = true; $('password-form').hidden = false; $('password').focus(); if (password) say('That password did not match.'); return; }
    say(error.message); return;
  }
  $('password-form').hidden = true; $('status').hidden = true;
  if (!gallery.photos.length) { say('The photographer has not published any photographs here yet.'); return; }
  $('viewer').hidden = false;
  $('title').textContent = gallery.name;
  $('proof').hidden = !gallery.watermark;
  $('expiry').textContent = 'This link works until ' + new Date(gallery.expiresAtMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + '.';
  const { allow } = gallery;
  $('actions').hidden = !(allow.favourites || allow.approval || allow.downloads);
  $('favourite').hidden = !allow.favourites;
  $('approve').hidden = !allow.approval;
  $('approve-all').hidden = !allow.approval;
  $('changes').hidden = !allow.approval;
  $('download').hidden = !allow.downloads;
  $('comment-form').hidden = !(allow.comments || allow.approval);
  $('comment').parentElement.querySelector('button[type=submit]').hidden = !allow.comments;
  const strip = $('filmstrip');
  strip.replaceChildren(...gallery.photos.map((photo, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', 'Photograph ' + (i + 1) + ' of ' + gallery.photos.length);
    const img = document.createElement('img');
    img.src = photo.url; img.alt = ''; img.loading = 'lazy';
    button.append(img);
    button.addEventListener('click', () => show(i));
    return button;
  }));
  show(0);
}

function show(i) {
  index = Math.max(0, Math.min(i, gallery.photos.length - 1));
  const photo = gallery.photos[index];
  $('photo').src = photo.url;
  $('photo').alt = 'Photograph ' + (index + 1) + ' of ' + gallery.photos.length;
  $('counter').textContent = (index + 1) + ' of ' + gallery.photos.length;
  $('download').href = photo.url;
  [...$('filmstrip').children].forEach((b, n) => b.setAttribute('aria-current', String(n === index)));
  const fav = favourites.has(photo.photoId);
  $('favourite').setAttribute('aria-pressed', String(fav));
  $('favourite').textContent = fav ? '★ Favourite (chosen)' : '☆ Favourite';
}

async function feedback(kind, extra = {}) {
  const photoId = kind === 'approve-all' ? null : gallery.photos[index].photoId;
  try {
    await post('feedback', { token, ...(password ? { password } : {}), visitor, photoId, kind, text: null, ...extra });
    return true;
  } catch (error) { note(error.message); return false; }
}

$('password-form').addEventListener('submit', (event) => { event.preventDefault(); password = $('password').value; void open(); });
$('favourite').addEventListener('click', async () => {
  const id = gallery.photos[index].photoId;
  const on = !favourites.has(id);
  if (await feedback(on ? 'favourite' : 'unfavourite')) { if (on) favourites.add(id); else favourites.delete(id); show(index); }
});
$('approve').addEventListener('click', async () => { if (await feedback('approve')) $('approve').textContent = 'Approved'; });
$('approve-all').addEventListener('click', async () => { if (await feedback('approve-all')) $('approve-all').textContent = 'Whole selection approved. Thank you.'; });
$('comment-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = $('comment').value.trim();
  if (text && await feedback('comment', { text })) { $('comment').value = ''; note('Comment sent. Thank you.'); }
});
$('changes').addEventListener('click', async () => {
  const text = $('comment').value.trim() || null;
  if (await feedback('request-changes', { text })) { $('comment').value = ''; note('Change request sent to the photographer.'); }
});
document.addEventListener('keydown', (event) => {
  if (!gallery || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
  if (event.key === 'ArrowRight') show(index + 1);
  if (event.key === 'ArrowLeft') show(index - 1);
});
// A new link pasted into the same tab changes only the fragment: start again with it.
window.addEventListener('hashchange', () => location.reload());
void open();
