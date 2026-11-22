// The driver the harness runs as `node /bot/main.ts`: reads every case from /input/cases.json, answers each one alone with
// run() from solve.js, and writes the answers, in order, to /output/answers.json.
// MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output outside a container.

import { readFileSync, writeFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';

// V8 tuning, set before solve.js is imported so all of its work runs under it. The run is short (about a quarter of a
// second of work), so TurboFan's concurrent compiler threads cost more CPU than the code they produce saves: with it off
// the sparkplug and maglev tiers still run the hot code. Measured on the practice set, this saves about 20% of the CPU time.
// (V8 12 is node 22's; an engine older than that keeps its defaults.) The baseline's incremental marking switch is kept.
const v8Major = Number.parseInt(process.versions.v8, 10);
if (v8Major >= 12) setFlagsFromString('--no-opt');
setFlagsFromString('--no-incremental-marking');

const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };

const inDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(inDir + '/cases.json', 'utf8')) as { id: string; input: unknown }[];
const answers: unknown[] = [];
for (const c of cases) answers.push(run(c.input));
writeFileSync(outDir + '/answers.json', JSON.stringify(answers));
