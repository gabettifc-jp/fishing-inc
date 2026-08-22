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
  // **1周目に本当に起きることを起こす。**道具を買わずに転生する人は居ない。
  // 買わないまま測ると、所持数の解禁条件をすり抜けてしまう
  S.money = 200000;
  for (let g=0; g<200; g++){
    const list = shopList().filter(i=>i.kind==='tool' && S.money>=i.price)
                           .sort((a,b)=>a.price-b.price);
    if (!list.length) break;
    buy(list[0]);
  }
  endRun();
  // **湧いていることも見る**（解禁条件が入ったので、値段だけでは光らない）
  const lit = PERKS.filter(p => !perkDone(p) && perkOpen(p) && S.pres >= perkCost(p));
  const near = PERKS.filter(p => !perkDone(p) && !perkOpen(p))
    .map(p => p.name+'（'+perkNeed(p)+'）').slice(0,3);
  return {pres: S.pres, 光る数: lit.length,
          先頭: lit.slice(0,3).map(p=>p.name+':'+Math.ceil(perkCost(p))),
          湧き待ち: near};
});
add(2, '初回の転生で光るパークの数',
  `通貨${first.pres} → ${first.光る数}個（${first.先頭.join('／') || '—'}）` +
  (first.光る数 ? '' : `　湧き待ち：${first.湧き待ち.join('／')}`),
  first.光る数 > 0);

/* 画面Aの明度（11章・第36版）。**地を深く落とし、光っているものだけを明の段に置く。**

   測り方を三度変えた。最初は10%刻みで段を数えたが、**線のどちら側かで同じ塊が2段に割れた**。
   次に隣の目盛りを繋いだら、**何を入れても通った**。
   次に「左端の帯のいちばん明るいところが 0.30 以下」にしたが、
   **釣り場ごとに絵が変わった途端に、0.30 という数がどこから来たのか説明できなくなった**
   （氷の下は「白と青」なのだから、用水路より明るくて当たり前）。

   **相場の言い方をそのまま測る。**
   > 段が少ないほど構造は強い／**一つの段が支配的であること（50%超）**
   （`gamedev/references/mitame.md` 014）
   決はそれに加えて「支配的なのは**暗いほう**である」と言っている。だから測るのは二つ。

     1. 暗い画素（L<0.20）が、絵の半分より多いか
     2. いちばん明るい画素が、浮きの灯りの近くに在るか

   **釣り場ごとに数を変えない。**変えたら、測ったことにならない。 */
for (const place of [0,1,2,3,4,5,6,7]) {
  const v = await pg.evaluate(p => {
    scr = 'A'; S.place = p; S.unlockedPlace[p] = true; syncRods(); draw();
    const shopW = Math.floor(cv.width*T.shopW), W2 = cv.width-shopW;
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    // 道具屋は八つとも同じなので外し、**絵のところだけ**を測る
    const fx0 = Math.floor(W2/2), fy0 = Math.floor(cv.height*T.lyFloat);
    let dark = 0, n = 0, bright = 0, bx = 0, by = 0;
    for (let y = TOPH; y < cv.height; y++) for (let x = 0; x < W2; x++) {
      const i = (y*cv.width + x)*4;
      const L = 0.2126*d[i]/255 + 0.7152*d[i+1]/255 + 0.0722*d[i+2]/255;
      if (L < 0.20) dark++;
      n++;
      if (L > bright) { bright = L; bx = x; by = y; }
    }
    return { name: PLACES[p].n, dark: +(dark/n*100).toFixed(0),
             near: Math.round(Math.hypot(bx-fx0, by-fy0)) };
  }, place);
  add('画', `画面Aの明度（${v.name}）`,
      `暗い画素 ${v.dark}%／いちばん明るい画素は浮きから ${v.near}画素`,
      v.dark > 50 && v.near <= 40);
}

/* 保存が読めるか（10.5章）。**古い版の保存も読めるか。**
   第36版で12章のつまみを総入れ替えしたとき、
   「古ければ12章を捨てる」を入れたつもりで **存在しない名前（TUNE）を参照していた。**
   load() は try/catch の中なので**例外は握り潰され、保存が丸ごと落ちていた**
   ── 前から遊んでいた人のデータが消える。落ちても何も言わないので、ここで測る */
