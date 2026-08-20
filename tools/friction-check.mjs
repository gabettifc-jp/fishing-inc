/* つまらなさの流れの「測る」段（gamedev/flow.md）。
   friction.md の翻訳に添えた**測り方**を、機械で測れるぶんだけ実際に測る。
   機械で測れないものは、測れないと出す。**黙って飛ばさない。**

     node tools/friction-check.mjs
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = 'file://' + path.resolve(HERE, '..', 'src', 'fishing-inc.html');

const b = await chromium.launch(); const pg = await b.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto(PAGE); await pg.waitForTimeout(400);

const rows = [];
const add = (no, what, got, ok) => rows.push({no, what, got, ok});

/* 1. 返しがゼロの外し方が在るか（8章0） */
const back = await pg.evaluate(() => {
  const out = {};
  let beeps = 0; const realBeep = beep; window.beep = (...a)=>{ beeps++; return realBeep(...a); };
  const probe = (name, fn) => {
    beeps = 0; edgeAt = -9; dirMsg = '';
    fn();
    out[name] = {音: beeps>0, 端: edgeAt > -9, 向き: dirMsg || null};
  };
  scr='A'; syncRods(); const r = rods[0];
  probe('当たり',      ()=>pressBack('hit', 0));
  probe('かすり',      ()=>pressBack('graze', 0.09));
  probe('窓の外',      ()=>pressBack('miss', 0));
  probe('長音を早く離す', ()=>releaseBack());
  return out;
});
for (const [k,v] of Object.entries(back))
  add(1, `外し方「${k}」に返しが在るか`,
      `音${v.音?'○':'×'} 端${v.端?'○':'×'} 向き${v.向き||'—'}`,
      v.音 || v.端);

/* 2. 初回の転生で、買えるパークが一つでも光るか（9章 画面B） */
const first = await pg.evaluate(() => {
  S = newState(); S.rec = newRunRecord(1); S.rec.earn = 200000; scr='A'; syncRods();
  endRun();
  const lit = PERKS.filter(p => !has(p.id) && S.pres >= T[p.costKey]);
  return {pres: S.pres, 光る数: lit.length, 先頭: lit.slice(0,3).map(p=>p.name+':'+T[p.costKey])};
});
add(2, '初回の転生で光るパークの数', `通貨${first.pres} → ${first.光る数}個（${first.先頭.join('／')}）`, first.光る数 > 0);

/* 3. 取るべきパークが一覧の何番目か（9章 画面B） */
const order = await pg.evaluate(() => {
  const ord = PERKS.slice().sort((a,b)=>{
    const oa=has(a.id)?1:0, ob=has(b.id)?1:0;
    if (oa!==ob) return oa-ob; return T[a.costKey]-T[b.costKey];
  });
  const listH = cv.height-(TOPH+132)-30, rowH = 34;
  const perPage = Math.floor((listH-6)/rowH)*2;
  return {位置: ord.findIndex(p=>p.id==='opn1')+1, 一頁: perPage};
});
add(3, '「自動の竿が解放される」の一覧での位置', `${order.位置}番目（1ページ ${order.一頁}件）`, order.位置 <= order.一頁);

/* 4. 一回の終わりに、絵・名前・値段が出るか。長さは演出1と別か（8章1） */
const card = await pg.evaluate(() => {
  fx.length = 0; const r = rods[0];
  r.auto = false; r.grade = 3; r.t = 0;
  applyResult(r, 'soso', false);
  const c = fx.find(f => f.kind === 'card');
  const one = fx.find(f => f.kind === 'soso');
  return c ? {札: true, 名前: FISH[S.place][r.last.slot], 値段: r.last.money,
              札の長さ: +c.dur.toFixed(2), 演出1の長さ: one? +one.dur.toFixed(2) : null,
              枠: r.last.slot} : {札: false};
});
add(4, '釣果の札に名前と値段が出るか', card.札 ? `${card.名前} ／ ${card.値段}円` : '出ない', !!card.札 && card.値段>0);
add(5, '演出1を伸ばしていないか', `演出1 ${card.演出1の長さ}秒／札 ${card.札の長さ}秒`, card.演出1の長さ <= 0.31);
add(6, '名前は釣った枠から引いているか', `枠${card.枠} → ${card.名前}`, true);

/* 7b. 窓の外で押したとき、向きが本当か（8章0）。
      前は 0 を渡していたので、早く押しても必ず「遅い」と出ていた */
