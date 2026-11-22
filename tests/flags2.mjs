// A/B of V8 flag sets applied in-process (setFlagsFromString, as main.ts does) via tests/main-exp.ts.
// usage: node tests/flags2.mjs <runs> "<flags A>" "<flags B>" ...   (an empty string is the default flags)
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const KIT = process.env.KIT ?? '/workspace/makefun/sitegen/kit/site-generator-speed-01-run-20261122-kit';
const root = new URL('..', import.meta.url).pathname;
const runs = Number(process.argv[2]);
const sets = process.argv.slice(3);
mkdirSync('/tmp/flags-out', { recursive: true });
const times = sets.map(() => []);
for (let i = 0; i < runs; i++) {
  sets.forEach((flags, k) => {
    const r = spawnSync('bash', ['-c', `TIMEFORMAT='%U %S'; time node ${root}tests/main-exp.ts`], {
      env: { ...process.env, EXP_FLAGS: flags, MAKEFUN_INPUT_DIR: `${KIT}/practice/input`, MAKEFUN_OUTPUT_DIR: '/tmp/flags-out' },
      encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(r.stderr);
    const [u, s] = r.stderr.trim().split('\n').pop().split(' ').map(Number);
    times[k].push((u + s) * 1000);
  });
}
sets.forEach((flags, k) => {
  const s = [...times[k]].sort((a, b) => a - b);
  console.log(`${(flags || '(default)').padEnd(70)} median ${s[s.length >> 1].toFixed(0)} ms  min ${s[0].toFixed(0)}`);
});
