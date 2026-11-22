// Compares solve.js's run() with the expected answers, case by case, key by key.
// usage: node tests/check.mjs <file.json> [<file.json> ...]
//   a file is either the kit's practice input dir's cases.json (then pair it with PRACTICE_EXPECTED) or a tests/gen.mjs file.
import { readFileSync } from 'node:fs';

const { run } = await import(new URL('../solve.js', import.meta.url).href);
const KIT = process.env.KIT ?? '/workspace/makefun/sitegen/kit/site-generator-speed-01-run-20261122-kit';

function load(file) {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  if (Array.isArray(j)) {
    const exp = JSON.parse(readFileSync(`${KIT}/practice/reference/expected.json`, 'utf8'));
    return { cases: j, expected: exp.cases.map((c) => c.output) };
  }
  return j;
}

let bad = 0;
let total = 0;
for (const file of process.argv.slice(2)) {
  const { cases, expected } = load(file);
  for (let k = 0; k < cases.length; k++) {
    total++;
    const got = run(JSON.parse(JSON.stringify(cases[k].input)));
    const want = expected[k];
    const gk = Object.keys(got).sort();
    const wk = Object.keys(want).sort();
    let problem = null;
    if (gk.length !== wk.length) problem = `key counts ${gk.length} vs ${wk.length}`;
    for (const key of wk) {
      if (problem) break;
      if (!(key in got)) problem = `missing ${key}`;
      else if (got[key] !== want[key]) {
        let i = 0;
        while (i < want[key].length && got[key][i] === want[key][i]) i++;
        problem = `${key} differs at ${i}: got ${JSON.stringify(got[key].slice(Math.max(0, i - 40), i + 60))} want ${JSON.stringify(want[key].slice(Math.max(0, i - 40), i + 60))}`;
      }
    }
    if (!problem) for (const key of gk) if (!(key in want)) problem = `extra ${key}`;
    if (problem) {
      bad++;
      console.log(`FAIL ${file} ${cases[k].id}: ${problem}`);
    }
  }
}
console.log(`${total - bad}/${total} cases identical`);
process.exit(bad ? 1 : 0);
