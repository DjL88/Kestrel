// A small Markdown reader for the admin console's Technical overview (docs/TECHNICAL-OVERVIEW.md). It understands only
// what that document uses: headings, paragraphs, bullet and numbered lists, tables, rules, **bold**, `code` and
// [links](url). It returns plain data; admin.js builds DOM nodes from it with textContent, so no HTML is ever injected.

/** Inline text as runs: { text } | { code } | { strong } | { link, href }. Only http(s), mailto and #anchors are links. */
export function inlineRuns(text) {
  const runs = [];
  const pattern = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) runs.push({ code: m[1] });
    else if (m[2] !== undefined) runs.push({ strong: m[2].replace(/\\\*/g, '*') });
    else if (/^(https?:|mailto:|#)/.test(m[4])) runs.push({ link: m[3], href: m[4] });
    else runs.push({ text: m[3] });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.map((r) => ('text' in r ? { text: r.text.replace(/\\\*/g, '*') } : r));
}

const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isDivider = (line) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

/** Block structure: heading, paragraph, list, table and rule. */
export function parseMarkdown(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) { blocks.push({ type: 'heading', level: heading[1].length, runs: inlineRuns(heading[2]) }); i++; continue; }
    if (/^-{3,}\s*$/.test(line)) { blocks.push({ type: 'rule' }); i++; continue; }
    if (line.trim().startsWith('|') && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const head = cellsOf(line).map(inlineRuns);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(cellsOf(lines[i]).map(inlineRuns)); i++; }
      blocks.push({ type: 'table', head, rows });
      continue;
    }
    const bullet = /^\s*[-*]\s+/;
    const number = /^\s*\d+\.\s+/;
    if (bullet.test(line) || number.test(line)) {
      const ordered = number.test(line);
      const marker = ordered ? number : bullet;
      const items = [];
      while (i < lines.length && marker.test(lines[i])) { items.push(inlineRuns(lines[i].replace(marker, ''))); i++; }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    const text = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4})\s/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) && !lines[i].trim().startsWith('|') && !/^-{3,}\s*$/.test(lines[i])) { text.push(lines[i].trim()); i++; }
    blocks.push({ type: 'paragraph', runs: inlineRuns(text.join(' ')) });
  }
  return blocks;
}
