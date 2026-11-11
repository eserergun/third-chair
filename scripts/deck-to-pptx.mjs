// Turns a slide deck kept as files (deck.json + slides/<id>.html, see build-deck.mjs) into an
// editable .pptx that opens in Google Slides, PowerPoint and Keynote.
//   node scripts/deck-to-pptx.mjs docs/decks/eser-tr             -> docs/decks/eser-tr/eser-tr.pptx
//   node scripts/deck-to-pptx.mjs docs/decks/eser-tr --static    live embeds as still images (smaller file)
//   node scripts/deck-to-pptx.mjs docs/decks/eser-tr --shots=DIR also save a 1920x1080 PNG of each slide
// How it works: the slides render in Chromium at 1920x1080, the same way index.html shows them.
// Every painted box becomes a native shape, every text block an editable text box in the deck's
// Google Fonts, icons and drawings become PNGs, and each live embed becomes a looping GIF (ffmpeg).
// Speaker notes and slide transitions carry over. Build-in steps do not: every element is visible.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pptxgen from "pptxgenjs";
import JSZip from "jszip";
import { chromium } from "@playwright/test";

const argv = process.argv.slice(2);
const dirArg = argv.find((a) => !a.startsWith("--"));
if (!dirArg) {
  console.error("usage: node scripts/deck-to-pptx.mjs <deck dir> [--static] [--shots=DIR] [--out=FILE] [--only=id,id] [--keep]");
  process.exit(2);
}
const flag = (name) => argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const flagValue = (name) => flag(name)?.split("=").slice(1).join("=") || "";
const dir = path.resolve(dirArg);
const here = path.dirname(fileURLToPath(import.meta.url));
const deck = JSON.parse(readFileSync(path.join(dir, "deck.json"), "utf8"));
const name = path.basename(dir);
const out = path.resolve(flagValue("out") || path.join(dir, `${name}.pptx`));
const staticEmbeds = Boolean(flag("static"));
const shotsDir = flagValue("shots") ? path.resolve(flagValue("shots")) : "";
const only = flagValue("only") ? flagValue("only").split(",") : null;
const keep = Boolean(flag("keep"));
const turkish = /[ğışçöüİ]/.test(JSON.stringify(deck));
const lang = turkish ? "tr-TR" : "en-US";

const PX = 1 / 144; // inches per CSS px: 1920 px = 13.333 in
const PT = 0.5; // points per CSS px
const tmp = mkdtempSync(path.join(os.tmpdir(), "deck-pptx-"));
let fileNo = 0;
const tmpFile = (ext) => path.join(tmp, `f${++fileNo}.${ext}`);

// 1. The viewer: the same page index.html shows, rebuilt from the current sources.
execFileSync(process.execPath, [path.join(here, "build-deck.mjs"), dir], { stdio: "inherit" });
const viewer = pathToFileURL(path.join(dir, "index.html")).href;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
await page.goto(viewer, { waitUntil: "networkidle" });
await page.addStyleTag({
  content: `
#stage{left:0!important;top:0!important;transform:none!important}
#bar,#notes{display:none!important}
.slide{transition:none!important}
[data-build-in]{animation:none!important;opacity:1!important}
[data-unrot]{transform:none!important}
html.solo,html.solo body,html.solo #stage{background:transparent!important}
html.solo body *{visibility:hidden!important}
html.solo .solo-on,html.solo .solo-on *{visibility:visible!important}`,
});
await page.evaluate(() => document.fonts.ready);

