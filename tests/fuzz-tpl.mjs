// Fuzzes the template engine and the whole build against the reference: small generated sites (sources from the kit's
// generator) get random template sets (nested loops, shadowing, odd paths, broken tags, deep and recursive includes).
// usage: node tests/fuzz-tpl.mjs [rounds] [seed] [cases.json from tests/gen.mjs]
import { readFileSync } from 'node:fs';

const KIT = process.env.KIT ?? '/workspace/makefun/sitegen/kit/site-generator-speed-01-run-20261122-kit';
const ref = await import(`${KIT}/baselines/makefun-site/vendor/makefun-site/index.js`);
const { run } = await import(new URL('../solve.js', import.meta.url).href);

const rounds = Number(process.argv[2] ?? 300);
let state = (Number(process.argv[3] ?? 1) * 2246822519) >>> 0 || 1;
const rnd = (n) => {
  state ^= state << 13;
  state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5;
  state >>>= 0;
  return state % n;
};
const pick = (a) => a[rnd(a.length)];
const chance = (p) => rnd(1000) < p * 1000;

const pool = JSON.parse(readFileSync(process.argv[4] ?? '/tmp/gen30.json', 'utf8')).cases.slice(0, 8);
const NAMES = ['head', 'header', 'footer', 'nav', 'card', 'tag-list', 'toc', 'pager', 'post', 'page', 'index', 'tag', 'tags', 'wide', 'meta', 'x1', 'x2', 'x3', 'loopy'];
const VARS = ['p', 't', 'h', 'x', 'loop', 'site', 'page', 'tag', 'recent', 'i'];
const PATHS = [
  'site.title', 'site.base_url', 'site', 'site.nope', 'page', 'page.title', 'page.tags', 'page.toc', 'page.newer', 'page.older.url', 'page.newer.title', 'page.content', 'page.is_post', 'page.date', 'page.summary', 'page.excerpt', 'page.reading_minutes', 'page.slug', 'page.toc.length', 'page.tags.length',
  'posts', 'posts.length', 'pager', 'pager.number', 'pager.total', 'pager.newer_url', 'pager.older_url', 'pager.url', 'tag', 'tag.name', 'tag.posts', 'tag.count', 'tag.slug', 'tags', 'tags.length', 'recent', 'recent.length',
  'p', 'p.title', 'p.tags', 'p.url', 'p.date_long', 'p.excerpt', 'p.summary', 'p.reading_minutes', 't', 't.url', 't.name', 't.slug', 't.count', 'h', 'h.html', 'h.id', 'h.level', 'x', 'x.title', 'x.name', 'i',
  'loop', 'loop.index', 'loop.first', 'loop.last', 'loop.length', 'loop.foo', 'loop.index.x', 'nope', 'nope.x', 'p.nope', 'constructor', 'toString', 'p.constructor', 'tags.constructor', 'length', 'loop.p',
];

let incLeft = 2;
function body(depth, myName) {
  if (depth === 0) incLeft = 2;
  let s = '';
  for (let n = rnd(depth > 2 ? 3 : 6) + 1; n > 0; n--) {
    const r = rnd(20);
    if (r < 4) s += pick(['<b>', '</b>\n', 'text ', '\n', ' ', '{', '}', '{ x }', '%', '{%', '{{', 'a}}b', '<i class="c">', '\t', '{x}']);
    else if (r < 9) s += `{{ ${pick(PATHS)} }}`;
    else if (r < 10) s += `{{{ ${pick(PATHS)} }}}`;
    else if (r < 12 && depth < 4) {
      const lead = pick(['', '', '  ', '\n', ' ']);
      const tail = pick(['\n', '\n', ' ', '']);
      s += `${lead}{% for ${pick(VARS)} in ${pick(PATHS)} %}${tail}${body(depth + 1, myName)}${lead}{% endfor %}${tail}`;
    } else if (r < 15 && depth < 4) {
      const lead = pick(['', '\n', '  ']);
      const tail = pick(['\n', '', ' ']);
      s += `${lead}{% if ${pick(['', '', 'not '])}${pick(PATHS)} %}${tail}${body(depth + 1, myName)}${chance(0.5) ? `${lead}{% else %}${tail}${body(depth + 1, myName)}` : ''}${lead}{% endif %}${tail}`;
    } else if (r < 19) {
      // at most two includes per template, so recursive includes stay linear instead of exploding
      if (incLeft-- > 0) s += `${pick(['', '  ', ''])}{% include "${chance(0.9) ? pick(NAMES) : 'missing'}" %}${pick(['\n', '', ' '])}`;
    }
    else if (chance(0.5)) s += pick(['{% oops %}', '{% for x in %}', '{% endif %}', '{% else %}', '{{ a b }}', '{{ 1x }}', '{{ }}', '{% include nothing %}', '{% for x in y.z %}', '{% if %}', '{{{ p.title }}', '{% endfor %}', '{% if page %}', '{%']);
  }
  return s;
}