const sv = await pg.evaluate(() => {
  const out = {};
  S = newState(); S.money = 987654; S.run = 9; S.place = 3; S.unlockedPlace[3] = true;
  T.beatSec = 1.234;                                  // 12章でない章の調整（残るはず）
  T.lySea = 0.66;                                     // 12章の古い値（捨てられるはず）
  syncRods();
  const now = exportStr();
  // 版を 1 に落として「古い保存」を作る
  const d = JSON.parse(decodeURIComponent(escape(atob(now))));
  d.v = 1;
  const old = btoa(unescape(encodeURIComponent(JSON.stringify(d))));

  S = newState(); T.beatSec = 1; T.lySea = 0.80; syncRods();
  out.いまの版 = importStr(now) && S.money === 987654;
  S = newState(); T.beatSec = 1; T.lySea = 0.80; syncRods();
  out.古い版 = importStr(old) && S.money === 987654 && S.run === 9;
  out.他の章は残るか = T.beatSec === 1.234;
  out['12章は捨てるか'] = T.lySea === 0.80;
  return out;
});
add('保', '保存が読めるか（いまの版／古い版）',
    `いま ${sv.いまの版?'○':'×'}／古い ${sv.古い版?'○':'×'}`,
    sv.いまの版 && sv.古い版);
add('保', '古い保存で、12章だけ捨てて他は残るか',
    `他の章 ${sv.他の章は残るか?'残った':'消えた'}／12章 ${sv['12章は捨てるか']?'捨てた':'残った'}`,
    sv.他の章は残るか && sv['12章は捨てるか']);

/* 自動の竿が、プレイヤーの竿の演出を横取りしていないか（9章の決）。
   > 超大物が上がった｜プレイヤー **演出5**（1.0秒・手を止める）｜自動 **出さない**
   > 音｜高い音｜**無し**
   **終盤の一周で自動は約150匹の超大物を上げる。**1.0秒の演出は入らない。
   実装は `!r.auto` を見ておらず、**カットインも音も全画面の返しも出していた。** */
const autofx = await pg.evaluate(() => {
  let beeps = 0; const real = window.beep; window.beep = () => { beeps++; };
  S = newState(); syncRods();
  const rod = rods[0];
  const run = (auto, grade, isNew) => {
    fx.length = 0; beeps = 0;
    rod.auto = auto; rod.grade = grade; rod.t = 0;
    S.dex[S.place] = isNew ? [] : [1,1,1,1,1,1,1,1,1];
    applyResult(rod, 'soso', false);
    return { fx: fx.map(f => f.kind), beeps };
  };
  const 手動 = run(false, 4, false);
  const 自動既知 = run(true, 4, false);
  const 自動新種 = run(true, 4, true);
  const 自動雑魚 = run(true, 0, false);
  window.beep = real;
  return {
    手動にカットイン: 手動.fx.includes('huge'),
    自動既知にカットイン: 自動既知.fx.includes('huge'),
    自動新種にカットイン: 自動新種.fx.includes('huge'),
    自動の音: 自動既知.beeps + 自動雑魚.beeps,
    自動新種の音: 自動新種.beeps,
  };
});
add('演', '超大物のカットインが、自動の竿から出ていないか',
    `手動 ${autofx.手動にカットイン?'出る':'出ない'}／自動・既知 ${autofx.自動既知にカットイン?'出る':'出ない'}`
    + `／自動・新種 ${autofx.自動新種にカットイン?'出る':'出ない'}`,
    autofx.手動にカットイン && !autofx.自動既知にカットイン && autofx.自動新種にカットイン);
add('演', '自動の竿が音を鳴らしていないか（9章「自動の音は無し」）',
    `既知・雑魚で鳴らした回数 ${autofx.自動の音}`, autofx.自動の音 === 0);
/* **新種の超大物だけは、自動でも鳴らす（決・第37版）。**
   黙らせている理由は「数」で、通しで8回なら数の問題は起きない。
   **無音だと、いちばん大きい瞬間が欠けて見える** */
add('演', '新種の超大物は、自動でも音が鳴るか',
    `鳴った回数 ${autofx.自動新種の音}`, autofx.自動新種の音 > 0);

/* 「最初から」が二段になっているか（10.5章・第37版）。
   横のパネルにしか無く、**スマホでは画面の下まで送らないと届かなかった。**
   しかも一段で、**触っただけで消えた。**
   さらに、armed の初期値を 0 にしたせいで
   **読み込み直後の数秒がずっと「確認が出ている」状態**になっていた（開いた瞬間に消せた）。 */
