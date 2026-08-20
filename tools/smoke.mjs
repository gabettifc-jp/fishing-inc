/* 実物が動くかだけを見る。読み込んで、押して、しばらく回してエラーが出ないか。
   画面は builds/now.png に出す。**触って判定する前に、まずこれを通す。**

     node tools/smoke.mjs
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = 'file://' + path.resolve(HERE, '..', 'src', 'fishing-inc.html');
const b = await chromium.launch(); const pg = await b.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(e.message));
pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await pg.goto(PAGE);
await pg.waitForTimeout(500);

const before = await pg.evaluate(() => ({ money: S.money, rods: rods.length, phase: rods[0]?.phase,
  scr, overlay, blocked: blocked(), blockUntil, now: performance.now()/1000 }));
// 水面を押して投げ、譜面のあいだ叩く
// 起動直後は画面C（釣り場選び）。画面Aへ入る
await pg.evaluate(() => { scr = 'A'; syncRods(); });
// 譜面が出ている瞬間を捕まえる。待ちを短くして、8符号が出るまで投げ直す
await pg.evaluate(() => { T.waitLo = 0.3; T.waitHi = 0.6; });
for (let i = 0; i < 200; i++) {
  const st = await pg.evaluate(() => ({ ph: rods[0]?.phase, t: rods[0]?.t, n: rods[0]?.tl?.syms.length }));
  if (st.ph === 'idle') await pg.keyboard.press('Space');
  else if (st.ph === 'play' && st.n >= 5 && st.t > 1.3 && st.t < 3.0) break;
  await pg.waitForTimeout(60);
}
await pg.waitForTimeout(1000);
const after = await pg.evaluate(() => ({
  money: S.money, casts: S.rec.casts, phase: rods[0]?.phase,
  band: rods[0]?.tl ? { syms: rods[0].tl.syms.length, total: rods[0].tl.total } : null,
  frame: frameBeats(), bandSec: bandSec(), beat: T.beat,
}));
console.log('起動時 ', JSON.stringify(before));
console.log('30回押した後', JSON.stringify(after));
console.log('エラー', errs.length ? errs.slice(0, 5) : 'なし');
await pg.screenshot({ path: path.resolve(HERE, '..', 'builds', 'now.png') });
console.log('画面を builds/now.png に保存した');
await b.close();

// **失敗は必ず最後の行と終了コードに出す。**
// `| tail -1` で見たときに「保存した」だけが残ると、エラーを見落とす。
// 一度これで実際に見落とした（2026-08-20・魚が掛かると落ちる件）
if (errs.length){
  console.error('\n★エラーあり（' + errs.length + '件）');
  for (const e of errs.slice(0,5)) console.error('  ' + e);
  process.exit(1);
}
console.log('\nエラーなし');
process.exit(0);
