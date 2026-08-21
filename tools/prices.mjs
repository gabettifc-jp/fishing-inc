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
const ROUNDS = 14;
const MARGIN = parseFloat((process.argv.find(a=>a.startsWith('--margin=')) || '--margin=0.8').split('=')[1]);

/* どの周でどのパークを取るか。
   **仕様書が決めているものと、こちらが置いただけのものを分ける。**

   決（10章11 の表）── 節目の周と、そこで開くもの。
     周3 開く型1／周4 図鑑／周8 開く型4／周11 開く型5／
     **周13 竿の精度3段目／周17 竿の精度7段目**／周20 開く型6
     （**10章11 は竿の精度を段数で書いている。**10章10 の開く型2・3
       「自動の竿の精度（1段目）（2段目）」とは別の道具で、食い違っている）
   決（10章10）── 停滞周は無限段を一段だけ買える値段にする。

   案 ── それ以外の周に何を置くか。**仕様書に無い。**
   周1・7・10・16・19 は移動手段の周なので、パークは置かない。 */
const PLAN_FIXED = {                  // 仕様書が決めている
  3:  ['opn1'],
  4:  ['opn7'],
  8:  ['opn4'],
  11: ['opn5'],
  13: ['rodAcc:2'],
  17: ['rodAcc:4'],
  20: ['opn6'],
};
const PLAN_DRAFT = {                  // **こちらの案。**下の三つの規則で組んだ
  1:  ['pkBait1'],                    // いちばん安い。1周目の転生でもらえる量（2〜3）で買える
  2:  ['carSlot:1'],
  5:  ['pkReel1'],
  6:  ['carKeep:1'],
  7:  ['pkRod1'],
  9:  ['pkBait2'],
  10: ['pkCool2'],
  12: ['pkReel2'],
  14: ['carSlot:3'],
  15: ['pkLineAll'],
  16: ['carKeep:3'],
  18: ['opn8', 'opn9'],               // 図鑑の二つ。図鑑が解放されてから
  19: ['pkLineAuto'],
  21: ['pkBait3', 'pkReel3'],
  22: ['pkCool3', 'opn10'],
  23: ['opn11', 'carSlot:6', 'carKeep:4'],
};
/* **組んだときの規則（2026-08-21）。**

   1. **周1〜23 のどの周にも、必ず一つは置く。**
      仕様書 10章10「報酬ゼロの周を作らない（決）」。
      相場：「**an upgrade in every run**」（itch.io「Wizard Mastery」。incremental-perks C-4）。
      **第34版までは移動手段の周（1・7・10・16・19）を空けていたが、
      その注記は仕様書と食い違っていた**（10章11 の表自身が周4・13 に節目を置いている）。

   2. **周24・25 には置かない。**10章11 の表は**周23で終わる**（クラーケンを釣る周）。
      第34版までの案は周24 に置いていたが、**その周は存在しない。**

   3. **段数型は、最小二乗が解ける数だけ置けばよい。**
      1段目と伸び率の二つを解く問題なので、**同じ軸を二回以上**置けば足りる。
      間の段（rodAcc:1・3 など）は式から出るので、周に置かない。
      置いたのは carSlot 1・3・6／carKeep 1・3・4／rodAcc 2・4（後者は節目なので固定）。

   **無限段（クーラー売値・竿本数）は、どの周にも置かない。**
   10章11「停滞周は無限段を一段だけ買える値段」── **余った経験の受け皿**なので、
   特定の周に紐づけない。 */
const PLAN_PERKS = {};
for (const [k,v] of Object.entries(PLAN_FIXED)) PLAN_PERKS[k] = (PLAN_PERKS[k]||[]).concat(v);
for (const [k,v] of Object.entries(PLAN_DRAFT)) PLAN_PERKS[k] = (PLAN_PERKS[k]||[]).concat(v);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(PAGE);

// いまのつまみの名前を取る
const COSTKEYS = await page.evaluate(() => Object.fromEntries(
  PERKS.filter(p => p.type === 'one').map(p => [p.id, p.costKey])));

/* 段数型（`rodAcc:2` の書き方）の解き方。
   値段は **1段目 × 伸び率^(段−1)** なので、未知数が二つある。
   **対数を取ると一次式になる。**
       log(値段) = log(1段目) + (段−1) × log(伸び率)
   計画の中に同じ軸が二回以上出てくれば、最小二乗で二つとも出る。
   一回しか出てこなければ、**伸び率はいまの値のまま**にして1段目だけ出す。
   一度も出てこなければ触らない。 */
