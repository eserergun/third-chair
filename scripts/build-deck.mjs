// Builds a standalone viewer (index.html) for a slide deck kept as files:
//   <deck>/deck.json      title, order, faces (Google Fonts links)
//   <deck>/slides/<id>.html   one <section> per slide (the Slides artifact format)
// The viewer scales 1920x1080 slides to the window, plays build-ins, and prints one slide per page.
//   node scripts/build-deck.mjs docs/decks/mvp-en
//   node scripts/build-deck.mjs docs/decks/mvp-en --pdf      # also writes <deck>/<name>.pdf
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dir = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
  console.error("usage: node scripts/build-deck.mjs <deck dir> [--pdf]");
  process.exit(2);
}
const deck = JSON.parse(readFileSync(path.join(dir, "deck.json"), "utf8"));

const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// Simple 24x24 stroke icons for the <x-icon> names the decks use.
const ICONS = {
  Users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/><circle cx="17" cy="9" r="2.8"/><path d="M15.5 13.6c3.3-.6 6 1.9 6 5.4"/>',
  Globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  Database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="3"/><path d="M4.5 5.5v13c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-13"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
  Lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  Key: '<circle cx="8" cy="15" r="4.5"/><path d="M11.2 11.8 20 3"/><path d="M16.5 6.5l2.5 2.5"/><path d="M14 9l2 2"/>',
  Star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  Chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  Trust: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  Cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.6A3.3 3.3 0 0 0 7 18.5z"/>',
  Verified: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  Lightning: '<path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12z"/>',
  Code: '<path d="M8.5 7 3.5 12l5 5"/><path d="M15.5 7l5 5-5 5"/><path d="M13.5 4.5l-3 15"/>',
  Check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  Link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
  Chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 16l4-5 3 3 5-7"/>',
  Play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z"/>',
  Home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
};

const SHAPES = {
  "arrow-right": "polygon(0 30%, 60% 30%, 60% 0, 100% 50%, 60% 100%, 60% 70%, 0 70%)",
  "arrow-left": "polygon(100% 30%, 40% 30%, 40% 0, 0 50%, 40% 100%, 40% 70%, 100% 70%)",
  "arrow-up": "polygon(30% 100%, 30% 40%, 0 40%, 50% 0, 100% 40%, 70% 40%, 70% 100%)",
  "arrow-down": "polygon(30% 0, 30% 60%, 0 60%, 50% 100%, 100% 60%, 70% 60%, 70% 0)",
  diamond: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)",
};

function convert(html) {
  // Live embeds become sandboxed iframes, the same as in the Slides runtime.
  html = html.replace(/<x-embed([^>]*)style="([^"]*)"([^>]*)>([\s\S]*?)<\/x-embed>/g, (_m, a, style, b, inner) =>
    `<iframe class="xe"${a}${b} sandbox="allow-scripts" style="${style};border:0;background:transparent" srcdoc="${esc(inner)}"></iframe>`);
  html = html.replace(/<x-shape kind="([a-z-]+)"([^>]*)><\/x-shape>/g, (_m, kind, rest) => {
    const clip = SHAPES[kind];
    const extra = kind === "ellipse" ? "border-radius:50%;" : clip ? `clip-path:${clip};` : "";
    return `<div data-shape="${kind}"${rest.replace(/style="/, `style="${extra}`)}></div>`;
  });
  html = html.replace(/<x-icon name="([A-Za-z]+)"([^>]*)><\/x-icon>/g, (_m, name, rest) => {
    const body = ICONS[name] ?? ICONS.Star;
    return `<svg data-icon="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"${rest}>${body}</svg>`;
  });
  return html;
}

const slides = deck.order.map((id, i) => {
  const raw = readFileSync(path.join(dir, "slides", `${id}.html`), "utf8").trim();
  return `<div class="slide" data-n="${i + 1}">${convert(raw)}</div>`;
});

const fonts = Object.values(deck.faces ?? {})
  .map((f) => f.href)
  .filter((h) => typeof h === "string" && h.startsWith("https://fonts.googleapis.com/css2?"))
  .map((h) => `<link rel="stylesheet" href="${esc(h)}">`)
  .join("\n");