// 2. Read each slide: boxes, text, pictures and embeds, in paint order.
function extractSlide({ index, lang }) {
  const slides = [...document.querySelectorAll(".slide")];
  slides.forEach((s, j) => s.classList.toggle("on", j === index));
  const section = slides[index].querySelector("section");

  // Undo rotations so the upright layout can be measured; each op keeps its rotation chain.
  for (const el of section.querySelectorAll("*")) {
    const t = getComputedStyle(el).transform;
    const m = t && /^matrix\(([^)]+)\)/.exec(t);
    if (!m) continue;
    const [a, b] = m[1].split(",").map(Number);
    const deg = (Math.atan2(b, a) * 180) / Math.PI;
    if (Math.abs(deg) > 0.01) el.dataset.rot = String(deg);
  }
  for (const el of section.querySelectorAll("[data-rot]")) el.setAttribute("data-unrot", "");

  const S = section.getBoundingClientRect();
  const rel = (r) => ({ x: r.left - S.left, y: r.top - S.top, w: r.width, h: r.height });
  const ops = [];
  let capNo = 0;

  const color = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || "");
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    const a = p.length > 3 ? p[3] : 1;
    if (a <= 0.001) return null;
    const hex = p.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
    return { hex, a };
  };
  const family = (f) => (f || "").split(",")[0].trim().replace(/^["']|["']$/g, "");
  const ratios = {};
  const normalRatio = (fam, weight, style) => {
    const k = `${fam}|${weight}|${style}`;
    if (ratios[k]) return ratios[k];
    const d = document.createElement("div");
    d.style.cssText = `position:absolute;left:-5000px;top:0;font-family:"${fam}";font-size:100px;font-weight:${weight};font-style:${style};line-height:normal;white-space:nowrap`;
    d.textContent = "Hg";
    document.body.appendChild(d);
    const h = d.getBoundingClientRect().height;
    d.remove();
    return (ratios[k] = h / 100);
  };
  const chainOf = (el) => {
    const chain = [];
    for (let e = el; e && e !== section; e = e.parentElement) {
      if (e.dataset && e.dataset.rot !== undefined) {
        const cs = getComputedStyle(e);
        const [ox, oy] = cs.transformOrigin.split(" ").map(parseFloat);
        const r = e.getBoundingClientRect();
        chain.unshift({ deg: Number(e.dataset.rot), ox: r.left - S.left + ox, oy: r.top - S.top + oy });
      }
    }
    return chain;
  };
  const px = (v) => parseFloat(v) || 0;
  const sides = ["Top", "Right", "Bottom", "Left"];
  const REPLACED = new Set(["svg", "img", "iframe", "canvas", "video"]);
  const isInline = (cs, n) => (cs.display === "inline" || cs.display === "contents") && !(n && REPLACED.has(n.tagName.toLowerCase()));
  const skip = (el, cs) =>
    ["ASIDE", "SCRIPT", "STYLE", "TEMPLATE", "LINK", "META"].includes(el.tagName) || cs.display === "none" || cs.visibility === "hidden";
  const positioned = (el, cs) => cs.position !== "static" || el.dataset.rot !== undefined || parseFloat(cs.opacity) < 1;

  // Text runs of an element's inline content. <br> becomes a soft line break.
  const runsOf = (el) => {
    const out = [];
    const walk = (node) => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) {
          const p = n.parentElement;
          const cs = getComputedStyle(p);
          let t = n.data;
          if (!/^pre/.test(cs.whiteSpace)) t = t.replace(/[\t\n\r ]+/g, " ");
          if (cs.textTransform === "uppercase") t = t.toLocaleUpperCase(lang);
          else if (cs.textTransform === "lowercase") t = t.toLocaleLowerCase(lang);
          if (!t) continue;
          const a = p.closest("a");
          out.push({
            text: t,
            font: family(cs.fontFamily),
            size: px(cs.fontSize),
            weight: Number(cs.fontWeight) || 400,
            italic: cs.fontStyle === "italic",
            color: color(cs.color),
            underline: (cs.textDecorationLine || "").includes("underline"),
            ls: cs.letterSpacing === "normal" ? 0 : px(cs.letterSpacing),
            href: a && /^https?:/.test(a.getAttribute("href") || "") ? a.getAttribute("href") : "",
          });
        } else if (n.nodeType === 1) {
          const cs = getComputedStyle(n);
          if (skip(n, cs)) continue;
          if (n.tagName === "BR") out.push({ br: true });
          else if (isInline(cs, n)) walk(n);
        }
      }
    };
    walk(el);
    // CSS white-space collapsing across runs and at line edges.
    let prevSpace = true;
    for (const r of out) {
      if (r.br) { prevSpace = true; continue; }
      if (prevSpace) r.text = r.text.replace(/^ +/, "");
      if (r.text) prevSpace = r.text.endsWith(" ");
    }
    for (let i = out.length - 1, trail = true; i >= 0; i--) {
      const r = out[i];
      if (r.br) { trail = true; continue; }
      if (trail) r.text = r.text.replace(/ +$/, "");
      if (r.text) trail = false;
    }
    return out.filter((r) => r.br || r.text);
  };
  const hasInline = (el) =>
    [...el.childNodes].some((n) =>
      n.nodeType === 3 ? /\S/.test(n.data) : n.nodeType === 1 && n.tagName !== "ASIDE" && (n.tagName === "BR" || isInline(getComputedStyle(n), n)));
  // Line boxes of an element's text, from its client rects.
  const linesOf = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5).sort((a, b) => a.top - b.top);
    const lines = [];
    for (const r of rects) {
      const mid = r.top + r.height / 2;
      const l = lines.find((x) => Math.abs(x.mid - mid) < Math.min(x.h, r.height) / 2);
      if (l) { l.left = Math.min(l.left, r.left); l.right = Math.max(l.right, r.right); }
      else lines.push({ mid, h: r.height, top: r.top, left: r.left, right: r.right });
    }
    return lines;
  };
  // Where the first line's baseline sits: a zero-size inline-block probe at the start of the text.
  const baselineOf = (el) => {
    const probe = document.createElement("span");
    probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline;padding:0;margin:0;border:0";
    el.insertBefore(probe, el.firstChild);
    const y = probe.getBoundingClientRect().top - S.top;
    probe.remove();
    return y;
  };
  const paraStyle = (el, cs) => {
    const size = px(cs.fontSize);
    const fam = family(cs.fontFamily);
    const ratio = normalRatio(fam, cs.fontWeight, cs.fontStyle);
    const lh = cs.lineHeight === "normal" ? size * ratio : px(cs.lineHeight);
    let align = cs.textAlign;
    if (align === "start" || align === "-webkit-left") align = "left";
    if (align === "end" || align === "-webkit-right") align = "right";
    if (align === "-webkit-center") align = "center";
    return { size, font: fam, ratio, lh, align, nowrap: cs.whiteSpace === "nowrap" || cs.whiteSpace === "pre" };
  };

  const box = (el, cs, r, chain) => {
    const fill = color(cs.backgroundColor);
    const bw = sides.map((s) => (cs[`border${s}Style`] === "none" ? 0 : px(cs[`border${s}Width`])));
    const bc = sides.map((s) => color(cs[`border${s}Color`]));
    const rad = cs.borderTopLeftRadius;
    const ellipse = /%$/.test(rad) ? parseFloat(rad) >= 50 : false;
    const corner = (v) => (/%$/.test(v) ? (parseFloat(v) / 100) * Math.min(r.w, r.h) : px(v));
    const radius = corner(rad);
    const radii = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(corner);
    const shadows = [];
    if (cs.boxShadow && cs.boxShadow !== "none") {
      for (const part of cs.boxShadow.split(/,(?![^(]*\))/)) {
        const c = color(part);
        const nums = part.replace(/rgba?\([^)]*\)/, "").trim().split(/\s+/).filter((v) => /px$/.test(v)).map(parseFloat);
        if (!c || /inset/.test(part)) continue;
        shadows.push({ color: c, dx: nums[0] || 0, dy: nums[1] || 0, blur: nums[2] || 0, spread: nums[3] || 0 });
      }
    }
    const uniform = bw.every((w) => w === bw[0]) && bc.every((c) => JSON.stringify(c) === JSON.stringify(bc[0]));
    if (!fill && !shadows.length && !bw.some((w, i) => w > 0 && bc[i])) return;
    for (const s of shadows) {
      if (s.blur > 0) continue;
      ops.push({ kind: "rect", x: r.x + s.dx - s.spread, y: r.y + s.dy - s.spread, w: r.w + 2 * s.spread, h: r.h + 2 * s.spread,
        fill: s.color, radius: radius + s.spread, radii, ellipse, chain, name: "Shadow" });
    }
    const soft = shadows.find((s) => s.blur > 0) || null;
    if (uniform && bw[0] > 0 && bc[0]) {
      ops.push({ kind: "rect", ...r, fill, radius, radii, ellipse, border: { w: bw[0], color: bc[0] }, softShadow: soft, chain });
    } else {
      if (fill || soft) ops.push({ kind: "rect", ...r, fill, radius, radii, ellipse, softShadow: soft, chain });
      const [t, rt, b, l] = bw;
      if (t && bc[0]) ops.push({ kind: "rect", x: r.x, y: r.y, w: r.w, h: t, fill: bc[0], radius: 0, chain, name: "Border" });
      if (b && bc[2]) ops.push({ kind: "rect", x: r.x, y: r.y + r.h - b, w: r.w, h: b, fill: bc[2], radius: 0, chain, name: "Border" });
      if (l && bc[3]) ops.push({ kind: "rect", x: r.x, y: r.y, w: l, h: r.h, fill: bc[3], radius: 0, chain, name: "Border" });
      if (rt && bc[1]) ops.push({ kind: "rect", x: r.x + r.w - rt, y: r.y, w: rt, h: r.h, fill: bc[1], radius: 0, chain, name: "Border" });
    }
  };

  const textOp = (el, cs, r, chain) => {
    const runs = runsOf(el);
    if (!runs.some((x) => x.text)) return;
    const pad = sides.map((s) => px(cs[`padding${s}`]) + (cs[`border${s}Style`] === "none" ? 0 : px(cs[`border${s}Width`])));
    const content = { x: r.x + pad[3], y: r.y + pad[0], w: r.w - pad[1] - pad[3], h: r.h - pad[0] - pad[2] };
    const st = paraStyle(el, cs);
    const lines = linesOf(el);
    if (/flex|grid/.test(cs.display) && lines.length) {
      // Text inside a flex or grid box sits where the layout put it, not at the content top.
      const top = lines[0].top - S.top - (st.lh - lines[0].h) / 2;
      content.h = Math.min(content.h, st.lh * lines.length);
      content.y = top;
    }
    const maxW = lines.reduce((m, l) => Math.max(m, l.right - l.left), 0);
    ops.push({ kind: "text", ...content, base: baselineOf(el), chain, paras: [{ runs, ...st }], lines: lines.length, maxW, name: el.tagName.toLowerCase() });
  };

  const listOp = (el, cs, r, chain) => {
    const items = [...el.children].filter((li) => li.tagName === "LI");
    if (!items.length) return;
    const padL = px(cs.paddingLeft);
    const bl = cs.borderLeftStyle === "none" ? 0 : px(cs.borderLeftWidth);
    const top = r.y + px(cs.paddingTop) + (cs.borderTopStyle === "none" ? 0 : px(cs.borderTopWidth));
    let prevBottom = null;
    const paras = items.map((li) => {
      const lcs = getComputedStyle(li);
      const lr = rel(li.getBoundingClientRect());
      const p = { runs: runsOf(li), ...paraStyle(li, lcs), bullet: el.tagName === "OL" ? "number" : "disc", indent: padL,
        spaceBefore: prevBottom === null ? 0 : Math.max(0, lr.y - prevBottom) };
      prevBottom = lr.y + lr.h;
      return p;
    });
    const lines = items.reduce((n, li) => n + linesOf(li).length, 0);
    ops.push({ kind: "text", x: r.x + bl, y: top, w: r.w - bl - px(cs.paddingRight), h: r.h, base: baselineOf(items[0]), chain, paras, lines, maxW: 0, name: "list" });
  };

  const tableOp = (el, cs, r, chain) => {
    const rows = [...el.rows];
    const tableBorder = { w: cs.borderTopStyle === "none" ? 0 : px(cs.borderTopWidth), color: color(cs.borderTopColor) };
    const tableFill = color(cs.backgroundColor);
    const out = rows.map((tr, ri) => {
      const trcs = getComputedStyle(tr);
      const rowFill = color(trcs.backgroundColor) || tableFill;
      return [...tr.cells].map((td, ci) => {
        const tcs = getComputedStyle(td);
        const cr = rel(td.getBoundingClientRect());
        const fill = color(tcs.backgroundColor) || rowFill;
        const bottom = tcs.borderBottomStyle === "none" ? null : { w: px(tcs.borderBottomWidth), color: color(tcs.borderBottomColor) };
        return {
          runs: runsOf(td), ...paraStyle(td, tcs), fill, bottom,
          pad: sides.map((s) => px(tcs[`padding${s}`])),
          valign: tcs.verticalAlign === "middle" ? "middle" : tcs.verticalAlign === "bottom" ? "bottom" : "top",
          w: cr.w, h: cr.h, last: ri === rows.length - 1, lastCol: ci === tr.cells.length - 1,
        };
      });
    });
    ops.push({ kind: "table", ...r, chain, rows: out, rowH: rows.map((tr) => tr.getBoundingClientRect().height), border: tableBorder });
  };

  const paint = (el, cs) => {
    const tag = el.tagName.toLowerCase();
    const r = rel(el.getBoundingClientRect());
    if (r.w < 0.5 || r.h < 0.5) return false;
    const chain = chainOf(el);
    if (tag === "iframe") {
      let bg = null;
      for (let e = el.parentElement; e && !bg; e = e.parentElement) bg = color(getComputedStyle(e).backgroundColor);
      ops.push({ kind: "embed", ...r, chain, html: el.getAttribute("srcdoc") || "", bg: bg ? bg.hex : "FFFFFF", cap: String(++capNo) });
      el.dataset.cap = String(capNo);
      return false;
    }
    if (tag === "svg" || tag === "img" || tag === "canvas" || tag === "video") {
      box(el, cs, r, chain);
      el.dataset.cap = String(++capNo);
      ops.push({ kind: "picture", ...r, chain, cap: String(capNo), alt: el.getAttribute("aria-label") || el.getAttribute("alt") || el.dataset.icon || "" });
      return false;
    }
    if (el.dataset.shape) {
      ops.push({ kind: "shape", shape: el.dataset.shape, ...r, chain, fill: color(cs.backgroundColor) });
      return false;
    }
    if (tag === "table") { tableOp(el, cs, r, chain); return false; }
    box(el, cs, r, chain);
    if (tag === "ul" || tag === "ol") { listOp(el, cs, r, chain); return false; }
    if (hasInline(el)) { textOp(el, cs, r, chain); return "blocks"; }
    return true;
  };
  // Paint order: in-flow boxes in tree order, then positioned (or rotated) boxes in tree order.
  const visit = (el, deferred, blocksOnly) => {
    for (const c of el.children) {
      const cs = getComputedStyle(c);
      if (skip(c, cs)) continue;
      if (blocksOnly && isInline(cs, c)) continue;
      if (positioned(c, cs)) { deferred.push(c); continue; }
      const how = paint(c, cs);
      if (how) visit(c, deferred, how === "blocks");
    }
  };
  const layer = (el) => {
    const cs = getComputedStyle(el);
    const how = paint(el, cs);
    const deferred = [];
    if (how) visit(el, deferred, how === "blocks");
    for (const d of deferred) layer(d);
  };
  const deferred = [];
  visit(section, deferred, false);
  for (const d of deferred) layer(d);

  const bg = color(getComputedStyle(section).backgroundColor);
  const aside = section.querySelector(":scope > aside");
  return {
    id: section.id,
    bg: bg ? bg.hex : "FFFFFF",
    transition: section.dataset.transition || "",
    notes: aside ? aside.textContent.replace(/\s+/g, " ").trim() : "",
    ops,
  };
}

