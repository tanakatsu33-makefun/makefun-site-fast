// Fuzzes the pieces of solve.js (inline Markdown, blocks, front matter, slugs, whitespace) against the reference's own
// modules, on random strings built from tricky tokens. usage: node tests/fuzz-md.mjs [rounds] [seed]
const KIT = process.env.KIT ?? '/workspace/makefun/sitegen/kit/site-generator-speed-01-run-20261122-kit';
const V = `${KIT}/baselines/makefun-site/vendor/makefun-site`;
const ref = await import(`${V}/lib/markdown.js`);
const refFm = await import(`${V}/lib/frontmatter.js`);
const refText = await import(`${V}/lib/text.js`);
const { __test: mine } = await import(new URL('../solve.js', import.meta.url).href);

const rounds = Number(process.argv[2] ?? 20000);
let state = (Number(process.argv[3] ?? 1) * 2654435761) >>> 0 || 1;
const rnd = (n) => {
  state ^= state << 13;
  state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5;
  state >>>= 0;
  return state % n;
};
const pick = (a) => a[rnd(a.length)];
const link = (t) => (t.startsWith('x') ? `/L/${t}` : t);
const env = { link };

const INL = ['*', '**', '***', '`', '``', '[', ']', '(', ')', '\\', '\\\\', '\\*', '\\]', 'a', 'b c', ' ', '&', '<', '>', '"', "'", '\n', '_', 'xurl', 'http://x.y/z', '#', '-', ' ', ' ', 'é', '](', '](x)', '[a](xb)', '\t', '　', '﻿', '\\`', '\\>'];
const LINES = ['', ' ', '\t', '# h', '## Héllo & wörld', '### y #', '#', '# ', '#######', '####### x', '#x', '```', '```js', '``` ', '```c++', '```a b', '````', '---', '***', '--- ', '----', '> q', '>q', '>', '> ', '>  *e*', '- a', '* b', '-', '- ', '1. x', '3. y', '007. z', '1.x', '12345678901. z', '  cont', ' one', '   three  ', '\t- x', 'text *e* **s**', 'para [l](xu) and [m](https://a.b/c)', 'a b', '- a ', '# h ', '   x', '1. a ', 'plain', 'trailing  ', '  lead', '`code` & <b>', '**bold', 'x]', '# Same', '## Same', '### Same', '## Ünï', '* * *', '- - -', '2. two', '10. ten'];

const diff = (name, input, a, b) => {
  console.log(`MISMATCH ${name}: ${JSON.stringify(input)}\n  ref : ${JSON.stringify(a)}\n  mine: ${JSON.stringify(b)}`);
  process.exit(1);
};

// whitespace, all of UTF-16
for (let c = 0; c < 65536; c++) {
  const ch = String.fromCharCode(c);
  if (mine.isWs(c) !== /\s/.test(ch)) diff('isWs', c, /\s/.test(ch), mine.isWs(c));
}
for (let k = 0; k < rounds; k++) {
  // inline
  let s = '';
  for (let n = rnd(24); n > 0; n--) s += pick(INL);
  const a = ref.inline(s, env);
  const b = mine.inline(s, link);
  if (a !== b) diff('inline', s, a, b);
  // blocks
  const lines = [];
  for (let n = rnd(16); n > 0; n--) lines.push(pick(LINES));
  const src = lines.join('\n') + (rnd(2) ? '\n' : '');
  const ra = ref.renderMarkdown(src, env);
  const rb = mine.markdown(src, link);
  if (JSON.stringify(ra) !== JSON.stringify(rb)) diff('markdown', src, ra, rb);
  // words
  const words = (src.match(/\S+/g) ?? []).length;
  if (mine.wordCount(src) !== words) diff('words', src, words, mine.wordCount(src));
  // slug
  let t = '';
  for (let n = rnd(12); n > 0; n--) t += pick(['a', 'B', ' ', '-', 'é', 'Füße', 'ß', 'Ｗｉｄｅ', 'ﬁ', 'α', '中', '😀', '9', '  ', '́', 'x'.repeat(30), '_']);
  if (refText.slugify(t) !== mine.slugify(t)) diff('slugify', t, refText.slugify(t), mine.slugify(t));
  // escape
  if (refText.escapeHtml(s) !== mine.esc(s)) diff('esc', s, refText.escapeHtml(s), mine.esc(s));
}

// front matter
const FM = ['---', '---', '---', 'title: T', 'title: "Q \\" x"', 'title: "a\\\\"', 'title: "unclosed', 'title: [x', 'title: ', 'title:', 'title:x', 'title: A  \t', 'date: 2026-02-29', 'date: 2024-02-29', 'date: 2026-11-09', 'date: 1969-01-01', 'date: 2100-01-01', 'tags: [a, b ,c]', 'tags: []', 'tags: [ ]', 'tags: [a,,b]', 'tags: ["x"]', 'tags: a', 'tags: [a, b', 'draft: true', 'draft: false', 'draft: yes', 'layout: post', 'layout: Post', 'slug: a-b', 'slug: a--b', 'slug: ' + 'x'.repeat(65), 'summary: s', 'summary: "s"', 'summary:', '# comment', '', ' ', '\t', 'Title: x', 'foo: bar', 'a-b: c', 'title: x y', 'tags: [é, ü]', 'key', ': x', 'body text', '## heading'];
for (let k = 0; k < rounds; k++) {
  const lines = [];
  if (rnd(30) !== 0) lines.push('---');
  for (let n = rnd(9); n > 0; n--) lines.push(pick(FM));
  if (rnd(10) !== 0) lines.push('---');
  for (let n = rnd(4); n > 0; n--) lines.push(pick(LINES));
  const text = lines.join('\n') + (rnd(2) ? '\n' : '');
  const a = refFm.parseFrontMatter(text);
  const b = mine.front(text);
  const same = 'error' in a ? b.error === a.error : !b.error && b.body === a.body && JSON.stringify(Object.entries(a.data).sort()) === JSON.stringify(Object.entries(b.data).filter(([, v]) => v !== undefined).sort());
  if (!same) diff('front', text, a, b);
}
console.log(`fuzz ok: ${rounds} rounds`);