function templatesFor() {
  const t = {};
  const required = ['head', 'header', 'footer', 'post', 'page', 'index', 'tag', 'tags'];
  for (const n of NAMES) {
    if (required.includes(n) ? chance(0.97) : chance(0.7)) {
      const layout = ['post', 'page', 'index', 'tag', 'tags', 'wide'].includes(n);
      t[n] = (layout && chance(0.8) ? `{% include "head" %}\n{% include "header" %}\n` : '') + body(0, n) + (layout && chance(0.8) ? '{{{ page.content }}}\n{% include "footer" %}\n' : '');
    }
  }
  if (chance(0.2)) t.loopy = '{{ site.title }}{% include "loopy" %}x';
  if (chance(0.2)) t.x1 = '{% include "x2" %}a';
  if (chance(0.2)) t.x2 = '{% include "x3" %}b';
  if (chance(0.2)) t.x3 = '{% include "x1" %}c';
  return t;
}

const same = (a, b) => {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return `key counts ${ka.length} vs ${kb.length}`;
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return `keys differ at ${ka[i]} / ${kb[i]}`;
    if (a[ka[i]] !== b[kb[i]]) {
      let k = 0;
      while (a[ka[i]][k] === b[kb[i]][k]) k++;
      return `${ka[i]} differs at ${k}: ref ${JSON.stringify(a[ka[i]].slice(Math.max(0, k - 50), k + 50))} mine ${JSON.stringify(b[kb[i]].slice(Math.max(0, k - 50), k + 50))}`;
    }
  }
  return null;
};

let bad = 0;
for (let k = 0; k < rounds; k++) {
  const base = pool[k % pool.length].input;
  // a smaller site: its statics and the first sources (so a round stays fast)
  const files = base.files.filter((f, i) => !f.path.endsWith('.md') || i % 6 === k % 6);
  const input = { site: { ...base.site, per_page: pick([1, 2, 3, 5]), recent: pick([0, 1, 3, 4]) }, templates: templatesFor(), files };
  let want;
  if (process.env.TRACE) process.stderr.write(`round ${k} ref\n`);
  try {
    want = ref.build(JSON.parse(JSON.stringify(input)));
  } catch {
    continue; // the reference itself gave up (an output beyond V8's string limit): no answer to match
  }
  let got;
  if (process.env.TRACE) process.stderr.write(`round ${k} mine\n`);
  try {
    got = run(JSON.parse(JSON.stringify(input)));
  } catch (e) {
    got = null;
    console.log(`round ${k}: mine threw ${e.stack}`);
  }
  const problem = got === null ? 'threw' : same(want, got);
  if (problem) {
    bad++;
    console.log(`round ${k} FAIL: ${problem}`);
    if (bad === 1) {
      console.log(JSON.stringify(input.templates, null, 1).slice(0, 4000));
    }
    if (bad >= 3) break;
  }
}
console.log(bad ? `${bad} FAILURES` : `template fuzz ok: ${rounds} rounds`);
process.exit(bad ? 1 : 0);