const TIERS = await page.evaluate(() => Object.fromEntries(
  PERKS.filter(p => p.type === 'tier' || p.type === 'inf')
       .map(p => [p.id, {base: p.baseKey, grow: p.growKey,
                         max: p.type === 'tier' ? T[p.maxKey] : Infinity}])));

// 上限を超えた段を指していないか。**黙って飛ばさない**
{
  const bad = [];
  for (const [run, ids] of Object.entries(PLAN_PERKS)) for (const id of ids) {
    if (!id.includes(':')) { if (!COSTKEYS[id]) bad.push(`周${run} 知らないパーク ${id}`); continue; }
    const [base, stepStr] = id.split(':');
    const t = TIERS[base];
    if (!t) { bad.push(`周${run} 知らない段数型 ${base}`); continue; }
    if (+stepStr > t.max) bad.push(`周${run} ${base} の${stepStr}段目は上限${t.max}を超えている`);
  }
  if (bad.length) {
    console.log('\n計画が実装と合っていない。');
    for (const b of bad) console.log('  ✗', b);
    await browser.close();
    process.exit(1);
  }
}

function fitTiers(targets) {         // {id: [[段, 目標値段], ...]} -> {つまみ名: 値}
  const out = {};
  for (const [id, pts] of Object.entries(targets)) {
    const t = TIERS[id];
    if (!pts.length) continue;
    if (pts.length === 1) {
      const [step, price] = pts[0];
      out[t.base] = Math.max(1, Math.round(price / Math.pow(NOW[t.grow], step - 1)));
      continue;
    }
    // 最小二乗（x = 段−1、y = log 値段）
    const n = pts.length;
    let sx=0, sy=0, sxx=0, sxy=0;
    for (const [step, price] of pts) {
      const x = step - 1, y = Math.log(Math.max(1, price));
      sx+=x; sy+=y; sxx+=x*x; sxy+=x*y;
    }
    const d = n*sxx - sx*sx;
    const slope = d === 0 ? Math.log(NOW[t.grow]) : (n*sxy - sx*sy) / d;
    const inter = (sy - slope*sx) / n;
    out[t.grow] = +Math.max(1.01, Math.exp(slope)).toFixed(3);
    out[t.base] = Math.max(1, Math.round(Math.exp(inter)));
  }
  return out;
}
const NOW = await page.evaluate(() => ({...T}));

let costs = {};   // つまみ名 -> 値
for (let round = 1; round <= ROUNDS; round++) {
  const gains = await measure(costs);
  const next = {}, targets = {};
  for (const [runStr, ids] of Object.entries(PLAN_PERKS)) {
    const run = +runStr;
    const g = gains[run] || 1;
    // その周の経験の8割を、その周で取るパークで分け合う
    const each = Math.max(1, Math.floor(g * MARGIN / ids.length));
    for (const id of ids) {
      if (id.includes(':')) {
        const [base, step] = id.split(':');
        (targets[base] = targets[base] || []).push([+step, each]);
      } else next[COSTKEYS[id]] = each;
    }
  }
  Object.assign(next, fitTiers(targets));
  const moved = Object.keys(next).filter(k => costs[k] !== next[k]).length;
  costs = next;
  console.log(`${round}回目：動いた値 ${moved} / ${Object.keys(next).length}`);
  if (!moved) break;
}

