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

/* 14. 道具の一行にも効果が出るか（9章 画面A） */
const tools = await pg.evaluate(() => {
  scr='A'; S.perks={opn1:true}; S.money=1e9; S.tools={bait:2,line:1,reel:1,cool:2,rod:1}; syncRods();
  const list = shopList();
  const miss = list.filter(i => { const t = toolEff(i); return !t || !(/→/.test(t)||/開く/.test(t)); });
  const rate = list.filter(i => /稼ぎ/.test(toolEff(i))).map(i=>i.name);
  return {全: list.length, 数の無い行: miss.map(i=>i.name), 倍率つき: rate};
});
add(14, '道具の全行に「いま → 買った後」が出るか',
    `${tools.全-tools.数の無い行.length}／${tools.全}行`, tools.数の無い行.length===0);
add(15, '稼ぎの倍率が付くのは、稼ぎが動く道具だけか',
    tools.倍率つき.join('／') || 'なし',
    !tools.倍率つき.includes('リール') && !tools.倍率つき.includes('釣り糸'));

/* 15. 入れ食いは終盤にだけ効くか（10章10） */
const iref = await pg.evaluate(() => {
  const at = lv => { S.tools.bait=lv;
    S.perks={};            const a = waitRange().lo;
    S.perks={opn11:true};  const b = waitRange().lo;
    return {lv, 素:+a.toFixed(2), 入れ食い:+b.toFixed(2)}; };
  return [0,10,20,30].map(at);
});
const bites = iref.filter(r => r.入れ食い < r.素);
add(16, '入れ食いが効き始める餌の段数',
    bites.length ? `餌${bites[0].lv}段から（${bites[0].素}秒 → ${bites[0].入れ食い}秒）` : '一度も効かない',
    bites.length > 0 && bites[0].lv >= 20);

/* 17. 旋律（11章） */
const mel = await pg.evaluate(() => {
  const all = [...POOL, ...BOSS_CHART];
  const keep = T.melMode; T.melMode = 0;                  // 「譜面の形」のときを見る
  const ms = all.map(c => melodyOf([...c]).join(''));
  T.melMode = keep;
  const a = timeline([...'・ー・・ー・'], false), b = timeline([...'・ー・・ー・'], false);
  const gapSame = a.syms.map(s=>s.start.toFixed(2)).join() === b.syms.map(s=>s.start.toFixed(2)).join();
  const hz = [...new Set(all.flatMap(c=>melodyOf([...c])))].map(k=>Math.round(melHz(k)));
  return {本数: all.length, 別々: new Set(ms).size, いまの決め方: T.melMode,
          同じ譜面で同じ旋律: a.mel.join('')===b.mel.join(''), 間隔は毎回同じ: gapSame,
          いちばん低い音: Math.min(...hz), いちばん高い音: Math.max(...hz)};
});
// 「全部ちがう旋律にする」は**目標にしない**（ばらけさせるほどまとまらない）。
// 見るのは「同じ譜面なら同じ旋律か」と「決め方を切り替えられるか」だけ
add(17, '旋律の決め方を切り替えられるか',
    `いま ${Math.round(mel.いまの決め方)===1?'昇る':'譜面の形'}／形のとき ${mel.別々}／${mel.本数}本`,
    mel.別々 > 1);
add(18, '同じ譜面はいつも同じ旋律か（間隔は毎回ちがうのに）',
    `旋律 ${mel.同じ譜面で同じ旋律?'同じ':'ちがう'}／間隔 ${mel.間隔は毎回同じ?'同じ':'ちがう'}`,
    mel.同じ譜面で同じ旋律 && !mel.間隔は毎回同じ);
add(19, '旋律が高い音域に収まっているか（報酬の音は高い音）',
    `${mel.いちばん低い音}〜${mel.いちばん高い音}Hz`, mel.いちばん低い音 >= 1000);

const snd = await pg.evaluate(() => {
  scr='A'; overlay=null; blockUntil=0; S.perks={}; syncRods();
  const r=rods[0]; r.phase='play'; r.res=[]; r.extra=0; r.holding=false; r.aim=-1;
  r.tl = timeline([...'・ー・'], false); r.t = r.tl.syms[1].start;
  press(true); const hold = !!melVoice; press(false); const after = !!melVoice;
  r.res=[]; r.aim=-1; r.t = 0.1; press(true); const outside = !!melVoice; press(false);
  return {長音で伸びる: hold, 離すと止まる: !after, 窓の外で鳴らない: !outside,
          つまみ: !!T.melHold};
});
add(20, '長音の伸びが、つまみのとおりか',
    `つまみ ${snd.つまみ?'入':'切'}／実際 ${snd.長音で伸びる?'伸びる':'伸びない'}`,
    snd.つまみ === snd.長音で伸びる);
add(21, '離すと止まるか', snd.離すと止まる?'止まる':'止まらない', snd.離すと止まる);
add(22, '窓の外では鳴らないか（旋律に穴があく）',
    snd.窓の外で鳴らない?'鳴らない':'鳴る', snd.窓の外で鳴らない);

/* 23. 拍が鳴るか（3章「カウントインの4拍だけ、一拍ごとに音を鳴らす」） */
const tick = await pg.evaluate(() => {
  const hits = []; const real = beep; window.beep = hz => hits.push(Math.round(hz));
  scr='A'; syncRods(); const r = rods[0];
  r.phase='play'; r.t=0; r.countIn=-1; r.tl=timeline([...'・ー・'],false); r.res=[];
  const keep = T.beatTick; T.beatTick = 0;
  for (let k=0;k<20;k++){ r.t = k*beatSec()+0.01; update(0.016); }
  const only = hits.slice();
  hits.length=0; T.beatTick=1; r.t=0; r.countIn=-1;
  for (let k=0;k<20;k++){ r.t = k*beatSec()+0.01; update(0.016); }
  const all = hits.slice();
  T.beatTick = keep; window.beep = real;
  return {カウントイン: only.length, 刻むとき: all.length, 音: only};
});
add(23, 'カウントインの4拍が鳴るか', `${tick.カウントイン}回（${tick.音.join('/')}Hz）`,
    tick.カウントイン === 4);
add(24, '拍を刻む切替が効くか', `切 ${tick.カウントイン}回／入 ${tick.刻むとき}回`,
    tick.刻むとき > tick.カウントイン);

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