const order = deck.order.filter((id) => !only || only.includes(id));
const allSlides = await page.evaluate(() => [...document.querySelectorAll(".slide section")].map((s) => s.id));
const slides = [];
for (const id of order) {
  const index = allSlides.indexOf(id);
  const data = await page.evaluate(extractSlide, { index, lang });
  // Pictures: each drawn alone on a transparent page at 2x.
  for (const op of data.ops.filter((o) => o.kind === "picture" || (o.kind === "embed" && staticEmbeds))) {
    const sel = `[data-cap="${op.cap}"]`;
    const handle = await page.$(`.slide.on ${sel}`);
    const box = await handle.boundingBox();
    if (op.kind === "embed") {
      await page.waitForTimeout(1500);
      op.file = tmpFile("png");
      await page.screenshot({ path: op.file, clip: box });
      continue;
    }
    await page.evaluate((s) => { document.documentElement.classList.add("solo"); document.querySelector(`.slide.on ${s}`).classList.add("solo-on"); }, sel);
    op.file = tmpFile("png");
    await page.screenshot({ path: op.file, clip: box, omitBackground: true });
    await page.evaluate((s) => { document.documentElement.classList.remove("solo"); document.querySelector(`.slide.on ${s}`).classList.remove("solo-on"); }, sel);
  }
  if (shotsDir) {
    mkdirSync(shotsDir, { recursive: true });
    await page.evaluate(() => {
      document.querySelectorAll(".slide.on [data-unrot]").forEach((e) => e.removeAttribute("data-unrot"));
    });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(shotsDir, `${String(slides.length + 1).padStart(2, "0")}-${id}.png`), scale: "css" });
  }
  slides.push(data);
  console.log(`read ${id}: ${data.ops.length} parts`);
}

