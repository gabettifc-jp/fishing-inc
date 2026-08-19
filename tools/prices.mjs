/* ============================================================================
   パークの値段を、周ごとの経験から逆算する。

   やり方は移動手段と同じ。10章11の投数でその周を打ち切って測り、
   **その周でもらえる経験の8割**を、その周で取るパークの値段にする。

   パークが変われば稼ぎが変わり、稼ぎが変われば経験が変わるので、
   動かなくなるまで数回まわす（移動手段と違って一度では収まらない）。

     node tools/prices.mjs           … 5回まわして結果を出す
     node tools/prices.mjs --write   … 収まった値を src/fishing-inc.html に書く
   ========================================================================== */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC  = path.resolve(HERE, '..', 'src', 'fishing-inc.html');
const PAGE = 'file://' + SRC;
const WRITE = process.argv.includes('--write');
const ROUNDS = 6;
const MARGIN = parseFloat((process.argv.find(a=>a.startsWith('--margin=')) || '--margin=0.8').split('=')[1]);

/* どの周でどのパークを取るか（10章11の節目に合わせる）。
   周1・4・7・10・13・16・19 は移動手段の周なので、パークは置かない */
const PLAN_PERKS = {
  2:  ['pkBait1'],
  3:  ['opn1'],                       // 節目1 自動の竿が解放される
  4:  ['opn7'],                       // 図鑑が解放される（10章11）
  5:  ['pkReel1'],
  6:  ['pkCool1', 'car1'],
  8:  ['opn4'],                       // 節目2 売るのが自動になる
  9:  ['pkRod1', 'pkLine1'],
  11: ['opn5'],                       // 節目3 道具を自動で買う
  12: ['pkBait2', 'pkReel2'],
  13: ['opn2'],                       // 節目4 自動の竿の精度（1段目）
  14: ['pkCool2', 'car2'],
  15: ['pkLine2', 'pkRod2'],
  17: ['opn3'],                       // 節目5 自動の竿の精度（2段目）
  18: ['opn8', 'opn9'],               // 図鑑の売値／未発見が掛かりやすい
  20: ['opn6'],                       // 節目6 自動でも超大物を捌ける
  21: ['pkBait3', 'pkReel3'],
  22: ['pkCool3', 'pkLine3'],
  23: ['pkRod3', 'opn10'],            // 主が出やすくなる
  24: ['car3', 'car4'],
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(PAGE);

// いまのつまみの名前を取る
const COSTKEYS = await page.evaluate(() => Object.fromEntries(PERKS.map(p => [p.id, p.costKey])));

let costs = {};   // costKey -> 値段
for (let round = 1; round <= ROUNDS; round++) {
  const gains = await measure(costs);
  const next = {};
  for (const [runStr, ids] of Object.entries(PLAN_PERKS)) {
    const run = +runStr;
    const g = gains[run] || 1;
    // その周の経験の8割を、その周で取るパークで分け合う
    const each = Math.max(1, Math.floor(g * MARGIN / ids.length));
    for (const id of ids) next[COSTKEYS[id]] = each;
  }
  const moved = Object.keys(next).filter(k => costs[k] !== next[k]).length;
  costs = next;
  console.log(`${round}回目：動いた値段 ${moved} / ${Object.keys(next).length}`);
  if (!moved) break;
}

console.log('\n周ごとに取るパークと値段');
const gains = await measure(costs);
let cum = 0;
for (let run = 1; run <= 25; run++) {
  cum += gains[run] || 0;
  const ids = PLAN_PERKS[run] || [];
  const line = ids.map(id => `${id}=${costs[COSTKEYS[id]]}`).join(' ');
  console.log(`  周${String(run).padStart(2)}  経験+${String(gains[run] || 0).padStart(6)}  累計${String(cum).padStart(7)}  ${line}`);
}

if (WRITE) {
  let src = fs.readFileSync(SRC, 'utf8');
  let n = 0;
  for (const [key, val] of Object.entries(costs)) {
    const re = new RegExp(`(\\['${key}',[^\\]]*?,\\s*)[0-9.]+(\\s*,\\s*'n'\\])`);
    if (re.test(src)) { src = src.replace(re, `$1${val}$2`); n++; }
  }
  fs.writeFileSync(SRC, src);
  console.log(`\n${n} 個の値段を src/fishing-inc.html に書いた`);
}
await browser.close();

/* 計画どおりに25周まわして、周ごとの経験を返す */
async function measure(costs) {
  return page.evaluate(({ costs, plan }) => {
    for (const [k, v] of Object.entries(costs)) if (k in T) T[k] = v;
    const out = {};
    // sim.mjs と同じ計画。ここでは経験だけが要るので簡略に回す
    const CASTS = {1:23,2:23,3:38,4:76,5:23,6:38,7:76,8:23,9:38,10:76,
                   11:23,12:38,13:76,14:23,15:38,16:76,17:23,18:38,19:76,
                   20:23,21:53,22:53,23:53,24:91,25:15};
    const PLACE = n => n<=1?0 : n<=4?1 : n<=7?2 : n<=10?3 : n<=13?4 : n<=16?5 : n<=19?6 : 7;
    let s0 = 12345;
    Math.random = () => { s0 ^= s0<<13; s0>>>=0; s0 ^= s0>>17; s0 ^= s0<<5; s0>>>=0; return s0/4294967296; };
    S = newState(); scr='A'; T.sndOn=0; T.bgmOn=0; T.autoSave=0;
    rods.length = 0;
    for (let run = 1; run <= 25; run++) {
      S.run = run; S.place = PLACE(run);
      for (let q=0;q<=S.place;q++) S.unlockedPlace[q] = true;
      S.money = 0; S.tools = {bait:0,line:0,reel:0,cool:0,rod:0};
      let earn = 0;
      for (let c = 0; c < CASTS[run]; c++) {
        const g = Math.random() < 0.4 ? 0 : Math.random() < 0.5 ? 1 : Math.random() < 0.67 ? 2 : 3;
        const auto = autoRodCount();
        // 自分の竿1回ぶんの時間に、自動の竿が何匹釣るか
        const per = 6.1;
        const mine = unitPrice(S.place, g) * sellMult() * (Math.random()<0.5 ? perfectMult() : 1);
        const autoFish = auto * (autoAcc() * per / 6.1);
        earn += mine + autoFish * unitPrice(S.place, 1) * sellMult();
        // 稼いだ金で道具を買う（安いものから）
        S.money += mine + autoFish * unitPrice(S.place, 1) * sellMult();
        for (let g2=0; g2<40; g2++) {
          const list = [['bait',toolPrice('bait')],['line',toolPrice('line')],
                        ['reel',toolPrice('reel')],['cool',toolPrice('cool')],['rod',toolPrice('rod')]]
                        .filter(x=>S.money>=x[1]).sort((a,b)=>a[1]-b[1]);
          if (!list.length) break;
          S.money -= list[0][1]; S.tools[list[0][0]]++;
        }
        for (let k=0;k<9;k++) if (Math.random()<0.3) S.dex[S.place][k] = true;
      }
      const got = presGain(earn);
      out[run] = got;
      S.pres += got;
      // その周のパークを取る
      const ids = (plan[run] || []);
      for (const id of ids) { const p = PERKS.find(x=>x.id===id); if (p && S.pres >= T[p.costKey]) { S.pres -= T[p.costKey]; S.perks[id] = true; } }
      // 余った経験は無限段へ
      for (let g2=0; g2<200; g2++) {
        const c1 = infPrice('cool'), c2 = infPrice('rod');
        const m = Math.min(c1, c2);
        if (S.pres < m) break;
        S.pres -= Math.round(m);
        if (c1 <= c2) S.inf.cool++; else S.inf.rod++;
      }
    }
    return out;
  }, { costs, plan: PLAN_PERKS });
}
