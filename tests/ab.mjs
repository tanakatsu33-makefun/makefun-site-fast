// A/B of solve.js variants: for each file, N fresh `node --no-opt` processes each run the practice cases once and report
// the CPU (user + sys, all threads) of the run phase alone; alternating files, median and min.
// usage: node tests/ab.mjs <runs> <solveA.js> <solveB.js> ...
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const KIT = process.env.KIT ?? '/workspace/makefun/sitegen/kit/site-generator-speed-01-run-20261122-kit';
const runs = Number(process.argv[2]);
const files = process.argv.slice(3).map((f) => resolve(f));
const child = `
const { readFileSync } = require('node:fs');
const cases = JSON.parse(readFileSync(process.argv[1], 'utf8'));
import(process.argv[2]).then(({ run }) => {
  const c0 = process.cpuUsage();
  const answers = [];
  for (const c of cases) answers.push(run(c.input));
  const c1 = process.cpuUsage(c0);
  const s = JSON.stringify(answers);
  const c2 = process.cpuUsage(c0);
  console.log(JSON.stringify([(c1.user + c1.system) / 1000, (c2.user + c2.system) / 1000]));
});`;
const times = files.map(() => []);
for (let i = 0; i < runs; i++) {
  files.forEach((f, k) => {
    const r = spawnSync('node', ['--no-opt', '--no-incremental-marking', '-e', child, `${KIT}/practice/input/cases.json`, f], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
    times[k].push(JSON.parse(r.stdout));
  });
}
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
files.forEach((f, k) => {
  console.log(`${f.slice(-40).padEnd(42)} run ${med(times[k].map((t) => t[0])).toFixed(0)} ms   run+stringify ${med(times[k].map((t) => t[1])).toFixed(0)} ms`);
});
