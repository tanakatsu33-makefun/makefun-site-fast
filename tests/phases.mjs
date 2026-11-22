// In-process timing: where does the CPU time go for solve.js (JSON.parse, run per case, JSON.stringify)?
// usage: node tests/phases.mjs [solve path] [cases.json]
import { readFileSync } from 'node:fs';

const KIT = process.env.KIT ?? '/workspace/makefun/sitegen/kit/site-generator-speed-01-run-20261122-kit';
const solvePath = process.argv[2] ?? new URL('../solve.js', import.meta.url).pathname;
const casesPath = process.argv[3] ?? `${KIT}/practice/input/cases.json`;
const cpu = () => {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
};
let t = cpu();
const lap = (label) => {
  const n = cpu();
  console.log(`${label.padEnd(22)} ${(n - t).toFixed(1)} ms`);
  t = n;
};
const text = readFileSync(casesPath, 'utf8');
lap('read');
const cases = JSON.parse(text);
lap('JSON.parse');
const { run } = await import(solvePath);
lap('import solve');
const answers = [];
for (const c of cases) {
  answers.push(run(c.input));
  lap(`run ${c.id}`);
}
const s = JSON.stringify(answers);
lap(`JSON.stringify (${(s.length / 1e6).toFixed(1)} MB)`);
