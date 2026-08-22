/* itch.io に上げる形を作る。

     node tools/build-itch.mjs

   出すもの
     dist/index.html          … 開発用のつまみパネルを外し、画面を伸び縮みさせた一枚
     dist/fishing-inc.zip     … itch.io にそのまま上げる包み（index.html が根に居る）

   **置き換えは全部 assert する。**src が変わって当たらなくなったら、
   黙って開発用パネル入りを配ってしまうので、そこで止める。
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC  = path.join(ROOT, 'src', 'fishing-inc.html');
const DIST = path.join(ROOT, 'dist');

let s = readFileSync(SRC, 'utf8');
const cut = (a, b, why) => {
  if (!s.includes(a)) { console.error('見つからない：' + why + '\n  ' + a.slice(0,60)); process.exit(1); }
  s = s.replace(a, b);
};

/* 1. 開発用のつまみパネルを外す。**遊ぶ人には要らないし、数字を触れると測れない** */
cut('  <div class="side" id="side"></div>\n', '', '横のパネルの入れ物');
cut('buildTuner();\n', '/* 配信版ではつまみパネルを作らない（tools/build-itch.mjs） */\n',
    'つまみパネルを組み立てる呼び出し');

/* 2. 画面を伸び縮みさせる。**粒は補間させない**（ドット絵なので、ぼけると別物になる） */
cut('</style>', `
  /* --- 配信版（itch.io）。ここから下は tools/build-itch.mjs が足している --- */
  html,body{height:100%;overflow:hidden;background:#04080a}
  #wrap{height:100%;margin:0;padding:0;display:flex;align-items:center;
        justify-content:center;gap:0}
  #stage{width:100%;height:100%;display:flex;flex-direction:column;
         align-items:center;justify-content:center;gap:6px;padding:6px}
  #cv{width:auto;height:auto;max-width:100%;max-height:calc(100% - 22px);
      aspect-ratio:720/405;                 /* 16対9（9章） */
      image-rendering:pixelated;            /* **ぼかさない。**ドット絵が別物になる */
      image-rendering:crisp-edges}
  .hint{max-width:100%;text-align:center;font-size:11px;opacity:.6}
</style>`, 'スタイルの終わり');

/* 3. 触り方の一行を、遊ぶ人向けにする（開発用の言い回しを外す） */
cut("document.getElementById('help').textContent =\n" +
    "  '押す＝スペース／Z／クリック。単押しと押しっぱなしの二種類だけ。';",
    "document.getElementById('help').textContent =\n" +
    "  '押す＝スペース／Z／画面をタップ。長い符号は押しっぱなし。';",
    '触り方の一行');

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
writeFileSync(path.join(DIST, 'index.html'), s);

/* 4. 包む。**index.html が根に居ること**が itch.io の条件 */
execFileSync('zip', ['-q', '-j', 'fishing-inc.zip', 'index.html'], { cwd: DIST });

const kb = n => Math.round(readFileSync(path.join(DIST, n)).length/1024) + 'KB';
console.log('dist/index.html        ' + kb('index.html'));
console.log('dist/fishing-inc.zip   ' + kb('fishing-inc.zip'));
console.log('');
console.log('itch.io の設定');
console.log('  種類            HTML');
console.log('  上げるもの       dist/fishing-inc.zip（index.html が根に居る）');
console.log('  「This file will be played in the browser」に印を付ける');
console.log('  Viewport        720 × 405（16対9。9章）');
console.log('  Fullscreen      有効にする（伸び縮みするので大きい画面でも崩れない）');
console.log('  Mobile friendly 有効にする（押しっぱなしが効くようにしてある）');