// 3. Live embeds become looping GIFs. Time runs on a fake clock, so frames are exact and repeat.
async function captureEmbed(op) {
  const w = Math.round(op.w), h = Math.round(op.h);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await p.addInitScript(() => {
    let seed = 7;
    Math.random = () => {
      if (window.__frozen) return 0.5;
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const si = window.setInterval;
    window.__intervals = [];
    window.setInterval = (fn, d, ...rest) => { window.__intervals.push(Number(d) || 0); return si(fn, d, ...rest); };
  });
  await p.goto("about:blank");
  const html = op.html.replace(/<head>/i, `<head><style>html{background:#${op.bg}!important}</style>`);
  await p.setContent(html, { waitUntil: "load" });
  await p.evaluate(() => { window.__frozen = true; return document.fonts.ready; });
  const dt = 100;
  // Endless CSS animations get periods that divide one loop length, so the GIF loops cleanly.
  const plan = await p.evaluate(() => {
    const inf = document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations === Infinity);
    const periods = inf.map((a) => { const t = a.effect.getComputedTiming(); return t.duration * (/alternate/.test(t.direction) ? 2 : 1); });
    return { periods, intervals: window.__intervals };
  });
  const tick = Math.max(0, ...plan.intervals);
  let loop = 0;
  if (plan.periods.length) {
    // Between 6 and 8 seconds: long enough to read, short enough to keep the file small.
    const want = Math.min(8000, Math.max(6000, Math.max(...plan.periods)));
    loop = tick ? Math.max(tick, Math.round(want / tick) * tick) : want;
    loop = Math.round(loop / dt) * dt;
  }
  const step = async (ms) => {
    await p.clock.runFor(ms);
    await p.evaluate(({ ms, loop }) => {
      for (const a of document.getAnimations()) {
        if (a.__t === undefined) {
          a.__t = 0;
          a.pause();
          const t = a.effect && a.effect.getComputedTiming();
          if (loop && t && t.iterations === Infinity && t.duration > 0) {
            const per = t.duration * (/alternate/.test(t.direction) ? 2 : 1);
            const k = Math.max(1, Math.round(loop / per));
            a.effect.updateTiming({ duration: loop / k / (/alternate/.test(t.direction) ? 2 : 1) });
          }
        } else a.__t += ms;
        a.currentTime = a.__t;
      }
    }, { ms, loop });
  };
  const warm = Math.max(2000, tick);
  for (let t = 0; t < warm; t += dt) await step(dt);
  const span = loop || 12000;
  const frames = [];
  for (let t = 0; t < span * 2; t += dt) {
    await step(dt);
    frames.push(await p.screenshot({ type: "png" }));
  }
  await ctx.close();
  const hashes = frames.map((b) => createHash("sha1").update(b).digest("hex"));
  if (new Set(hashes).size === 1) {
    op.file = tmpFile("png");
    writeFileSync(op.file, frames[0]);
    return "still";
  }
  // The smallest period that holds from some point on (the first cycle may still be settling).
  let period = 0, start = 0;
  for (let q = 2; q <= hashes.length / 2 && !period; q++) {
    let from = hashes.length - q - 1;
    while (from >= 0 && hashes[from] === hashes[from + q]) from--;
    if (from + 1 <= q && hashes.length - (from + 1) >= 2 * q) { period = q; start = from + 1; }
  }
  if (process.env.DEBUG_EMBED) console.log(hashes.map((h) => h.slice(0, 4)).join(" "));
  // No exact repeat (a counter, say): cut at a whole number of cycles so the jump is small.
  const cycle = loop || tick;
  const cut = cycle ? Math.max(1, Math.floor(Math.min(12000, Math.max(6000, cycle * 3)) / cycle)) * cycle : 8000;
  const take = period || Math.min(frames.length - start, Math.round(cut / dt));
  // Start the loop on its longest resting frame: that is the picture a PDF, print or thumbnail shows.
  const win = frames.slice(start, start + take), wh = hashes.slice(start, start + take);
  let rest = 0, best = 0;
  for (let i = 0, run = 1; i < wh.length; i++) {
    run = i > 0 && wh[i] === wh[i - 1] ? run + 1 : 1;
    if (run > best) { best = run; rest = i - run + 1; }
  }
  const seq = best > 1 ? [...win.slice(rest), ...win.slice(0, rest)] : win;
  const fdir = mkdtempSync(path.join(tmp, "gif-"));
  seq.forEach((b, i) => writeFileSync(path.join(fdir, `f${String(i).padStart(4, "0")}.png`), b));
  op.file = tmpFile("gif");
  const encode = (scale) => {
    const sc = scale < 1 ? `scale=${Math.round(w * scale / 2) * 2}:-2:flags=lanczos,` : "";
    const ff = spawnSync("ffmpeg", [
      "-loglevel", "error", "-y", "-framerate", String(1000 / dt), "-i", path.join(fdir, "f%04d.png"),
      "-filter_complex", `[0:v]${sc}split[a][b];[a]palettegen=max_colors=255:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`,
      "-loop", "0", op.file,
    ], { encoding: "utf8" });
    if (ff.status !== 0) throw new Error(`ffmpeg failed: ${ff.stderr || ff.error}`);
    return readFileSync(op.file).length;
  };
  // Keep each GIF near 3 MB: a busy loop is drawn smaller and stretched back to its place.
  const budget = 3 * 1024 * 1024;
  let size = encode(1), scale = 1;
  if (size > budget) { scale = Math.max(0.6, Math.sqrt(budget / size) * 0.95); size = encode(scale); }
  return `${take} frames, ${(size / 1048576).toFixed(1)} MB${scale < 1 ? ` at ${Math.round(scale * 100)}%` : ""}${period ? "" : " (no exact repeat, cut)"}`;
}
if (!staticEmbeds) {
  for (const s of slides) {
    for (const op of s.ops.filter((o) => o.kind === "embed")) {
      const how = await captureEmbed(op);
      console.log(`embed on ${s.id}: ${how}`);
    }
  }
}
await browser.close();

