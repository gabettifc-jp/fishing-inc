/* 移動手段の値段とパークの値段を倍率で振って、六つの目標に近い組を探す */
import { execFileSync } from 'node:child_process';
const MOVE = ['move2','move3','move4','move5','move6','move7','move8'];
const MOVE0 = [3000,50000,1e6,3e7,1e9,5e10,3e12];
/* **この表は古い。**2026-08-21 にパークを 10章10 に合わせて組み直したので、
   ここに並んでいる id の多く（pkRod2 / pkLine1〜3 / pkCool1 / car1〜4）は
   もう存在しない。**段数型と無限段も入っていない。**
   使う前に、本体の PERKS から作り直すこと。 */
const PERK = null;
if (!PERK) {
  console.log('この道具は使えない。パークの一覧が 2026-08-21 に変わった。');
  console.log('本体の PERKS から作り直すまで、探索の結果は当てにならない。');
  process.exit(1);
}

function sets(mv, pk){
  const a=[];
  MOVE.forEach((k,i)=>{ a.push('--set', k+'='+Math.round(MOVE0[i]*mv)); });
  for (const [k,v] of Object.entries(PERK)) a.push('--set', k+'='+Math.max(1,Math.round(v*pk)));
  return a;
}
function measure(mv, pk, runs=2){
  const out = execFileSync('node', ['tools/sim.mjs','--runs='+runs,'--json', ...sets(mv,pk)],
    {encoding:'utf8', maxBuffer:1<<28});
  const j = JSON.parse(out);
  const m = k => j.out.reduce((a,r)=>a+(typeof r[k]==='number'?r[k]:0),0)/j.out.length;
  const cleared = j.out.filter(r=>r.cleared);
  return { runs:m('runs'), totalSec:m('totalSec'), first:m('firstRunSec'), last:m('lastRunSec'),
    casts:m('avgCasts'),
    open8: j.out.map(r=>r.openRun8).filter(x=>x).reduce((a,b)=>a+b,0)/Math.max(1,j.out.filter(r=>r.openRun8).length),
    clearRun: cleared.length? cleared.reduce((a,r)=>a+r.clearRun,0)/cleared.length : null,
    clearedAll: cleared.length===j.out.length };
}
// 目標からの離れ具合（対数で見る）
function score(r){
  if (!r.clearedAll) return 1e9;
  const d=(v,t)=>Math.pow(Math.log(Math.max(1e-9,v)/t),2);
  return d(r.runs,25) + d(r.totalSec,3.5*3600) + d(r.first,180) + d(r.last,900)
       + d(r.casts,45)*0.5 + d(r.open8,13.5) + d(r.clearRun,24);
}
const grid=[];
for (const mv of [1,3,10,30,100]) for (const pk of [1,3,10,30,100]) grid.push([mv,pk]);
let best=null;
for (const [mv,pk] of grid){
  let r; try{ r=measure(mv,pk); }catch(e){ console.log(`移動×${mv} パーク×${pk}  失敗`); continue; }
  const s=score(r);
  console.log(`移動×${String(mv).padStart(4)} パーク×${String(pk).padStart(4)}  周${r.runs.toFixed(0).padStart(4)}`
    +`  通し${(r.totalSec/3600).toFixed(2)}h  1周目${(r.first/60).toFixed(1)}分  最後${(r.last/60).toFixed(1)}分`
    +`  投${r.casts.toFixed(0).padStart(3)}  8つ目${isNaN(r.open8)?'—':r.open8.toFixed(0)}`
    +`  クラーケン${r.clearRun===null?'—':r.clearRun.toFixed(0)}  点${s===1e9?'—':s.toFixed(2)}`);
  if (s<(best?best.s:1e9)) best={mv,pk,r,s};
}
console.log('\n最良: 移動×'+best.mv+' パーク×'+best.pk+' 点'+best.s.toFixed(2));