console.log('\n周ごとに取るパークと値段');
const gains = await measure(costs);
let cum = 0;
for (let run = 1; run <= 23; run++) {
  cum += gains[run] || 0;
  const ids = PLAN_PERKS[run] || [];
  const line = ids.map(id => {
    if (!id.includes(':')) return `${id}=${costs[COSTKEYS[id]]}`;
    const [b, st] = id.split(':'), t = TIERS[b];
    const price = (costs[t.base] ?? NOW[t.base]) * Math.pow(costs[t.grow] ?? NOW[t.grow], +st - 1);
    return `${id}=${Math.round(price)}`;
  }).join(' ');
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

/* 計画どおりに25周まわして、周ごとの経験を返す。

   **本体の関数と状態を、そのまま使う**（`check.md`「本物と同じ呼ばれ方」）。
   2026-08-21、ここが古いままで落ちた ──
   パークを `T[p.costKey]` で買っていた（段数型に costKey は無い）、
   無限段を `infPrice` で上限なく買っていた（上限がついた）、
   `presGain` が累計型になったのに `S.lifeEarn` を積んでいなかった。 */
async function measure(costs) {
  return page.evaluate(({ costs, plan }) => {
    for (const [k, v] of Object.entries(costs)) if (k in T) T[k] = v;
    const out = {};
    const CASTS = {1:23,2:23,3:38,4:76,5:23,6:38,7:76,8:23,9:38,10:76,
                   11:23,12:38,13:76,14:23,15:38,16:76,17:23,18:38,19:76,
                   20:23,21:53,22:53,23:53,24:91,25:15};
    const PLACE = n => n<=1?0 : n<=4?1 : n<=7?2 : n<=10?3 : n<=13?4 : n<=16?5 : n<=19?6 : 7;
    let s0 = 12345;
    Math.random = () => { s0 ^= s0<<13; s0>>>=0; s0 ^= s0>>17; s0 ^= s0<<5; s0>>>=0; return s0/4294967296; };
    S = newState(); scr='A'; T.sndOn=0; T.bgmOn=0; T.autoSave=0;
    rods.length = 0;
    for (let run = 1; run <= 23; run++) {
      S.run = run; S.place = PLACE(run);
      for (let q=0;q<=S.place;q++) S.unlockedPlace[q] = true;
      S.money = 0; S.tools = {bait:0,line:0,reel:0,cool:0,rod:0};
      S.rec = newRunRecord(run);
      let earn = 0;
      for (let c = 0; c < CASTS[run]; c++) {
        const g = Math.random() < 0.4 ? 0 : Math.random() < 0.5 ? 1 : Math.random() < 0.67 ? 2 : 3;
        const auto = autoRodCount();
        const per = 6.1;
        const mine = unitPrice(S.place, g) * sellMult() * (Math.random()<0.5 ? perfectMult() : 1);
        const autoFish = auto * (autoAcc() * per / 6.1);
        const got = mine + autoFish * unitPrice(S.place, 1) * sellMult();
        if (!isFinite(got)) break;                     // 発散したらそこで止める
        earn += got; S.money += got;
        S.rec.byGrade[g]++;                            // 解禁条件が読む（本体と同じ状態）
        for (let g2=0; g2<40; g2++) {
          const list = [['bait',toolPrice('bait')],['line',toolPrice('line')],
                        ['reel',toolPrice('reel')],['cool',toolPrice('cool')],['rod',toolPrice('rod')]]
                        .filter(x=>isFinite(x[1]) && S.money>=x[1]).sort((a,b)=>a[1]-b[1]);
          if (!list.length) break;
          S.money -= list[0][1]; S.tools[list[0][0]]++;
        }
        for (let k=0;k<9;k++) if (Math.random()<0.3) S.dex[S.place][k] = true;
      }
      const got = presGain(earn);
      out[run] = got;
      S.pres += got;
      // その周のパークを取る。**本体の perkCost / buyPerk を使う**
      for (const id of (plan[run] || [])) {
        const base = id.includes(':') ? id.split(':')[0] : id;
        const pk = PERKS.find(x => x.id === base);
        if (!pk) continue;
        const upto = id.includes(':') ? +id.split(':')[1] : 1;
        for (let k = 0; k < 30 && perkStep(pk) < upto; k++) {
          const before = S.pres;
          buyPerk(pk);
          if (S.pres === before) break;                // 買えなかった
        }
      }
      // 余った経験は無限段へ（**上限がついたので perkDone を見る**）
      for (let g2=0; g2<300; g2++) {
        const av = PERKS.filter(pk => (pk.type==='inf') && !perkDone(pk) && S.pres >= perkCost(pk));
        if (!av.length) break;
        av.sort((x,y)=>perkCost(x)-perkCost(y));
        const before = S.pres;
        buyPerk(av[0]);
        if (S.pres === before) break;
      }
      // 累計型なので、周の終わりに積む
      S.lifeEarn = (S.lifeEarn||0) + Math.max(0, earn);
      S.history.push({ byGrade: S.rec.byGrade.slice(), bestCombo: 0 });
    }
    return out;
  }, { costs, plan: PLAN_PERKS });
}
