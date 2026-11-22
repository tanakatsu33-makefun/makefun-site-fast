// Draws extra random cases with the kit's generator and answers them with the kit's oracle (the reference).
// usage: node tests/gen.mjs <out.json> <count> [firstSeed]
// The output file holds { cases: [{id, input}], expected: [answer] } and lives outside the repository (never committed).
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const KIT = process.env.KIT ?? '/workspace/makefun/sitegen/kit/site-generator-speed-01-run-20261122-kit';
const { streamFor } = await import(`${KIT}/program/generator/rng.ts`);
const { generate } = await import(`${KIT}/program/generator/subject/sites.mjs`);
const { run } = await import(`${KIT}/program/generator/oracle.js`);

const [out, countArg, firstArg] = process.argv.slice(2);
const count = Number(countArg ?? 6);
const first = Number(firstArg ?? 1);
const cases = [];
const expected = [];
for (let k = 0; k < count; k++) {
  const seed = createHash('sha256').update(`my-test-seed-${first + k}`).digest('hex');
  const input = generate(streamFor(seed, 'case', k), k);
  // the oracle answers a private copy, as the kit's draw.ts does
  const copy = JSON.parse(JSON.stringify(input));
  cases.push({ id: `t-${first + k}`, input });
  expected.push(JSON.parse(JSON.stringify(run(copy))));
}
writeFileSync(out, JSON.stringify({ cases, expected }));
console.log(`wrote ${count} cases to ${out}`);
