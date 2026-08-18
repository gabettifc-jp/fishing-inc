/* 移動手段の値段とパークの値段を倍率で振って、六つの目標に近い組を探す */
import { execFileSync } from 'node:child_process';
const MOVE = ['move2','move3','move4','move5','move6','move7','move8'];
const MOVE0 = [3000,50000,1e6,3e7,1e9,5e10,3e12];
const PERK = { pkRod1c:8,pkRod2c:40,pkRod3c:200,pkBait1c:5,pkBait2c:25,pkBait3c:125,
  pkLine1c:5,pkLine2c:25,pkLine3c:125,pkReel1c:10,pkReel2c:50,pkReel3c:250,
  pkCool1c:5,pkCool2c:25,pkCool3c:125,opn1c:15,opn2c:40,opn3c:150,opn4c:20,opn5c:60,
  opn6c:400,opn7c:10,opn8c:50,opn9c:80,opn10c:100,car1c:30,car2c:90,car3c:250,car4c:60 };

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
