import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PORTFOLIO_PHOTOS, buildPortfolioHtml, portfolioFileName, type PortfolioPage } from './portfolioPage.ts';

const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const labels = { photo: (n: number, total: number) => `Photo ${n} of ${total}`, footer: 'Made with InFlight.' };
const page = (over: Partial<PortfolioPage> = {}): PortfolioPage => ({ title: 'Kestrels', lang: 'en-GB', photos: [{ image: jpeg }, { image: jpeg, caption: 'Hovering' }], labels, ...over });

test('a portfolio is one self-contained page that loads nothing from the network and runs no script', () => {
  const html = buildPortfolioHtml(page());
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; img-src data:/);
  assert.doesNotMatch(html, /<script|<link|<iframe|https?:\/\//i);
  assert.equal(html.match(/<img /g)?.length, 2);
  assert.match(html, /alt="Photo 1 of 2"/);
  assert.match(html, /<figcaption>Photo 2 of 2 · Hovering<\/figcaption>/);
  assert.match(html, /<html lang="en-GB">/);
});

test('text the photographer types is escaped, and only embedded images are accepted', () => {
  const html = buildPortfolioHtml(page({ title: '<script>alert(1)</script>', byline: 'A & "B"', photos: [{ image: jpeg, caption: '<img src=x onerror=1>' }] }));
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /A &amp; &quot;B&quot;/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.throws(() => buildPortfolioHtml(page({ photos: [{ image: 'https://example.com/a.jpg' }] })), /not an embedded image/);
  assert.throws(() => buildPortfolioHtml(page({ photos: [{ image: 'data:image/jpeg;base64,AA" onload="x' }] })), /not an embedded image/);
  assert.throws(() => buildPortfolioHtml(page({ photos: [] })), /at least one/);
  assert.throws(() => buildPortfolioHtml(page({ photos: Array.from({ length: MAX_PORTFOLIO_PHOTOS + 1 }, () => ({ image: jpeg })) })), /at most/);
});

test('the file name is safe on every platform', () => {
  assert.equal(portfolioFileName('Birds: 2026/11'), 'Birds 2026 11 - portfolio.html');
  assert.equal(portfolioFileName('  '), 'Portfolio - portfolio.html');
  assert.equal(portfolioFileName('..hidden'), 'hidden - portfolio.html');
});
