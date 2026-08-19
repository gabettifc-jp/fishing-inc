/* ============================================================================
   第二段の測定器。ゲーム本体（src/fishing-inc.html）を実際に読み込み、
   本体の派生値の関数（toolPrice / windows / missRatio / waitRange / presGain /
   sellMult / autoAcc / comboMult / perfectMult / unitPrice / timeline …）を
   そのまま呼んで早送りで通しプレイする。数値の正本は本体の TUNE 一つだけ。

   使い方
     node tools/sim.mjs                      … 標準の腕で3回通す
     node tools/sim.mjs --skill=0.9 --runs=3 … 腕を変える
     node tools/sim.mjs --set beat=0.18      … つまみを上書きして測る
     node tools/sim.mjs --json               … 結果をJSONで出す
   ========================================================================== */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = 'file://' + path.resolve(HERE, '..', 'src', 'fishing-inc.html');

const args = process.argv.slice(2);
const opt = (k, d) => {
  const a = args.find(x => x.startsWith('--' + k + '='));
  return a ? a.split('=').slice(1).join('=') : d;
};
const SKILL = parseFloat(opt('skill', '0.70'));
const RUNS  = parseInt(opt('runs', '3'), 10);
const SEED  = parseInt(opt('seed', '1'), 10);
const JSONOUT = args.includes('--json');
const SETS = [];
for (let i = 0; i < args.length; i++)
  if (args[i] === '--set' && args[i + 1]) SETS.push(args[++i]);