const page = `<!doctype html>
<html lang="${/[ğışçöüİ]/.test(JSON.stringify(deck)) ? "tr" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${deck.title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
${fonts}
<style>
html,body{margin:0;height:100%;background:#0d0b09;overflow:hidden}
#stage{position:absolute;left:50%;top:50%;width:1920px;height:1080px;transform-origin:0 0}
.slide{position:absolute;inset:0;opacity:0;pointer-events:none;transition:opacity .45s ease}
.slide.on{opacity:1;pointer-events:auto}
section{position:relative;width:1920px;height:1080px;box-sizing:border-box;overflow:hidden}
section *{box-sizing:border-box}
section h1,section h2,section h3,section p,section ul,section ol{margin:0}
section ul,section ol{padding-left:36px}
section table{border-collapse:collapse}
section td,section th{padding:12px 22px;vertical-align:top;border-bottom:1px solid rgba(0,0,0,.12)}
section a{color:inherit}
section aside{display:none}
.slide.on [data-build-in]{animation:bi .6s ease both}
@keyframes bi{from{opacity:0;transform:translateY(24px)}to{opacity:1}}
#bar{position:fixed;left:0;right:0;bottom:0;display:flex;gap:16px;align-items:center;justify-content:center;padding:8px;font:14px system-ui,sans-serif;color:#bbb;background:rgba(0,0,0,.35)}
#bar button{font:inherit;color:#eee;background:#2a241e;border:1px solid #4a3f35;border-radius:6px;padding:4px 10px;cursor:pointer}
#notes{position:fixed;left:16px;right:16px;bottom:48px;max-height:30vh;overflow:auto;display:none;padding:14px 18px;font:16px/1.5 system-ui,sans-serif;color:#eee;background:rgba(20,16,12,.92);border:1px solid #4a3f35;border-radius:10px}
@media print{
  @page{size:1920px 1080px;margin:0}
  html,body{height:auto;overflow:visible;background:none}
  #stage{position:static;transform:none!important;width:auto;height:auto}
  .slide{position:relative;opacity:1;break-after:page;page-break-after:always;width:1920px;height:1080px}
  .slide [data-build-in]{animation:none!important;opacity:1!important}
  #bar,#notes{display:none!important}
}
</style>
</head>
<body>
<div id="stage">
${slides.join("\n")}
</div>
<div id="notes"></div>
<div id="bar"><button id="prev" type="button">Prev</button><span id="count"></span><button id="next" type="button">Next</button><button id="nb" type="button">Notes (N)</button></div>
<script>
(function(){
  var s=[].slice.call(document.querySelectorAll('.slide')),i=0,stage=document.getElementById('stage');
  var notes=document.getElementById('notes'),count=document.getElementById('count');
  // Build-ins play in their order number, one after another.
  s.forEach(function(sl){[].slice.call(sl.querySelectorAll('[data-build-in]')).forEach(function(el){
    var m=/(\\d+)/.exec(el.getAttribute('data-build-in')||'');el.style.animationDelay=((m?+m[1]:1)-1)*0.35+'s';});});
  function fit(){var k=Math.min(innerWidth/1920,innerHeight/1080);stage.style.transform='translate('+(-960*k)+'px,'+(-540*k)+'px) scale('+k+')';}
  function show(n){i=Math.max(0,Math.min(s.length-1,n));s.forEach(function(sl,j){sl.className=j===i?'slide on':'slide';});
    count.textContent=(i+1)+' / '+s.length;var a=s[i].querySelector('aside');notes.textContent=a?a.textContent:'';
    if(location.hash!=='#'+(i+1))history.replaceState(null,'','#'+(i+1));}
  addEventListener('resize',fit);
  addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown')show(i+1);
    else if(e.key==='ArrowLeft'||e.key==='PageUp')show(i-1);
    else if(e.key==='Home')show(0);else if(e.key==='End')show(s.length-1);
    else if(e.key==='n'||e.key==='N')notes.style.display=notes.style.display==='block'?'none':'block';
    else if(e.key==='f'||e.key==='F'){if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen();}});
  document.getElementById('prev').onclick=function(){show(i-1);};
  document.getElementById('next').onclick=function(){show(i+1);};
  document.getElementById('nb').onclick=function(){notes.style.display=notes.style.display==='block'?'none':'block';};
  fit();show((parseInt(location.hash.slice(1),10)||1)-1);
})();
</script>
</body>
</html>
`;

const out = path.join(dir, "index.html");
writeFileSync(out, page);
console.log(`wrote ${path.relative(process.cwd(), out)} (${deck.order.length} slides)`);

if (process.argv.includes("--pdf")) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto(pathToFileURL(out).href, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(2500); // let the live embeds draw a frame
  const pdf = path.join(dir, `${path.basename(dir)}.pdf`);
  await p.pdf({ path: pdf, width: "1920px", height: "1080px", printBackground: true, preferCSSPageSize: true });
  await browser.close();
  console.log(`wrote ${path.relative(process.cwd(), pdf)}`);
}
