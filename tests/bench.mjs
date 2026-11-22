// CPU-time benchmark of whole driver processes (node main.ts) for my entry and for the reference (the kit's baseline).
// usage: node tests/bench.mjs [runs] [cases.json dir]   (default: 15 runs on the kit's practice input)
// Each run is `node main.ts` with MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR; CPU time = user + sys as bash's `time` reports it.
// Runs alternate between the entries; the trimmed mean drops the fastest and slowest fifth, as the contest's heat does.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const KIT = process.env.KIT ?? '/workspace/makefun/sitegen/kit/site-generator-speed-01-run-20261122-kit';
const runs = Number(process.argv[2] ?? 15);
const inDir = process.argv[3] ?? `${KIT}/practice/input`;
const root = new URL('..', import.meta.url).pathname;
const entries = [
  ['mine', `${root}main.ts`],
  ['reference', `${KIT}/baselines/makefun-site/main.ts`],
];
mkdirSync('/tmp/bench-out', { recursive: true });

function once(main) {
  const r = spawnSync('bash', ['-c', `TIMEFORMAT='%U %S'; time node ${main}`], {
    env: { ...process.env, MAKEFUN_INPUT_DIR: inDir, MAKEFUN_OUTPUT_DIR: '/tmp/bench-out' },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(r.stderr);
  const [u, s] = r.stderr.trim().split('\n').pop().split(' ').map(Number);
  return (u + s) * 1000;
}

const times = Object.fromEntries(entries.map(([n]) => [n, []]));
for (let i = 0; i < runs + 1; i++) {
  for (const [name, main] of entries) {
    const t = once(main);
    if (i > 0) times[name].push(t); // the first round is a warm-up
  }
}
const trimmed = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const cut = Math.floor(s.length / 5);
  const k = s.slice(cut, s.length - cut);
  return k.reduce((x, y) => x + y, 0) / k.length;
};
const res = {};
for (const [name] of entries) {
  res[name] = trimmed(times[name]);
  console.log(`${name.padEnd(10)} trimmed mean CPU ${res[name].toFixed(1)} ms  (min ${Math.min(...times[name]).toFixed(0)}, max ${Math.max(...times[name]).toFixed(0)}, n=${times[name].length})`);
}
console.log(`speedup x${(res.reference / res.mine).toFixed(2)}`);