// 4. Write the .pptx.
const pres = new pptxgen();
pres.defineLayout({ name: "DECK1920", width: 1920 * PX, height: 1080 * PX });
pres.layout = "DECK1920";
pres.title = deck.title;
pres.author = "Eser Ergün";
pres.subject = Object.values(deck.sections ?? {})[0]?.description ?? "";
const faces = Object.values(deck.faces ?? {}).map((f) => f.family);
pres.theme = { headFontFace: faces[0] ?? "Arial", bodyFontFace: faces[1] ?? faces[0] ?? "Arial" };

const inch = (v) => Math.round(v * PX * 10000) / 10000;
const transparency = (c) => (c && c.a < 1 ? Math.round((1 - c.a) * 100) : 0);
function place(op, extra = {}) {
  const x0 = extra.x ?? op.x, y0 = extra.y ?? op.y, w = extra.w ?? op.w, h = extra.h ?? op.h;
  let cx = x0 + w / 2, cy = y0 + h / 2, rot = 0;
  for (let i = (op.chain?.length ?? 0) - 1; i >= 0; i--) {
    const t = op.chain[i];
    const a = (t.deg * Math.PI) / 180;
    const dx = cx - t.ox, dy = cy - t.oy;
    cx = t.ox + dx * Math.cos(a) - dy * Math.sin(a);
    cy = t.oy + dx * Math.sin(a) + dy * Math.cos(a);
    rot += t.deg;
  }
  const pos = { x: inch(cx - w / 2), y: inch(cy - h / 2), w: inch(w), h: inch(h) };
  rot = ((rot % 360) + 360) % 360;
  if (rot > 0.01) pos.rotate = Math.round(rot * 100) / 100;
  return pos;
}
// The weights each Google Font is loaded in; the browser draws the nearest one, so the deck does too.
const loaded = {};
for (const f of Object.values(deck.faces ?? {})) {
  const m = /[?&]family=[^:&]+(?::(?:ital,)?wght@([^&]+))?/.exec(f.href ?? "");
  const spec = m?.[1] ?? "400";
  loaded[f.family] = /\.\./.test(spec) ? { range: spec.split("..").map(Number) } : { list: spec.split(";").map((v) => Number(v.split(",").pop())) };
}
function weightOf(font, w) {
  const l = loaded[font];
  if (!l) return w;
  if (l.range) return Math.min(l.range[1], Math.max(l.range[0], w));
  return l.list.reduce((best, v) => (Math.abs(v - w) < Math.abs(best - w) || (Math.abs(v - w) === Math.abs(best - w) && v > best) ? v : best), l.list[0]);
}
const isBold = (font, wgt) => weightOf(font, wgt) >= 600;
function runOptions(r, para) {
  const o = { fontFace: r.font, fontSize: Math.round(r.size * PT * 2) / 2, bold: isBold(r.font, r.weight), italic: r.italic, lang };
  if (r.color) { o.color = r.color.hex; if (r.color.a < 1) o.transparency = transparency(r.color); }
  if (r.underline) o.underline = { style: "sng" };
  if (r.ls) o.charSpacing = Math.round(r.ls * PT * 10) / 10;
  if (r.href) o.hyperlink = { url: r.href };
  return o;
}
// Google Slides (and PowerPoint) lay text out as: single spacing = 1.2 x font size for every font;
// the first baseline sits 0.96 x size x min(spacing, 1) under the box top; extra spacing goes below.
// Measured on Google's own PDF export. So the CSS line height maps to lh / (1.2 x size).
const spacing = (p) => Math.round((p.lh / (1.2 * p.size)) * 1000) / 1000;
function textItems(op, single) {
  const items = [];
  op.paras.forEach((p, pi) => {
    const paraOpts = {
      align: p.align === "justify" ? "justify" : p.align,
      lineSpacingMultiple: single ? 1 : spacing(p),
    };
    if (p.bullet) {
      paraOpts.bullet = p.bullet === "number" ? { type: "number", indent: Math.round(p.indent * PT) } : { indent: Math.round(p.indent * PT) };
    }
    if (p.spaceBefore) paraOpts.paraSpaceBefore = Math.round(p.spaceBefore * PT * 10) / 10;
    let softNext = false;
    const runs = p.runs.filter((r) => r.br || r.text);
    runs.forEach((r, ri) => {
      if (r.br) { softNext = true; return; }
      const o = { ...runOptions(r, p), ...paraOpts };
      if (softNext && items.length) o.softBreakBefore = true;
      softNext = false;
      items.push({ text: r.text, options: o });
    });
    if (items.length && pi < op.paras.length - 1) items[items.length - 1].options.breakLine = true;
  });
  return items;
}

