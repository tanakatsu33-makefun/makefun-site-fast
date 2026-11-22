// Test-only driver: like main.ts, but applies the V8 flags in EXP_FLAGS (space separated) with setFlagsFromString first,
// to A/B flag sets under the same conditions the real main.ts will use. Not used by the contest.
import { readFileSync, writeFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';

for (const f of (process.env.EXP_FLAGS ?? '').split(' ')) if (f !== '') setFlagsFromString(f);

const { run } = (await import(new URL('../solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };

const inDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const cases = JSON.parse(readFileSync(inDir + '/cases.json', 'utf8')) as { id: string; input: unknown }[];
const answers: unknown[] = [];
for (const c of cases) answers.push(run(c.input));
writeFileSync(outDir + '/answers.json', JSON.stringify(answers));
