// The driver the harness runs as `node /bot/main.ts`: reads every case from /input/cases.json, answers each one alone with
// run() from solve.js, and writes the answers, in order, to /output/answers.json.
// MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output outside a container.

import { readFileSync, writeFileSync } from 'node:fs';

const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };

const inDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(inDir + '/cases.json', 'utf8')) as { id: string; input: unknown }[];
const answers: unknown[] = [];
for (const c of cases) answers.push(run(c.input));
writeFileSync(outDir + '/answers.json', JSON.stringify(answers));