const SHAPE = { "arrow-right": "rightArrow", "arrow-left": "leftArrow", "arrow-up": "upArrow", "arrow-down": "downArrow", diamond: "diamond", ellipse: "ellipse" };
for (const s of slides) {
  const slide = pres.addSlide();
  slide.background = { color: s.bg };
  let n = 0;
  for (const op of s.ops) {
    n++;
    if (op.kind === "rect") {
      let { x, y, w, h } = op;
      let radius = op.radius || 0;
      const line = op.border ? { color: op.border.color.hex, width: op.border.w * PT, transparency: transparency(op.border.color) } : undefined;
      if (op.border) {
        // PowerPoint strokes on the outline's center; CSS borders sit inside the box.
        x += op.border.w / 2; y += op.border.w / 2; w -= op.border.w; h -= op.border.w;
        radius = Math.max(0, radius - op.border.w / 2);
      }
      radius = Math.min(radius, Math.min(w, h) / 2);
      const [tl, tr, br, bl] = (op.radii ?? [radius, radius, radius, radius]).map((v) => Math.max(0, v - (op.border ? op.border.w / 2 : 0)));
      const twoRadii = !op.ellipse && tl === tr && bl === br && Math.abs(tl - bl) > 0.5;
      let shape = op.ellipse ? pres.ShapeType.ellipse : radius > 0.5 ? pres.ShapeType.roundRect : pres.ShapeType.rect;
      let objectName = `${op.name ?? "Box"} ${n}`;
      if (twoRadii) {
        // Top corners one radius, bottom corners another (a door, a tab).
        const ss = Math.min(w, h);
        const adj = (v) => Math.round(Math.min(50000, (v / ss) * 100000));
        shape = "round2SameRect";
        objectName = `ADJ ${adj(tl)} ${adj(bl)} ${op.name ?? "Box"} ${n}`;
      }
      const opts = { ...place(op, { x, y, w, h }), objectName };
      opts.fill = op.fill ? { color: op.fill.hex, transparency: transparency(op.fill) } : { type: "none" };
      if (line) opts.line = line;
      if (shape === pres.ShapeType.roundRect) opts.rectRadius = radius * PX;
      if (op.softShadow) {
        const sh = op.softShadow;
        opts.shadow = { type: "outer", color: sh.color.hex, opacity: sh.color.a, blur: sh.blur * PT, offset: Math.hypot(sh.dx, sh.dy) * PT,
          angle: Math.round(((Math.atan2(sh.dy, sh.dx) * 180) / Math.PI + 360) % 360) };
      }
      slide.addShape(shape, opts);
    } else if (op.kind === "shape") {
      const kind = SHAPE[op.shape] ?? "rect";
      const opts = { ...place(op), fill: op.fill ? { color: op.fill.hex, transparency: transparency(op.fill) } : { type: "none" } };
      if (/Arrow$/.test(kind)) {
        const horiz = kind === "rightArrow" || kind === "leftArrow";
        const ss = Math.min(op.w, op.h);
        opts.objectName = `ADJ 40000 ${Math.round(((horiz ? op.w : op.h) * 0.4 * 100000) / ss)} Arrow ${n}`;
      } else opts.objectName = `Shape ${n}`;
      slide.addShape(kind, opts);
    } else if (op.kind === "text") {
      const p0 = op.paras[0];
      const single = op.lines <= 1 && op.paras.length === 1;
      let { x, y, w, h } = op;
      // Put the first baseline where the browser put it.
      const size0 = Math.max(p0.size, ...p0.runs.filter((r) => r.text).map((r) => r.size));
      const m0 = single ? 1 : spacing({ ...p0, size: size0 });
      if (Number.isFinite(op.base)) {
        y = op.base - 0.96 * size0 * Math.min(m0, 1);
        h = Math.max(h + (op.y - y), 1.2 * size0);
      }
      if (single) {
        // One line: leave room so it never wraps.
        const need = op.maxW + Math.max(16, op.maxW * 0.08);
        if (need > w) {
          const grow = need - w;
          if (p0.align === "center") x -= grow / 2;
          else if (p0.align === "right") x -= grow;
          w = need;
        }
      }
      const items = textItems(op, single);
      if (!items.length) continue;
      slide.addText(items, {
        ...place(op, { x, y, w, h }), margin: 0, valign: "top", isTextBox: true, fit: "none",
        wrap: true, objectName: `Text ${n}`,
      });
    } else if (op.kind === "table") {
      const colW = op.rows[0].map((c) => inch(c.w));
      const B = (b) => (b && b.w > 0 && b.color ? { type: "solid", pt: Math.round(b.w * PT * 100) / 100, color: b.color.hex } : { type: "none" });
      const rows = op.rows.map((row, ri) => row.map((c, ci) => {
        const blend = (b) => {
          if (!b || !b.color || b.color.a >= 1) return b;
          const base = c.fill ?? { hex: s.bg };
          const mix = [0, 2, 4].map((k) => {
            const fg = parseInt(b.color.hex.slice(k, k + 2), 16), bgc = parseInt(base.hex.slice(k, k + 2), 16);
            return Math.round(fg * b.color.a + bgc * (1 - b.color.a)).toString(16).padStart(2, "0");
          }).join("").toUpperCase();
          return { w: b.w, color: { hex: mix, a: 1 } };
        };
        const edge = op.border;
        const border = [
          ri === 0 ? B(edge) : B(blend(op.rows[ri - 1][ci]?.bottom)),
          ci === row.length - 1 ? B(edge) : { type: "none" },
          ri === op.rows.length - 1 ? B(edge) : B(blend(c.bottom)),
          ci === 0 ? B(edge) : { type: "none" },
        ];
        const text = c.runs.filter((r) => r.text).map((r) => ({ text: r.text, options: runOptions(r, c) }));
        return {
          text: text.length ? text : "",
          options: {
            fill: c.fill ? { color: c.fill.hex } : undefined, border, align: c.align, valign: c.valign,
            margin: c.pad.map((v) => Math.max(1, Math.round(v * PT * 10) / 10)),
            fontFace: c.font, fontSize: Math.round(c.size * PT * 2) / 2, lineSpacingMultiple: spacing(c),
          },
        };
      }));
      slide.addTable(rows, { ...place(op), colW, rowH: op.rowH.map((v) => inch(v)), autoPage: false, objectName: `Table ${n}` });
    } else if (op.kind === "picture" || op.kind === "embed") {
      if (!op.file) continue;
      slide.addImage({ path: op.file, ...place(op), altText: op.alt || (op.kind === "embed" ? "Animation" : ""), objectName: `${op.kind === "embed" ? "Animation" : "Picture"} ${n}` });
    }
  }
  if (s.notes) slide.addNotes(s.notes);
}