/* ---- ブラウザの中で走る本体。ページの関数をそのまま使う ------------------ */
async function runOnce(page, skill, seed, sets, trace) {
  return page.evaluate(({ skill, seed, sets, trace }) => {

    /* --- 決めごと（測定器の仮定。仕様書には無い） ----------------------- */
    const ASSUME = {
      // 腕＝基準の判定幅（±60ミリ秒）のときに当たりを出す確率。
      // ずれは正規分布とし、σ をこの条件から逆算して固定する。
      // 判定幅が広がれば当たりが増え、深場で狭まれば減る。
      anchorWindowMs: 60,
      // 転生する時機（仕様書に無いので測定器が置く仮定）。
      // 今回の転生で持っている転生通貨がこの割合ぶん増えるなら転生する。
      presThreshold: 1e9,   // 1e9 = この規則を切る（次の一歩の遠さだけで決める）
      // 上に届かなくても、次の一歩にこの秒数以上かかるなら転生する（詰み避け）
      stallSec: 900,
      // 一周の下限（これより短くは終わらせない）
      minRunSec: 30,
      // 道具を買う基準：その一段で増える秒あたり稼ぎで、値段の元が取れるまでの秒数
      paybackSec: 60,
      // 深海を目指す度合い（全釣り場が開いた後、深海の稼ぎが最良の何割あれば行くか）
      deepPref: 0.5,
      // 打ち切り（無限ループ避け）
      maxRuns: 200, maxTotalSec: 3600 * 12,
    };

    /* --- 乱数（種つき。同じ種なら同じ結果） ------------------------------ */
    let s0 = seed >>> 0 || 1;
    const rnd = () => { s0 ^= s0 << 13; s0 >>>= 0; s0 ^= s0 >> 17; s0 ^= s0 << 5; s0 >>>= 0; return s0 / 4294967296; };
    Math.random = rnd;

    /* --- つまみの上書き -------------------------------------------------- */
    for (const kv of sets) { const [k, v] = kv.split('='); if (k in T) T[k] = parseFloat(v); }

    /* --- 正規分布 -------------------------------------------------------- */
    const erf = x => { // Abramowitz & Stegun 7.1.26
      const sgn = x < 0 ? -1 : 1; x = Math.abs(x);
      const t = 1 / (1 + 0.3275911 * x);
      const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
      return sgn * y;
    };
    const probit = p => { // 逆正規（Acklam の近似）
      const a=[-3.969683028665376e+01,2.209460984245205e+02,-2.759285104469687e+02,1.383577518672690e+02,-3.066479806614716e+01,2.506628277459239e+00];
      const b=[-5.447609879822406e+01,1.615858368580409e+02,-1.556989798598866e+02,6.680131188771972e+01,-1.328068155288572e+01];
      const c=[-7.784894002430293e-03,-3.223964580411365e-01,-2.400758277161838e+00,-2.549732539343734e+00,4.374664141464968e+00,2.938163982698783e+00];
      const d=[7.784695709041462e-03,3.224671290700398e-01,2.445134137142996e+00,3.754408661907416e+00];
      const pl=0.02425;
      if (p<pl){const q=Math.sqrt(-2*Math.log(p));return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
      if (p>1-pl){const q=Math.sqrt(-2*Math.log(1-p));return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
      const q=p-0.5, r=q*q;
      return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
    };
    const SIGMA = ASSUME.anchorWindowMs / probit((1 + skill) / 2);   // ミリ秒
    const pWithin = w => erf(w / (SIGMA * Math.SQRT2));

    /* --- 状態を初期化 ---------------------------------------------------- */
    S = newState(); scr = 'A'; combo = 0; bestComboRun = 0; creel = 0;
    rods.length = 0; fx.length = 0; blockUntil = 0;
    T.sndOn = 0; T.bgmOn = 0; T.autoSave = 0;

    const avgSymSec = () => T.beat * ((T.dotBeats + T.dashBeats) / 2 + T.gapBeats);
    const avgWait = () => { const {lo,hi} = waitRange(); return lo + (hi - lo) / (T.waitSkew + 1); };
    const rateOf = g => [T.rate0, T.rate1, T.rate2, T.rate3][g];

    // その釣り場の秒あたり期待収入（釣り場を選ぶための見積り。連続倍率は入れない）
    function estIncome(p) {
      const keep = S.place; S.place = p;
      const w = windows(), mr = missRatio();
      const ph = pWithin(w.hit), pg = pWithin(w.graze) - ph, pm = 1 - pWithin(w.graze);
      let money = 0, time = 0, tot = 0;
      for (let g = 0; g < 4; g++) {
        const n = SYM_COUNT[p][g], r = rateOf(g); tot += r;
        // 二項分布で 完璧／逃す を出す
        let pPerfect = 0, pMiss = 0;
        const C = (n, k) => { let c = 1; for (let i = 0; i < k; i++) c = c * (n - i) / (i + 1); return c; };
        for (let h = 0; h <= n; h++) for (let m = 0; m + h <= n; m++) {
          const q = C(n, h) * C(n - h, m) * Math.pow(ph, h) * Math.pow(pm, m) * Math.pow(pg, n - h - m);
          if (m / n > mr) pMiss += q; else if (h / n >= T.perfectRatio) pPerfect += q;
        }
        const pSoso = 1 - pPerfect - pMiss;
        const unit = unitPrice(p, g) * sellMult();
        money += r * (pPerfect * unit * perfectMult() + pSoso * unit);
        time  += r * (avgWait() + T.leadIn + n * avgSymSec());
      }
      S.place = keep;
      return tot > 0 ? money / tot / (time / tot) : 0;
    }

    function bestPlace() {
      let bi = -1, bv = -1;
      for (let p = 0; p < 8; p++) if (S.unlockedPlace[p]) { const v = estIncome(p); if (v > bv) { bv = v; bi = p; } }
      const allOpen = S.unlockedPlace.every(Boolean);
      if (allOpen && has('opn7')) {                 // 終盤はクラーケンを目指して深海へ
        const deep = estIncome(7);
        if (deep >= bv * ASSUME.deepPref) return 7;
      }
      return bi;
    }

    /* --- 一投を解く ------------------------------------------------------ */
    function resolveCast(isAuto) {
      const grade = pickBossOrGrade(isAuto);
      const chart = chartFor(S.place, grade);
      const n = chart.length;
      const tl = timeline(chart);
      const dur = (grade === 4 ? T.omenWaitLo + rnd() * (T.omenWaitHi - T.omenWaitLo) : rollWait())
                + T.leadIn + tl.total;
      let result;
      if (isAuto) {
        result = rnd() < autoAcc() ? 'soso' : 'miss';
      } else {
        const w = windows(), ph = pWithin(w.hit), pg = pWithin(w.graze) - ph;
        let hit = 0, mis = 0;
        for (let i = 0; i < n; i++) { const u = rnd(); if (u < ph) hit++; else if (u >= ph + pg) mis++; }
        if (mis / n > missRatio()) result = 'miss';
        else if (hit / n >= T.perfectRatio) result = 'perfect';
        else result = 'soso';
      }
      if (result === 'miss' && has('pkLine3') && rnd() < T.pkLine3v) result = 'soso';
      return { grade, n, dur, result };
    }
    function pickBossOrGrade(isAuto) {
      const canBoss = bossReady(S.place) && (!isAuto || has('opn6'));
      if (canBoss) {
        omenCasts++;
        if (omenCasts >= T.omenMinCasts && rnd() < omenRate()) { omenCasts = 0; return 4; }
      }
      return pickGrade();
    }

    /* --- 買い物 ---------------------------------------------------------- */
    function cheapest() {
      const l = shopList(); if (!l.length) return null;
      return l.reduce((a, b) => a.price < b.price ? a : b);
    }
    // その道具を一段買うと、秒あたり稼ぎがいくら増えるか
    function marginal(id) {
      const before = estIncome(S.place);
      S.tools[id]++;
      let after = estIncome(S.place);
      if (id === 'rod') after = before * (1 + autoShare());   // 竿は自動の竿が一本増える
      S.tools[id]--;
      return after - before;
    }
    // 自動の竿一本ぶんが、自分の竿に対して何割の稼ぎになるか（そこそこだけ出す）
    function autoShare(){
      const w = windows();
      return autoAcc();          // 完璧の倍率が乗らないぶん、そこそこの確率がそのまま割合になる
    }
    // いま買えるもので前に進めるか。進めないなら転生したほうが早い
    function stalled(){
      const inc = incomeNow();
      for (const it of shopList()){
        if (it.kind==='move') { if ((it.price - S.money)/Math.max(1e-9,inc) <= ASSUME.stallSec) return false; continue; }
        const d = marginal(it.id);
        if (d > 0 && (it.price)/d <= ASSUME.paybackSec
            && (it.price - S.money)/Math.max(1e-9,inc) <= ASSUME.stallSec) return false;
      }
      return true;
    }
    function incomeNow(){ return estIncome(S.place) * (1 + autoRodCount()*autoShare()); }
    function doBuys() {
      let bought = false;
      for (let guard = 0; guard < 300; guard++) {
        const list = shopList();
        const mv = list.find(i => i.kind === 'move');
        if (mv && S.money >= mv.price) { buy(mv); bought = true; continue; }  // 周の目標が最優先
        // 元が取れる道具だけ買う。安いものから見る
        const tools = list.filter(i => i.kind === 'tool' && S.money >= i.price)
                          .sort((a,b)=>a.price-b.price);
        let pick = null;
        for (const it of tools) {
          const d = marginal(it.id);
          if (d > 0 && it.price / d <= ASSUME.paybackSec) { pick = it; break; }
        }
        if (!pick) break;
        buy(pick); bought = true;
      }
      return bought;
    }

    /* --- パークを取る（転生のとき。安いものから順に） -------------------- */
    function buyPerks() {
      for (let guard = 0; guard < 200; guard++) {
        const avail = PERKS.filter(p => !has(p.id) && S.pres >= T[p.costKey]);
        if (!avail.length) break;
        avail.sort((a, b) => T[a.costKey] - T[b.costKey]);
        buyPerk(avail[0]);
      }
    }

    /* --- 通しプレイ ------------------------------------------------------ */
    const runs = []; let runs0trace = null;
    let totalSec = 0, cleared = false, clearRun = 0, clearSec = 0;
    let omenCastsLocal = 0;

    for (let runNo = 1; runNo <= ASSUME.maxRuns && !cleared; runNo++) {
      S.run = runNo; S.rec = newRunRecord(runNo);
      combo = 0; bestComboRun = 0; creel = 0; omenCasts = 0;
      S.place = bestPlace();
      let t = 0, earn = 0;
      const byGrade = [0,0,0,0,0]; let perfect = 0, soso = 0, missed = 0, casts = 0, myCasts = 0;
      const autoAcc2 = [];                                    // 自動の竿の進み
      let lastIncome = 1;
      let winT0 = 0, winEarn0 = 0, prevRate = 0, flat = 0;
      const tr = [];

      for (let step = 0; step < 200000; step++) {
        // 自分の竿
        const c = resolveCast(false);
        casts++; myCasts++; t += c.dur;
        if (c.grade === 4) t += T.fxHuge;                     // 超大物は手が止まる
        if (c.result === 'miss') { combo = 0; missed++; }
        else {
          let money = unitPrice(S.place, c.grade) * sellMult();
          if (c.result === 'perfect') { combo++; if (combo > bestComboRun) bestComboRun = combo;
            money *= perfectMult() * comboMult(); perfect++; }
          else soso++;
          money = Math.floor(money);
          S.money += money; earn += money; byGrade[c.grade]++;
          if (!S.dex[S.place][c.grade]) S.dex[S.place][c.grade] = true;
          if (S.place === 7 && c.grade === 4) { cleared = true; clearRun = runNo; }
        }
        // 自動の竿
        const nAuto = autoRodCount();
        while (autoAcc2.length < nAuto) autoAcc2.push(0);
        while (autoAcc2.length > nAuto) autoAcc2.pop();
        for (let i = 0; i < nAuto; i++) {
          autoAcc2[i] += c.dur;
          for (let g2 = 0; g2 < 50; g2++) {
            const a = resolveCast(true);
            if (autoAcc2[i] < a.dur) break;
            autoAcc2[i] -= a.dur; casts++;
            if (a.result === 'miss') missed++;
            else { const m = Math.floor(unitPrice(S.place, a.grade) * sellMult());
              S.money += m; earn += m; soso++; byGrade[a.grade]++;
              if (!S.dex[S.place][a.grade]) S.dex[S.place][a.grade] = true;
              if (S.place === 7 && a.grade === 4) { cleared = true; clearRun = runNo; } }
          }
        }
        if (cleared) break;

        const inc = earn / Math.max(1, t); lastIncome = inc;
        if (doBuys()) { S.place = bestPlace();
          if (trace && runNo<=1) tr.push({t:+t.toFixed(0), money:Math.round(S.money), inc:+(earn/Math.max(1,t)).toFixed(1),
            place:S.place+1, tools:{...S.tools}, open:S.unlockedPlace.filter(Boolean).length}); }

        // 伸びが鈍ったら転生する。乱数に振られないよう、見込みで決める
        const worth = ASSUME.presThreshold < 1e8
          && presGain(earn) >= Math.max(1, S.pres * ASSUME.presThreshold);
        if (t > ASSUME.minRunSec && (worth || stalled())) {
          if (trace && runNo<=1) tr.push({t:+t.toFixed(0), money:Math.round(S.money),
            inc:+incomeNow().toFixed(2), why:'転生', shop:shopList().map(i=>i.kind+':'+i.name+':'+Math.round(i.price)).join(',')});
          break; }
        if (t > 7200) break;
      }

      const presGot = presGain(earn);
      runs.push({ no: runNo, sec: t, casts, myCasts, earn, presGot, byGrade: byGrade.slice(),
                  perfect, soso, missed, bestCombo: bestComboRun,
                  place: S.place, tools: {...S.tools}, places: S.unlockedPlace.filter(Boolean).length,
                  perks: Object.keys(S.perks).length });
      if (runNo===1) runs0trace = tr;
      totalSec += t;
      if (cleared) { clearSec = totalSec; break; }
      // 転生
      S.pres += presGot;
      const keep = { bait:0, line:0, reel:0, cool:0, rod:0 };
      const slots = carrySlots();
      const order = TOOLS.slice().sort((a,b)=> S.tools[b.id]*T[b.carry] - S.tools[a.id]*T[a.carry]);
      for (const t2 of order.slice(0, slots)) keep[t2.id] = Math.floor(S.tools[t2.id] * T[t2.carry]);
      S.tools = keep;
      S.money = has('car4') ? Math.floor(earn * T.car4v) : 0;
      buyPerks();
      if (totalSec > ASSUME.maxTotalSec) break;
    }

    const last = runs[runs.length-1] || {};
    return {
      skill, seed, sigma:+SIGMA.toFixed(1),
      runs: runs.length, totalSec, cleared, clearRun, clearSec,
      firstRunSec: runs[0] ? runs[0].sec : 0,
      lastRunSec: last.sec || 0,
      avgCasts: runs.length ? runs.reduce((a,r)=>a+r.myCasts,0)/runs.length : 0,
      avgAllCasts: runs.length ? runs.reduce((a,r)=>a+r.casts,0)/runs.length : 0,
      openRun8: (()=>{ for (const r of runs) if (r.places===8) return r.no; return null; })(),
      trace: trace ? runs0trace : undefined,
      perRun: runs.map(r=>({no:r.no, sec:+r.sec.toFixed(1), casts:r.myCasts, all:r.casts, earn:r.earn,
        pres:r.presGot, p:r.perfect, s:r.soso, m:r.missed, cb:r.bestCombo,
        place:r.place+1, places:r.places, perks:r.perks, tools:r.tools})),
    };
  }, { skill, seed, sets, trace });
}

/* ---- 走らせる ------------------------------------------------------------ */
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(PAGE);
await page.waitForTimeout(300);

const out = [];
for (let i = 0; i < RUNS; i++) out.push(await runOnce(page, SKILL, SEED + i * 7919, SETS, args.includes('--trace') && i===0));
await browser.close();

if (errs.length) console.error('ページのエラー:', errs.slice(0, 5));

const avg = k => out.reduce((a, r) => a + (r[k] || 0), 0) / out.length;
const med = k => { const v = out.map(r => r[k] || 0).sort((a,b)=>a-b); return v[v.length>>1]; };
const fs2 = s => { s = Math.round(s); const h=(s/3600)|0, m=((s%3600)/60)|0, x=s%60;
  return (h?h+'時間':'')+(h||m?m+'分':'')+x+'秒'; };

if (JSONOUT) { console.log(JSON.stringify({ skill: SKILL, sets: SETS, out }, null, 1)); }
else if (args.includes('--trace')) {
  const tr = out[0].trace||[];
  console.log('1周目の追跡（買い物のたび）');
  const step = Math.max(1, Math.ceil(tr.length/25));
  for (let i=0;i<tr.length;i+=step){ const r=tr[i]; if(!r.tools) continue;
    console.log('  '+String(r.t).padStart(5)+'秒  所持'+String(r.money).padStart(12)
      +'  稼ぎ/秒'+String(r.inc).padStart(10)+'  釣り場'+r.place+' 開'+r.open
      +'  餌'+r.tools.bait+' 糸'+r.tools.line+' リ'+r.tools.reel+' ク'+r.tools.cool+' 竿'+r.tools.rod); }
  console.log('  買い物回数 '+tr.length+' / 1周目 '+out[0].firstRunSec.toFixed(0)+'秒');
}
else {
  console.log('腕 ' + (SKILL*100).toFixed(0) + '%（σ=' + out[0].sigma + 'ミリ秒） / '
    + RUNS + '回通した / 上書き: ' + (SETS.length ? SETS.join(' ') : 'なし'));
  console.log('─'.repeat(78));
  const row = (n, v, target) => console.log(('  '+n).padEnd(30, ' ') + String(v).padEnd(26,' ') + (target||''));
  row('通しの周数', out.map(r=>r.runs).join(' / '), '目標 25周前後');
  row('通しの時間', out.map(r=>fs2(r.totalSec)).join(' / '), '目標 3〜4時間');
  row('1周目の長さ', out.map(r=>fs2(r.firstRunSec)).join(' / '), '目標 3分');
  row('最後の周の長さ', out.map(r=>fs2(r.lastRunSec)).join(' / '), '目標 15分');
  row('一周の投数・自分の竿(平均)', out.map(r=>Math.round(r.avgCasts)).join(' / '), '目標 40〜50回');
  row('  同・自動もあわせた総数', out.map(r=>Math.round(r.avgAllCasts)).join(' / '), '');
  row('8つ目が開く周', out.map(r=>r.openRun8===null?'—':r.openRun8).join(' / '), '目標 12〜15周目');
  row('クラーケンの周', out.map(r=>r.cleared?r.clearRun:'—').join(' / '), '目標 23〜25周目');
  console.log('─'.repeat(78));
  const r0 = out[0];
  console.log('  1回目の周ごと（最初の6周と最後の3周）');
  const show = [...r0.perRun.slice(0,6), ...(r0.perRun.length>9?[{no:'…'}]:[]), ...r0.perRun.slice(-3)];
  for (const r of show) {
    if (r.no==='…'){ console.log('    …'); continue; }
    console.log('    ' + String(r.no).padStart(3) + '周 ' + fs2(r.sec).padEnd(9)
      + (r.casts+'投').padEnd(7) + ('稼ぎ'+r.earn.toExponential(2)).padEnd(15)
      + ('転生+'+r.pres).padEnd(11) + ('完'+r.p+'/そ'+r.s+'/逃'+r.m).padEnd(18)
      + ('釣り場'+r.place+' 開'+r.places).padEnd(13) + 'パーク'+r.perks);
  }
}