const dir = await pg.evaluate(() => {
  scr='A'; overlay=null; blockUntil=0; S.perks={}; syncRods();
  const r = rods[0];
  const set = t => { r.phase='play'; r.res=[]; r.extra=0; r.holding=false; r.aim=-1;
                     r.tl={syms:[{start:3.0,dur:0.25,long:false}],total:5}; r.t=t;
                     dirMsg=''; press(true); press(false); return dirMsg; };
  return {早く押した: set(0.5), 遅く押した: set(5.0)};
});
add(12, '窓の外で早く押したとき', dir.早く押した || '出ない', dir.早く押した === '早い');
add(13, '窓の外で遅く押したとき', dir.遅く押した || '出ない', dir.遅く押した === '遅い');

/* 7. 距離の上限：離れた符号は消えないか（3章） */
const far = await pg.evaluate(() => {
  scr='A'; overlay=null; blockUntil=0; S.perks={}; syncRods();
  const r = rods[0];
  r.phase='play'; r.res=[]; r.extra=0; r.holding=false; r.aim=-1;
  r.tl = {syms:[{start:3.0,dur:0.25,long:false}], total:5};
  r.t = 0.5;                                   // 2.5秒 離れた場所で押す
  press(true); press(false);
  return {残っているか: !r.res[0], 余計押し: r.extra||0};
});
add(7, '窓の外で押しても符号を掴まないか', `符号${far.残っているか?'残る':'消えた'}／余計押し ${far.余計押し}`, far.残っているか && far.余計押し===1);

/* 8. 長音の直後の符号を、両方取れるか（3章・9章） */
const gap = await pg.evaluate(() => {
  const long = T.dashBeats * beatSec();          // 長音の長さ
  const keep = long * T.holdKeep;                // 離してよい位置
  return {長音: +long.toFixed(3), 離してよい: +keep.toFixed(3), 余裕ms: Math.round((long-keep)*1000)};
});
add(8, '長音を離してから次を押す余裕', `長音${gap.長音}秒／離してよい${gap.離してよい}秒 → 余裕 ${gap.余裕ms}ms`, gap.余裕ms >= 100);

/* 9. 自動購入：切れるか、移動手段のぶんを残すか（10章10） */
const auto = await pg.evaluate(() => {
  S = newState(); S.perks={opn1:true,opn5:true}; syncRods();
  const np = nextPlace(), keep = moveCost(np);
  S.money = keep + 50;  autoBuy(); const 残す = S.money === keep + 50;
  S.money = keep + 1e6; S.autoBuyOn = false; autoBuy(); const 切れる = S.money === keep + 1e6;
  S.autoBuyOn = true;   autoBuy(); const 入る = S.money < keep + 1e6;
  return {残す, 切れる, 入る, keep};
});
add(9, '自動購入を切れるか', auto.切れる ? '切ると買わない' : '切っても買う', auto.切れる);
add(10, '次の移動手段のぶんを残すか', auto.残す ? `残す（${auto.keep}円）` : '残さない', auto.残す);

/* 11. パークの一行に数が出ているか（9章 画面B） */
const eff = await pg.evaluate(() => {
  const miss = PERKS.filter(p => { const t = perkEff(p); return !t || !/→/.test(t); });
  return {全: PERKS.length, 数の無い行: miss.map(p=>p.name)};
});
add(11, 'パークの全行に「いま → 取った後」が出るか', `${eff.全-eff.数の無い行.length}／${eff.全}行`, eff.数の無い行.length===0);

/* --- 出力 --- */
const w = Math.max(...rows.map(r=>r.what.length));
console.log('測った（つまらなさの流れの「測る」段）\n');
for (const r of rows)
  console.log(` ${r.ok?'○':'×'} ${r.what.padEnd(w,'　')}  ${r.got}`);
console.log('\n機械では測れないもの（人が触るしかない）');
for (const s of [
  '押した対象そのもので「押せた」が伝わるか（画面の隅を隠して触る）',
  '保持中に足した演出がうるさくないか',
  '魚の絵が「その魚らしい」か',
  '拍の速さ1.1が気持ちよいか',
]) console.log(` − ${s}`);
console.log(errs.length ? '\nエラー ' + errs.slice(0,3).join(' / ') : '\nエラー なし');
const ng = rows.filter(r=>!r.ok).length;
console.log(ng ? `\n外れ ${ng} 件` : '\n外れ なし');
await b.close();
process.exit(ng ? 1 : 0);
