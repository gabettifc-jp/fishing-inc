/* ============================================================================
   合図の形で回して、周ごとの投数のずれを見て値段を直す。収まるまで繰り返す。

   `prices.mjs` は「計画どおりに回して測る」道具だった。合図が入ると
   周の長さと値段が互いを決め合うので、**前から一回では解けない。**
   こちらは輪を回して詰める。

     node tools/tune.mjs             … 10回まわして結果を出す
     node tools/tune.mjs --write     … 収まった値を src/fishing-inc.html に書く
   ========================================================================== */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC  = path.resolve(HERE, '..', 'src', 'fishing-inc.html');
const SIM  = path.resolve(HERE, 'sim.mjs');
const WRITE = process.argv.includes('--write');
const ROUNDS = parseInt((process.argv.find(a => a.startsWith('--rounds=')) || '--rounds=10').split('=')[1], 10);

const TAME = [4, 7, 10, 13, 16, 19];                 // 溜め周（移動手段を買う）
const MOVE_OF = { 4:'move3', 7:'move4', 10:'move5', 13:'move6', 16:'move7', 19:'move8' };
const target = n => n === 1 ? 23 : TAME.includes(n) ? 76 : 36;

// いまの値を読む
const src0 = fs.readFileSync(SRC, 'utf8');
const readTune = key => {
  const m = src0.match(new RegExp(`\\['${key}',[^\\]]*?,\\s*([0-9.eE+-]+)\\s*,\\s*'n'\\]`));
  return m ? parseFloat(m[1]) : null;
};
const KEYS = ['move2', ...Object.values(MOVE_OF), 'infCoolGrow', 'infRodGrow', 'infCoolBase', 'infRodBase'];
const val = {};
for (const k of KEYS) val[k] = readTune(k);

const run = () => {
  const sets = Object.entries(val).flatMap(([k, v]) => ['--set', `${k}=${v}`]);
  const out = execFileSync('node', [SIM, '--runs=1', '--json', ...sets], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return JSON.parse(out).out[0];
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

for (let round = 1; round <= ROUNDS; round++) {
  const r = run();
  const per = Object.fromEntries(r.perRun.map(x => [x.no, x.casts]));

  // 1. 溜め周：短ければ移動手段を高く、長ければ安く（1周ずつ）
  for (const n of TAME) {
    const a = per[n];
    if (!a) continue;
    const ratio = clamp(target(n) / a, 0.5, 2.0);
    val[MOVE_OF[n]] = Math.round(val[MOVE_OF[n]] * Math.pow(ratio, 0.7));
  }
  // 周1（導入）は長靴で決まる
  if (per[1]) val.move2 = Math.round(val.move2 * Math.pow(clamp(23 / per[1], 0.5, 2.0), 0.7));

  // 2. 普通周：長すぎるなら転生の魅力が足りない＝無限段を安く（伸び率を下げる）
  const norm = r.perRun.filter(x => x.no !== 1 && !TAME.includes(x.no)).map(x => x.casts);
  if (norm.length) {
    const avg = norm.reduce((a, b) => a + b, 0) / norm.length;
    const f = clamp(Math.pow(36 / avg, 0.15), 0.97, 1.03);   // 長い→伸び率を下げる
    val.infCoolGrow = +(clamp(val.infCoolGrow * f, 1.2, 3.0)).toFixed(3);
    val.infRodGrow  = +(clamp(val.infRodGrow  * f, 1.2, 3.0)).toFixed(3);
    var lastAvg = avg;
  }

  const dev = r.perRun.reduce((a, x) => a + Math.abs(x.casts - target(x.no)), 0) / r.perRun.length;
  console.log(`${String(round).padStart(2)}回目  周数${String(r.runs).padStart(3)}  通し${Math.round(r.totalSec / 60)}分  `
    + `溜め[${TAME.map(n => per[n] || '-').join(' ')}]  普通平均${Math.round(lastAvg || 0)}  ずれ平均${dev.toFixed(1)}投`);
}

console.log('\n出た値');
for (const k of KEYS) console.log(`  ${k.padEnd(12)} ${val[k]}`);

if (WRITE) {
  let src = fs.readFileSync(SRC, 'utf8');
  let n = 0;
  for (const [k, v] of Object.entries(val)) {
    const re = new RegExp(`(\\['${k}',[^\\]]*?,\\s*)[0-9.eE+-]+(\\s*,\\s*'n'\\])`);
    if (re.test(src)) { src = src.replace(re, `$1${v}$2`); n++; }
  }
  fs.writeFileSync(SRC, src);
  console.log(`\n${n} 個を src/fishing-inc.html に書いた`);
}