// 5. Things pptxgenjs cannot write: arrow head sizes and slide transitions.
const zip = await JSZip.loadAsync(await pres.write({ outputType: "nodebuffer" }));
const slideFiles = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
for (const f of slideFiles) {
  const idx = Number(/slide(\d+)\.xml$/.exec(f)[1]) - 1;
  let xml = await zip.file(f).async("string");
  xml = xml.replace(/<p:sp>(?:(?!<\/p:sp>)[\s\S])*?<\/p:sp>/g, (sp) => {
    const m = /name="ADJ (\d+) (\d+) ([^"]*)"/.exec(sp);
    if (!m) return sp;
    return sp
      .replace(/name="ADJ \d+ \d+ ([^"]*)"/, 'name="$1"')
      .replace(/<a:avLst\s*(?:\/>|><\/a:avLst>)/, `<a:avLst><a:gd name="adj1" fmla="val ${m[1]}"/><a:gd name="adj2" fmla="val ${m[2]}"/></a:avLst>`);
  });
  xml = xml.replace(/<a:ln><\/a:ln>/g, "<a:ln><a:noFill/></a:ln>");
  const t = slides[idx]?.transition;
  if (t && !xml.includes("<p:transition")) {
    const tr = t === "push" ? '<p:transition spd="med"><p:push dir="l"/></p:transition>' : '<p:transition spd="med"><p:fade/></p:transition>';
    xml = xml.includes("</p:clrMapOvr>") ? xml.replace("</p:clrMapOvr>", `</p:clrMapOvr>${tr}`) : xml.replace("</p:sld>", `${tr}</p:sld>`);
  }
  zip.file(f, xml);
}
// Google Slides draws every link in the theme's link color, so make that the deck's own link color.
const linkRun = slides.flatMap((s) => s.ops).flatMap((o) => (o.paras ?? []).flatMap((p) => p.runs)).find((r) => r.href && r.color);
if (linkRun) {
  const themes = Object.keys(zip.files).filter((f) => /^ppt\/theme\/theme\d+\.xml$/.test(f));
  for (const f of themes) {
    let xml = await zip.file(f).async("string");
    for (const tag of ["a:hlink", "a:folHlink"]) {
      xml = xml.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`), `<${tag}><a:srgbClr val="${linkRun.color.hex}"/></${tag}>`);
    }
    zip.file(f, xml);
  }
}
// Files only: folder entries in the ZIP make some cloud editors refuse the deck.
const clean = new JSZip();
for (const [file, entry] of Object.entries(zip.files)) {
  if (!entry.dir) clean.file(file, await entry.async("nodebuffer"), { createFolders: false });
}
writeFileSync(out, await clean.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }));
if (keep) console.log(`kept work files in ${tmp}`);
else rmSync(tmp, { recursive: true, force: true });
console.log(`wrote ${path.relative(process.cwd(), out)} (${slides.length} slides)`);