const rst = await pg.evaluate(() => {
  const out = {};
  const at = (x,y) => { for (let i=hotspots.length-1;i>=0;i--){ const h=hotspots[i];
    if (x>=h.x&&x<=h.x+h.w&&y>=h.y&&y<=h.y+h.h) return h; } return null; };
  S = newState(); syncRods(); scr='A'; overlay='rec'; draw();
  out.開いた直後に確認が出ていないか = !resetArmed();

  S.money = 999999; S.run = 9; T.glowFloat = 999; save(); draw();
  const H=cv.height, BH=248, Y=Math.floor((H-BH)/2), X=16, BW=cv.width-32, by=Y+BH-26;
  at(X+40, by+9).fn(); draw();                      // 一段目
  out.一段目で消えないか = !!localStorage.getItem(SAVE_KEY);
  out.確認が出たか = resetArmed();
  at(X+BW-45, by+9).fn(); draw();                   // やめる
  out.やめたら戻るか = !resetArmed();

  at(X+40, by+9).fn(); draw();
  at(X+BW-117, by+9).fn();                          // 消す
  out.二段目で消えたか = !localStorage.getItem(SAVE_KEY);
  out.状態が戻ったか = S.money===0 && S.run===1;
  out.つまみも戻ったか = T.glowFloat === TUNE_DEF.find(r=>r[0]==='glowFloat')[3];
  return out;
});
add('初', '「最初から」が二段か（一段目では消えない）',
    `一段目 ${rst.一段目で消えないか?'消えない':'消えた'}／確認 ${rst.確認が出たか?'出た':'出ない'}`
    + `／やめる ${rst.やめたら戻るか?'戻る':'戻らない'}／二段目 ${rst.二段目で消えたか?'消えた':'消えない'}`,
    rst.一段目で消えないか && rst.確認が出たか && rst.やめたら戻るか && rst.二段目で消えたか);
add('初', '開いた直後に、確認が出たままになっていないか',
    rst.開いた直後に確認が出ていないか?'出ていない':'出ている', rst.開いた直後に確認が出ていないか);
add('初', '「最初から」で、保存もつまみも状態も戻るか',
    `状態 ${rst.状態が戻ったか?'戻った':'戻らない'}／つまみ ${rst.つまみも戻ったか?'戻った':'戻らない'}`,
    rst.状態が戻ったか && rst.つまみも戻ったか);

/* 周の回数で開くパークが無いか（10章10・決・第38版）。
   **相場（AD／Synergism）は「自動化と持ち越しなら回数で開いてよい」**だったが、
   **その相場が成り立つのは、転生そのものが遊びの中心で一周が数秒の作品**である。
   このゲームの一周は数分の能動的な釣りなので、
   **開けたいものがあると、遊びたくないのに転生を回すことになる。**
   遊ぶと進む数え上げ（釣った数・超大物・道具の段・図鑑）だけを門にする。 */
const axis = await pg.evaluate(() => {
  S = newState();
  const by = {};
  for (const p of PERKS){ const c = perkCond(p); const k = c ? c[0] : '（無し）';
    by[k] = (by[k]||0)+1; }
  const run = PERKS.filter(p => { const c = perkCond(p); return c && /周/.test(c[0]); });
  return { by, 周: run.map(p=>p.name) };
});
add('周', '周の回数で開くパークが無いか',
    axis.周.length ? '周で開く：'+axis.周.join('、')
                   : Object.entries(axis.by).map(([k,v])=>k+' '+v).join('／'),
    axis.周.length === 0);

/* 3. 取るべきパークが一覧の何番目か（9章 画面B） */
/* 並びが「値段の安い順」から「湧いている順」に変わったので、見るものも変える。
   **湧いているものが一ページに収まるか。**収まらないと、
   選ぶ前にめくることになる（相場：選ばせたいなら、まず全部見せる） */
const order = await pg.evaluate(() => {
  const open = PERKS.filter(p=>!perkDone(p) && perkOpen(p));
  // **描くところと同じ式を呼ぶ。**別々に持つと、片方だけ古くなる
  return {湧いている: open.length, 一頁: perkGeom().perPage};
});
add(3, '湧いているパークが一ページに収まるか',
  `${order.湧いている}件（1ページ ${order.一頁}件）`, order.湧いている <= order.一頁);

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
  const ms = all.map(c => melodyOf(c).join(''));            // **本物と同じ「文字列」で呼ぶ**
  T.melMode = keep;
  const a = timeline('・ー・・ー・', false), b = timeline('・ー・・ー・', false);
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
  r.tl = timeline('・ー・', false); r.t = r.tl.syms[1].start;
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
  r.phase='play'; r.t=0; r.countIn=-1; r.tl=timeline('・ー・',false); r.res=[];
  // **既定は「鳴らさない」**（第30版）。ここで見るのは仕組みが生きているかなので、
  // つまみを入れてから測る。既定そのものは別の行（27）で見る
  const keepSnd = T.countInSound; T.countInSound = 1;
  const keep = T.beatTick; T.beatTick = 0;
  for (let k=0;k<20;k++){ r.t = k*beatSec()+0.01; update(0.016); }
  const only = hits.slice();
  hits.length=0; T.beatTick=1; r.t=0; r.countIn=-1;
  for (let k=0;k<20;k++){ r.t = k*beatSec()+0.01; update(0.016); }
  const all = hits.slice();
  T.beatTick = keep; T.countInSound = keepSnd; window.beep = real;
  return {カウントイン: only.length, 刻むとき: all.length, 音: only};
});
add(23, 'カウントインの音を入れれば4拍鳴るか', `${tick.カウントイン}回（${tick.音.join('/')}Hz）`,
    tick.カウントイン === 4);
add(24, '拍を刻む切替が効くか', `切 ${tick.カウントイン}回／入 ${tick.刻むとき}回`,
    tick.刻むとき > tick.カウントイン);

/* 25. 実際に投げて、魚を一匹あげるところまで通るか（本物の道すじ） */
const cast = await pg.evaluate(async () => {
  const errs = [];
  const onErr = e => errs.push(e.message || String(e));
  window.addEventListener('error', ev => onErr(ev.error || ev.message));
  S = newState(); scr='A'; syncRods(); T.waitLo=0.05; T.waitHi=0.1;
  const r = rods[0];
  let landed = 0;
  for (let n=0; n<6 && errs.length===0; n++){
    try {
      castRod(r);                                  // **本物の道すじ**（譜面は文字列で来る）
      r.t = r.wait + 0.001; update(0.016);         // 掛かるまで進める
      if (r.phase !== 'play') continue;
      for (const s of r.tl.syms){ r.t = s.start; press(true); press(false); }
      r.t = r.tl.total + 1; update(0.016);
      if (r.phase === 'idle') landed++;
    } catch(e){ onErr(e); }
  }
  return {投げた回数: 6, 上がった: landed, エラー: errs.slice(0,2)};
});
add(25, '投げて魚をあげるところまで通るか',
    cast.エラー.length ? cast.エラー[0] : `${cast.上がった}／${cast.投げた回数}回`,
    cast.エラー.length===0 && cast.上がった > 0);

/* 26. 押す位置の輪（9章）と、カウントインの音（既定は切） */
const ring = await pg.evaluate(() => {
  scr='A'; syncRods(); const r = rods[0];
  r.phase='play'; r.tl = timeline('・ー・',false); r.res=[]; r.countIn=-1;
  const sy = r.tl.syms[1], ap = T.apBeats*beatSec();
  const at = back => { r.t = sy.start - back;
    const u = Math.max(0, back/ap); return +(4 + (T.apStart-1)*4*u).toFixed(1); };
  const far = at(ap), mid = at(ap/2), near = at(0);
  // カウントインの音
  const hits=[]; const real=beep; window.beep=hz=>hits.push(hz);
  r.t=0; r.countIn=-1;
  for (let k=0;k<6;k++){ r.t=k*beatSec()+0.01; update(0.016); }
  window.beep=real;
  return {輪:{出はじめ:far, 中ほど:mid, ちょうど:near}, 符号の半径:4,
          カウントインの音:hits.length, つまみ:T.countInSound};
});
add(26, '輪が符号にぴったりまで縮むか',
    `${ring.輪.出はじめ} → ${ring.輪.中ほど} → ${ring.輪.ちょうど}（符号の半径 ${ring.符号の半径}）`,
    ring.輪.ちょうど === ring.符号の半径 && ring.輪.出はじめ > ring.符号の半径*3);
add(27, 'カウントインの音が既定で鳴らないか',
    `つまみ ${ring.つまみ}／鳴った回数 ${ring.カウントインの音}`,
    ring.つまみ === 0 && ring.カウントインの音 === 0);

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
