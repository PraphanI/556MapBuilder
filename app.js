"use strict";
// World units are model millimetres (1:56), y up like Blender. Item x,y = footprint CENTRE, rot = degrees CCW.
// WEB = the Netlify copy: no server, no Blender. Maps save to / open from the user's own computer (see "web build" below).
const WEB = !!window.WEB || /[?&]web=1/.test(location.search);
const BUST = () => WEB ? "" : "?t=" + Date.now();
const $ = s => document.querySelector(s);
const cv = $("#cv"), ctx = cv.getContext("2d");
let LIB = null, DEF = {}, IMG = {}, PLAN = {};
let items = [], sel = null, uidN = 1, filePath = null, renderCfg = {};
let view = { ox: 400, oy: 500, z: 1.2 };
let undoS = [], redoS = [], dirty = false;
let ghost = null, drag = null, pan = null, spaceDown = false, tilesRev = 0;
// PRINT SCALE. The map is laid out in 28 mm units (that is what snapping and the saved layout use); every size SHOWN is multiplied by k.
// 32 mm: the long straight is built at 168 mm.  15 mm: the long straight is built at 90 mm.  Every other size is derived from the 28 mm design
// by the same ratio (as the catalogue cards do), so only the long straight exists as a model at 32 mm and 15 mm.
const SCALES = { "28": { name: "28 mm", tile: 160, k: 1 }, "32": { name: "32 mm", tile: 168, k: 168 / 160 }, "15": { name: "15 mm", tile: 90, k: 90 / 160 } };
let scaleId = "28";
const SK = () => SCALES[scaleId].k;
const sz = v => { const x = v * SK(); return Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : x.toFixed(1); };
function setScale(id, quiet) {
  scaleId = SCALES[id] ? id : "28"; $("#scaleSel").value = scaleId;
  if (typeof buildPalette === "function" && LIB) buildPalette();
  if (!quiet) { dirty = true; changed(); }
}
const TOL = 3.5;                                    // edge bands are read off 3 px/mm pictures
const OBJ_COL = { "Residential Building": "#e0b84a", "Commercial Building": "#4a9be0", "Public Structure": "#3fb8a5", "Stretch Goal": "#c0607a" };

// ---------------------------------------------------------------- library
async function loadLib() {
  LIB = await (await fetch("library.json" + BUST())).json();
  DEF = {}; IMG = {}; PLAN = {};
  for (const k in clsCache) delete clsCache[k];
  for (const d of [...LIB.tiles, ...LIB.objects]) {
    DEF[d.id] = d;
    if (d.img) { const im = new Image(); im.onload = draw; im.src = d.img + BUST(); IMG[d.id] = im; }
    if (d.plan) { const pm = new Image(); pm.src = d.plan + BUST(); PLAN[d.id] = pm; }      // road/footpath classes are read from the plan, not the picture
  }
}
async function init() {
  await loadLib();
  buildPalette();
  const qp = new URLSearchParams(location.search).get("open");              // ?open=<layout path> opens that layout instead of the saved draft
  if (WEB) { $("#bRender").hidden = true; $("#bRefresh").hidden = true; }
  if (qp && !WEB) { try { const o = await (await fetch("/api/open?path=" + encodeURIComponent(qp))).json(); if (!o.error) { load(o, qp); fit(); resize(); return; } } catch (e) {} }
  try { const s = localStorage.getItem("mb_draft"); if (s) { const o = JSON.parse(s); const wasDirty = !!o.dirty; load(o, o.filePath || null); dirty = wasDirty; fileLabel(); } } catch (e) {}
  fit(); resize();
  if (!WEB) try { const j = localStorage.getItem("mb_job"); if (j) watchJob(j, true); } catch (e) {}
}

let palTab = "tile";
function buildPalette() {
  const q = $("#q").value.toLowerCase(), core = $("#fCore").checked;
  const defs = (palTab === "tile" ? LIB.tiles : palTab === "prop" ? LIB.objects.filter(d => d.prop) : LIB.objects.filter(d => !d.prop)).filter(d =>
    (!q || (d.label + " " + d.sku + " " + (d.num || "")).toLowerCase().includes(q)) && (!core || d.set === "core"));
  const groups = {};
  defs.forEach(d => (groups[d.group] = groups[d.group] || []).push(d));
  const order = ["Street", "Offset street", "Median", "Roundabout", "Plain ground", "One-lane", "Alley", "Transition", "Parking", "Residential Building", "Commercial Building", "Public Structure", "Stretch Goal", "Bins", "Cabinets", "Guardrails", "Skip and stacks", "Crates and stacks", "Craters and debris"];
  const keys = Object.keys(groups).sort((a, b) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99);
  $("#list").innerHTML = keys.map(g => `<div class="grp">${g}</div>` + groups[g].map(d => {
    const badge = d.set === "stretch" ? `<span class="badge st">stretch</span>` : d.set === "core" ? `<span class="badge">core</span>` : "";
    const pic = d.img ? `<img src="${d.img}" draggable="false">` : `<img draggable="false" src="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><rect width="56" height="56" fill="#c7d3be"/></svg>')}">`;
    return `<div class="card" data-id="${d.id}">${pic}<div><div class="t">${d.num ? d.num + " · " : ""}${d.label}${badge}</div><div class="s">${sz(d.w)} × ${sz(d.l)} mm${d.h ? " × " + sz(d.h) : ""}</div></div></div>`;
  }).join("")).join("");
}
document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => {
  document.querySelectorAll(".tabs button").forEach(x => x.classList.toggle("on", x === b));
  palTab = b.dataset.t; $("#palNote").hidden = palTab !== "prop"; buildPalette();
});
$("#q").oninput = $("#fCore").onchange = buildPalette;
$("#list").addEventListener("pointerdown", e => {
  const c = e.target.closest(".card"); if (!c) return;
  drag = { def: DEF[c.dataset.id], fromPal: true }; e.preventDefault();
});

// ---------------------------------------------------------------- geometry
const rad = d => d * Math.PI / 180;
function rot2(x, y, deg) {
  const k = ((deg % 360) + 360) % 360; let c, s;
  if (k === 0) { c = 1; s = 0 } else if (k === 90) { c = 0; s = 1 } else if (k === 180) { c = -1; s = 0 } else if (k === 270) { c = 0; s = -1 }
  else { c = Math.cos(rad(k)); s = Math.sin(rad(k)); }
  return [x * c - y * s, x * s + y * c];
}
function tileEdges(it) {
  const d = DEF[it.id], hw = d.w / 2, hl = d.l / 2;
  const L = [["Y0", -hw, -hl, hw, -hl, 0, -1], ["Y1", -hw, hl, hw, hl, 0, 1], ["X0", -hw, -hl, -hw, hl, -1, 0], ["X1", hw, -hl, hw, hl, 1, 0]];
  return L.map(([k, ax, ay, bx, by, nx, ny]) => {
    const [a0, a1] = rot2(ax, ay, it.rot), [b0, b1] = rot2(bx, by, it.rot), [n0, n1] = rot2(nx, ny, it.rot);
    const horiz = Math.abs(b0 - a0) > Math.abs(b1 - a1);
    const P0 = horiz ? a0 : a1, P1 = horiz ? b0 : b1, fixed = (horiz ? a1 : a0) + (horiz ? it.y : it.x);
    const off = horiz ? it.x : it.y, up = P1 > P0;
    let t = P0 + off, iv = [];
    for (const [type, w] of d.edges[k]) { iv.push(up ? [t, t + w, type] : [t - w, t, type]); t += up ? w : -w; }
    iv.sort((p, q) => p[0] - q[0]);
    return { key: k, axis: horiz ? "x" : "y", fixed: Math.round(fixed * 100) / 100, n: Math.round(horiz ? n1 : n0),
             lo: iv[0][0], hi: iv[iv.length - 1][1], iv, it };
  });
}
// Two faces join when their ROAD lines up. Kerb, footpath and bare ground are all just "ground" to each other:
// a closed face (a roundabout's retaining kerb, a dead end) sits against a plain tile or a footpath without fault.
const typeAt = (e, t) => { for (const v of e.iv) if (t >= v[0] && t < v[1]) return v[2] === "road" ? "road" : "ground"; return null; };
const nearBound = (e, t) => e.iv.some(v => Math.abs(t - v[0]) < TOL || Math.abs(t - v[1]) < TOL);
function compare(a, b) {                              // -> {lo,hi,ok} or null
  if (a.axis !== b.axis || a.n !== -b.n || Math.abs(a.fixed - b.fixed) > 1) return null;
  const lo = Math.max(a.lo, b.lo), hi = Math.min(a.hi, b.hi);
  if (hi - lo < 1) return null;
  let ok = true;
  for (let t = lo + 0.5; t < hi; t += 1) {
    if (typeAt(a, t) !== typeAt(b, t) && !nearBound(a, t) && !nearBound(b, t)) { ok = false; break; }
  }
  return { lo, hi, ok };
}
function obb(it) {                                    // corners of a footprint, world
  const d = DEF[it.id], hw = d.w / 2, hl = d.l / 2;
  return [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]].map(([x, y]) => { const [a, b] = rot2(x, y, it.rot); return [a + it.x, b + it.y]; });
}
function satOverlap(A, B) {
  for (const P of [A, B]) for (let i = 0; i < 4; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % 4], nx = y2 - y1, ny = x1 - x2;
    const pr = Q => Q.map(([x, y]) => x * nx + y * ny), a = pr(A), b = pr(B), n = Math.hypot(nx, ny);
    const gap = Math.max(Math.min(...a) - Math.max(...b), Math.min(...b) - Math.max(...a)) / n;
    if (gap >= -1) return false;
  }
  return true;
}
function aabb(it) { const c = obb(it).map(p => p[0]), r = obb(it).map(p => p[1]); return [Math.min(...c), Math.min(...r), Math.max(...c), Math.max(...r)]; }

// class under a point of a tile: 'road' | 'kerb' | 'path' | 'plain'
const CLS = { road: [174, 182, 188], kerb: [90, 98, 105], path: [230, 224, 212], plain: [199, 211, 190], drain: [31, 111, 120] };
const clsCache = {};
function tileClass(d, lx, ly) {
  if (d.plain) return "plain";
  let g = clsCache[d.id];
  if (!g) {
    const im = PLAN[d.id]; if (!im || !im.complete || !im.naturalWidth) return "plain";
    const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
    const x = c.getContext("2d"); x.drawImage(im, 0, 0); g = clsCache[d.id] = { data: x.getImageData(0, 0, c.width, c.height).data, w: c.width };
  }
  const px = Math.min(g.w - 1, Math.max(0, Math.floor(lx * 3))), py = Math.min(d.l * 3 - 1, Math.max(0, Math.floor((d.l - ly) * 3)));
  const i = (py * g.w + px) * 4; let best = "plain", bd = 1e9;
  for (const k in CLS) { const c = CLS[k], dd = (g.data[i] - c[0]) ** 2 + (g.data[i + 1] - c[1]) ** 2 + (g.data[i + 2] - c[2]) ** 2; if (dd < bd) { bd = dd; best = k; } }
  return best === "drain" ? "road" : best;
}
const onRoadCache = new Map();
function onRoad(it) {
  const key = `${it.x}|${it.y}|${it.rot}|${tilesRev}`, hit = onRoadCache.get(it.uid);
  if (hit && hit.key === key) return hit.v;
  const d = DEF[it.id]; let nRoad = 0, nHard = 0;
  const tiles = items.filter(t => DEF[t.id].kind === "tile").map(t => ({ t, b: aabb(t) }));
  const st = d.prop ? 2 : 5;
  for (let u = -d.w / 2 + 1; u < d.w / 2; u += st) for (let v = -d.l / 2 + 1; v < d.l / 2; v += st) {
    const [rx, ry] = rot2(u, v, it.rot), wx = rx + it.x, wy = ry + it.y;
    for (const { t, b } of tiles) {
      if (wx < b[0] || wx > b[2] || wy < b[1] || wy > b[3]) continue;
      const td = DEF[t.id], [lx, ly] = rot2(wx - t.x, wy - t.y, -t.rot);
      const c = tileClass(td, lx + td.w / 2, ly + td.l / 2);
      if (c === "road") nRoad++; else if (c === "kerb" || c === "path") nHard++;
      break;
    }
  }
  // 2 = a building on the road surface (a fault, red); 1 = on the footpath or kerb, or a prop anywhere on the road (fine, yellow warning)
  const level = d.prop ? (nRoad + nHard >= 2 ? 1 : 0) : nRoad >= 2 ? 2 : nHard >= 2 ? 1 : 0;
  onRoadCache.set(it.uid, { key, v: level });
  return level;
}

// ---------------------------------------------------------------- analysis
function analyse(skip) {
  const tiles = items.filter(i => DEF[i.id].kind === "tile" && i !== skip);
  const E = tiles.map(tileEdges), joins = [], covered = new Map();
  for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++)
    for (const a of E[i]) for (const b of E[j]) {
      const c = compare(a, b); if (!c) continue;
      joins.push({ a, b, ...c });
      for (const e of [a, b]) { const l = covered.get(e) || []; l.push([c.lo, c.hi]); covered.set(e, l); }
    }
  const open = [];
  for (const es of E) for (const e of es) for (const v of e.iv) {
    if (v[2] !== "road") continue;
    const cov = covered.get(e) || [];
    if (!cov.some(([lo, hi]) => lo < v[1] - 1 && hi > v[0] + 1)) open.push({ e, v });
  }
  const over = new Set();
  for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
    const A = aabb(tiles[i]), B = aabb(tiles[j]);
    if (Math.min(A[2], B[2]) - Math.max(A[0], B[0]) > 2 && Math.min(A[3], B[3]) - Math.max(A[1], B[1]) > 2) { over.add(tiles[i]); over.add(tiles[j]); }
  }
  const objs = items.filter(i => DEF[i.id].kind === "object");
  for (let i = 0; i < objs.length; i++) for (let j = i + 1; j < objs.length; j++)
    if (satOverlap(obb(objs[i]), obb(objs[j]))) { over.add(objs[i]); over.add(objs[j]); }
  const road = new Set(objs.filter(o => onRoad(o) === 2)), foot = new Set(objs.filter(o => onRoad(o) === 1));
  return { joins, open, over, road, foot };
}
let A = analyse();

// ---------------------------------------------------------------- snapping
function snapTile(it, wx, wy, alt) {
  const base = { ...it, x: wx, y: wy };
  if (alt) return [wx, wy];
  const thr = Math.max(14, 28 / view.z), mine = tileEdges(base);
  let best = null;
  for (const o of items) {
    if (o === it || DEF[o.id].kind !== "tile") continue;
    for (const b of tileEdges(o)) for (const a of mine) {
      if (a.axis !== b.axis || a.n !== -b.n) continue;
      const dp = b.fixed - a.fixed;
      for (const [da, pen] of [[b.lo - a.lo, 0], [b.hi - a.hi, 0], [((b.lo + b.hi) - (a.lo + a.hi)) / 2, 0], [0, 8]]) {
        const dx = a.axis === "x" ? da : dp, dy = a.axis === "x" ? dp : da, dist = Math.hypot(dx, dy);
        if (dist > thr) continue;
        const moved = { ...it, x: wx + dx, y: wy + dy };
        if (pen && !tileEdges(moved).some(m => compare(m, b))) continue;
        const good = tileEdges(moved).some(m => { const c = compare(m, b); return c && c.ok; });
        const score = dist + pen + (good ? 0 : 12);
        if (!best || score < best.score) best = { score, x: moved.x, y: moved.y };
      }
    }
  }
  return best ? [Math.round(best.x * 100) / 100, Math.round(best.y * 100) / 100] : [Math.round(wx / 10) * 10, Math.round(wy / 10) * 10];
}
const snapObj = (x, y, alt, g = 5) => alt ? [x, y] : [Math.round(x / g) * g, Math.round(y / g) * g];

// ---------------------------------------------------------------- drawing
const toS = (x, y) => [view.ox + x * view.z, view.oy - y * view.z];
const toW = (sx, sy) => [(sx - view.ox) / view.z, (view.oy - sy) / view.z];
function drawItem(c, it, a, extra) {
  const d = DEF[it.id]; c.save(); c.translate(it.x, it.y); c.rotate(rad(it.rot));
  c.save(); c.scale(1, -1);
  if (d.kind === "tile") {
    if (!IMG[d.id]) { c.fillStyle = "rgb(199,211,190)"; c.fillRect(-d.w / 2, -d.l / 2, d.w, d.l); }
    else c.drawImage(IMG[d.id], -d.w / 2, -d.l / 2, d.w, d.l);
    c.strokeStyle = a.over.has(it) ? "#e5384f" : "rgba(0,0,0,.35)"; c.lineWidth = (a.over.has(it) ? 3 : 1) / view.z; c.strokeRect(-d.w / 2, -d.l / 2, d.w, d.l);
  } else {
    const col = d.prop ? "#7fb069" : OBJ_COL[d.group] || "#999", bad = a.over.has(it) || a.road.has(it), warn = !bad && a.foot.has(it);
    c.globalAlpha = extra && extra.ghost ? .7 : .93; c.fillStyle = col; c.fillRect(-d.w / 2, -d.l / 2, d.w, d.l); c.globalAlpha = 1;
    c.strokeStyle = bad ? "#e5384f" : warn ? "#e0a800" : "rgba(0,0,0,.6)"; c.lineWidth = (bad || warn ? 3 : 1.5) / view.z; c.strokeRect(-d.w / 2, -d.l / 2, d.w, d.l);
    c.fillStyle = "rgba(0,0,0,.55)"; c.beginPath(); c.moveTo(-8, -d.l / 2); c.lineTo(8, -d.l / 2); c.lineTo(0, -d.l / 2 + 12); c.fill();   // model front (-Y)
  }
  c.restore();
  if (d.kind === "object") {
    if (d.w * view.z < 20) { c.restore(); return; }                  // too small on screen to carry a label
    c.rotate(-rad(it.rot)); c.scale(1, -1);
    c.fillStyle = "#111"; c.textAlign = "center";
    const fits = (txt) => c.measureText(txt).width * view.z < d.w * view.z - 6 && c.measureText(txt).width * view.z < d.l * view.z * 3;   // only words that fit inside the box
    c.font = `600 ${Math.max(9, 11 / view.z * 1.15)}px system-ui`;
    const showNum = fits(d.num);
    if (showNum) c.fillText(d.num, 0, -2 / view.z);
    c.font = `${Math.max(8, 9.5 / view.z * 1.1)}px system-ui`;
    if (fits(d.label) && d.l * view.z > 26) c.fillText(d.label, 0, (showNum ? 11 : 3) / view.z);
  }
  c.restore();
}
function render(c, W, H, v, opt = {}) {
  const k = opt.dpr || 1; c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = getComputedStyle(document.body).backgroundColor; if (opt.bg) c.fillStyle = opt.bg; c.fillRect(0, 0, W * k, H * k);
  c.setTransform(v.z * k, 0, 0, -v.z * k, v.ox * k, v.oy * k);
  if (!opt.plain) {
    const [x0, y0] = [(0 - v.ox) / v.z, (v.oy - H) / v.z], [x1, y1] = [(W - v.ox) / v.z, (v.oy) / v.z];
    c.lineWidth = 1 / v.z;
    for (let g = Math.floor(x0 / 80) * 80; g < x1; g += 80) { c.strokeStyle = g % 160 ? "rgba(128,128,140,.12)" : "rgba(128,128,140,.25)"; c.beginPath(); c.moveTo(g, y0); c.lineTo(g, y1); c.stroke(); }
    for (let g = Math.floor(y0 / 80) * 80; g < y1; g += 80) { c.strokeStyle = g % 160 ? "rgba(128,128,140,.12)" : "rgba(128,128,140,.25)"; c.beginPath(); c.moveTo(x0, g); c.lineTo(x1, g); c.stroke(); }
  }
  const all = ghost && ghost.item ? [...items, ghost.item] : items;
  const ana = ghost && ghost.item ? A : A;
  for (const it of all) if (DEF[it.id].kind === "tile") drawItem(c, it, ana, { ghost: it === (ghost && ghost.item) });
  if (!opt.plain) {
    const showOk = $("#showJoins").checked;               // good joins are hidden by default now that the tiles are pictures
    for (const j of A.joins) {
      if (j.ok && !showOk) continue;
      c.strokeStyle = j.ok ? "#1a9d55" : "#e5384f"; c.lineWidth = (j.ok ? 3 : 5) / v.z; c.beginPath();
      if (j.a.axis === "x") { c.moveTo(j.lo, j.a.fixed); c.lineTo(j.hi, j.a.fixed); } else { c.moveTo(j.a.fixed, j.lo); c.lineTo(j.a.fixed, j.hi); }
      c.stroke();
    }
    c.strokeStyle = "#e69a00"; c.lineWidth = 4 / v.z; c.setLineDash([6 / v.z, 4 / v.z]);
    for (const { e, v: iv } of A.open) { c.beginPath(); if (e.axis === "x") { c.moveTo(iv[0], e.fixed); c.lineTo(iv[1], e.fixed); } else { c.moveTo(e.fixed, iv[0]); c.lineTo(e.fixed, iv[1]); } c.stroke(); }
    c.setLineDash([]);
  }
  for (const it of all) if (DEF[it.id].kind === "object") drawItem(c, it, A, { ghost: it === (ghost && ghost.item) });
  if (!opt.plain && sel) {
    const d = DEF[sel.id]; c.save(); c.translate(sel.x, sel.y); c.rotate(rad(sel.rot)); c.strokeStyle = "#6c4cff"; c.lineWidth = 3 / v.z; c.setLineDash([8 / v.z, 5 / v.z]);
    c.strokeRect(-d.w / 2 - 3, -d.l / 2 - 3, d.w + 6, d.l + 6); c.restore();
  }
}
function draw() { render(ctx, cv.width / devicePixelRatio, cv.height / devicePixelRatio, view, { dpr: devicePixelRatio }); }
function resize() {
  const r = cv.getBoundingClientRect(); cv.width = r.width * devicePixelRatio; cv.height = r.height * devicePixelRatio;
  draw();
}
addEventListener("resize", resize);

function fit(W, H, v) {
  const r = cv.getBoundingClientRect(); W = W || r.width; H = H || r.height;
  if (!items.length) { view = { ox: W / 2 - 320, oy: H / 2 + 200, z: 1.2 }; return view; }
  const bs = items.map(aabb), x0 = Math.min(...bs.map(b => b[0])), y0 = Math.min(...bs.map(b => b[1])), x1 = Math.max(...bs.map(b => b[2])), y1 = Math.max(...bs.map(b => b[3]));
  const z = Math.min((W - 80) / (x1 - x0), (H - 80) / (y1 - y0), 3);
  const nv = { z, ox: W / 2 - (x0 + x1) / 2 * z, oy: H / 2 + (y0 + y1) / 2 * z };
  if (!v) { view = nv; draw(); }
  return nv;
}

// ---------------------------------------------------------------- state
function snapshot() { return JSON.stringify(items.map(({ uid, id, x, y, rot }) => ({ uid, id, x, y, rot }))); }
function commit() {
  undoS.push(lastSnap); redoS = []; lastSnap = snapshot(); changed();
}
let lastSnap = "[]";
function changed() {
  tilesRev++; A = analyse(); dirty = true; updateUI(); draw();
  try { localStorage.setItem("mb_draft", JSON.stringify({ ...serialise(), filePath, dirty })); } catch (e) {}
  fileLabel();
}
function restore(s) { items = JSON.parse(s); sel = null; lastSnap = s; changed(); }
$("#bUndo").onclick = () => { if (undoS.length) { redoS.push(lastSnap); restore(undoS.pop()); } };
$("#bRedo").onclick = () => { if (redoS.length) { undoS.push(lastSnap); restore(redoS.pop()); } };
$("#bFit").onclick = () => fit();
// Turn the whole map 90 degrees about the middle of what is on it. Every position and every item's rotation moves together,
// so joins are untouched; the centre is rounded to the 10 mm grid so everything stays on it.
function rotateMap(dir) {
  if (!items.length) return;
  const bs = items.map(aabb), cx = Math.round((Math.min(...bs.map(b => b[0])) + Math.max(...bs.map(b => b[2]))) / 20) * 10,
    cy = Math.round((Math.min(...bs.map(b => b[1])) + Math.max(...bs.map(b => b[3]))) / 20) * 10;
  for (const it of items) {
    const dx = it.x - cx, dy = it.y - cy;
    it.x = Math.round((cx - dir * dy) * 100) / 100; it.y = Math.round((cy + dir * dx) * 100) / 100;
    it.rot = ((it.rot + dir * 90) % 360 + 360) % 360;
  }
  commit(); fit();
}
$("#bRotL").onclick = () => rotateMap(1);
$("#bRotR").onclick = () => rotateMap(-1);
$("#bNew").onclick = () => { if (!dirty || !items.length || confirm("Discard the unsaved changes and start a new map?")) { items = []; sel = null; undoS = []; redoS = []; lastSnap = "[]"; filePath = null; renderCfg = {}; $("#name").value = "Untitled layout"; $("#notes").value = ""; changed(); dirty = false; fileLabel(); fit(); } };

function serialise() {
  return { name: $("#name").value, notes: $("#notes").value, unit: "mm at 1:56, y up, x,y = footprint centre, rot = degrees CCW", view,
    render: renderCfg, scale: scaleId,
    items: items.map(i => { const d = DEF[i.id]; return { uid: i.uid, id: i.id, kind: d.kind, ...(d.kind === "tile" ? { sku: d.sku } : { num: d.num, label: d.label }), x: i.x, y: i.y, rot: i.rot, w: d.w, l: d.l }; }) };
}
function load(o, path) {
  const LG = (LIB && LIB.legacy) || {};
  items = (o.items || []).map(i => ({ ...i, id: LG[i.id] || i.id })).filter(i => DEF[i.id]).map(i => ({ uid: i.uid || uidN++, id: i.id, x: i.x, y: i.y, rot: i.rot }));
  const lost = (o.items || []).length - items.length;
  uidN = Math.max(uidN, ...items.map(i => i.uid + 1), 1); sel = null; undoS = []; redoS = []; lastSnap = snapshot();
  filePath = path || null; renderCfg = o.render || {}; setScale(o.scale || "28", true);
  $("#name").value = o.name || "Untitled layout"; $("#notes").value = o.notes || ""; changed(); dirty = false; fileLabel(); updateUI(); fit();
  if (lost) flash(lost + " item(s) skipped: no longer in the library");
}
function fileLabel() {
  const l = $("#fileLbl"); l.textContent = filePath ? filePath.split("\\").pop() : "not saved yet"; l.title = filePath || "Not saved yet: Save will ask where";
}
function thumb(w = 640) {
  const c = document.createElement("canvas"); const h = Math.round(w * .625); c.width = w; c.height = h;
  const v = fit(w, h, true); render(c.getContext("2d"), w, h, v, { plain: true, bg: "#f2f3f7" }); return c.toDataURL("image/png");
}
const post = (u, b) => fetch(u, { method: "POST", body: JSON.stringify(b) }).then(r => r.json());
async function writeTo(path) {
  const r = await post("/api/save", { path, data: serialise(), thumb: thumb() });
  filePath = r.path; dirty = false; fileLabel();
  try { localStorage.setItem("mb_draft", JSON.stringify({ ...serialise(), filePath, dirty })); } catch (e) {}
  updateUI(); return r.path;
}
async function saveAs() {
  if (WEB) return webSave(true);
  const stem = ($("#name").value.trim() || "Untitled layout").replace(/[\\/:*?"<>|]/g, "_");
  const r = await post("/api/pick", { kind: "save", file: stem + ".json" });
  if (!r.path) return false;
  $("#name").value = r.path.split("\\").pop().replace(/\.json$/i, "");
  await writeTo(r.path); flash("Saved " + r.path); return true;
}
async function save(quiet) {
  if (WEB) return webSave(false, quiet);
  if (!filePath) return saveAs();               // the first save asks where
  await writeTo(filePath); if (!quiet) flash("Saved"); return true;
}
function flash(t) { const s = $("#status"); s.textContent = t; setTimeout(updateUI, 1800); }
$("#bSave").onclick = () => save();
$("#bSaveAs").onclick = () => saveAs();
$("#bPng").onclick = () => {
  const a = document.createElement("a"); const c = document.createElement("canvas"); c.width = 2400; c.height = 1500;
  render(c.getContext("2d"), 2400, 1500, fit(2400, 1500, true), { plain: true, bg: "#f2f3f7" }); a.href = c.toDataURL("image/png"); a.download = ($("#name").value || "layout") + ".png"; a.click();
};
async function openList() {
  if (WEB) return webOpenList();
  const R = await (await fetch("/api/recent")).json();
  $("#saved").innerHTML = `<p><button id="bBrowse">Browse for a layout…</button></p>` + (R.recent.length ? R.recent.map(l => `<div class="row"><img src="${l.thumb ? "/api/thumb?path=" + encodeURIComponent(l.path) + "&t=" + Date.now() : ""}"><div class="n"><b>${l.name}</b><br><span class="mut">${l.items} items · ${l.saved}<br>${l.path}</span></div><button data-o="${l.path}">Open</button><button data-f="${l.path}" title="Remove from this list (the file stays)">✕</button></div>`).join("") : "<p class=mut>No recent layouts.</p>");
}
async function openPath(p) {
  if (dirty && items.length && !confirm("Discard the unsaved changes?")) return;
  if (WEB) return webOpenPath(p);
  const d = await (await fetch("/api/open?path=" + encodeURIComponent(p))).json();
  if (d.error) return alert(d.error);
  load(d, p); $("#dOpen").close();
}
$("#bOpen").onclick = async () => { await openList(); $("#dOpen").showModal(); };
$("#saved").onclick = async e => {
  if (WEB) return webSavedClick(e);
  if (e.target.id === "bBrowse") { const r = await post("/api/pick", { kind: "open" }); if (r.path) openPath(r.path); }
  if (e.target.dataset.o) openPath(e.target.dataset.o);
  if (e.target.dataset.f) { await post("/api/forget", { path: e.target.dataset.f }); openList(); }
};

// ---------------------------------------------------------------- web build: save to / open from the user's own computer
// Chrome and Edge can pick a file and save back into it; other browsers download a .json and open one with a file chooser.
// The last 8 maps are also kept in this browser (a list for quick re-opening), and Showcase ships with the site.
let webHandle = null;
const JSON_TYPES = [{ description: "Map Builder layout", accept: { "application/json": [".json"] } }];
const webStem = () => ($("#name").value.trim() || "Untitled layout").replace(/[\\/:*?"<>|]/g, "_");
function webDownload(name, text, type) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: type || "application/json" })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const webRecents = () => { try { return JSON.parse(localStorage.getItem("mb_recent") || "[]"); } catch (e) { return []; } };
function webRemember(data, name) {
  let r = webRecents().filter(x => x.name !== name);
  r.unshift({ id: "r" + Date.now(), name, items: data.items.length, saved: new Date().toLocaleString(), thumb: thumb(240), data });
  while (r.length) { try { localStorage.setItem("mb_recent", JSON.stringify(r.slice(0, 8))); return; } catch (e) { r.pop(); } }
}
async function webSave(ask, quiet) {
  const data = serialise(), text = JSON.stringify(data, null, 1);
  let name = webStem() + ".json";
  if (window.showSaveFilePicker) {
    try {
      if (ask || !webHandle) webHandle = await showSaveFilePicker({ suggestedName: name, types: JSON_TYPES });
      const w = await webHandle.createWritable(); await w.write(text); await w.close(); name = webHandle.name;
    } catch (e) { if (e && e.name === "AbortError") return false; webHandle = null; webDownload(name, text); }
  } else webDownload(name, text);
  filePath = name; $("#name").value = name.replace(/\.json$/i, ""); dirty = false; fileLabel();
  try { localStorage.setItem("mb_draft", JSON.stringify({ ...serialise(), filePath, dirty })); } catch (e) {}
  webRemember(serialise(), name); updateUI();
  if (!quiet) flash(window.showSaveFilePicker && webHandle ? "Saved " + name : "Downloaded " + name + " (keep it to open the map again)");
  return true;
}
function webOpenList() {
  const rec = webRecents();
  $("#saved").innerHTML = `<p><button id="bBrowse">Open a file from this computer…</button></p>` +
    `<div class="row"><div class="n"><b>Showcase</b><br><span class="mut">Example map, ready to look at</span></div><button data-o="ex:Showcase">Open</button></div>` +
    (rec.length ? rec.map(l => `<div class="row"><img src="${l.thumb || ""}"><div class="n"><b>${l.name}</b><br><span class="mut">${l.items} items · ${l.saved}<br>kept in this browser</span></div><button data-o="mb:${l.id}">Open</button><button data-f="${l.id}" title="Remove from this list (your file stays)">✕</button></div>`).join("") : "<p class=mut>Maps you save appear here.</p>");
}
async function webOpenPath(p) {
  let d, name;
  if (p.startsWith("ex:")) { name = p.slice(3) + ".json"; d = await (await fetch("examples/" + name)).json(); webHandle = null; }
  else { const r = webRecents().find(x => "mb:" + x.id === p); if (!r) return; d = r.data; name = r.name; webHandle = null; }
  load(d, name); $("#dOpen").close();
}
async function webSavedClick(e) {
  if (e.target.id === "bBrowse") {
    if (dirty && items.length && !confirm("Discard the unsaved changes?")) return;
    let text, name;
    if (window.showOpenFilePicker) {
      try { const [h] = await showOpenFilePicker({ types: JSON_TYPES }); const f = await h.getFile(); text = await f.text(); name = f.name; webHandle = h; } catch (x) { return; }
    } else {
      const f = await new Promise(res => { const i = document.createElement("input"); i.type = "file"; i.accept = ".json,application/json"; i.onchange = () => res(i.files[0]); i.click(); });
      if (!f) return; text = await f.text(); name = f.name; webHandle = null;
    }
    try { load(JSON.parse(text), name); $("#dOpen").close(); } catch (x) { alert("That file is not a Map Builder layout."); }
  }
  if (e.target.dataset.o) openPath(e.target.dataset.o);
  if (e.target.dataset.f) { localStorage.setItem("mb_recent", JSON.stringify(webRecents().filter(x => x.id !== e.target.dataset.f))); webOpenList(); }
}

// ---------------------------------------------------------------- render
const RATIO = () => $("#rRatio").value === "custom" ? [Math.max(1, +$("#rA").value || 1), Math.max(1, +$("#rB").value || 1)] : $("#rRatio").value.split(":").map(Number);
function renderSize() {
  const [a, b] = RATIO(), L = +$("#rLong").value, ev = n => Math.max(2, Math.round(n / 2) * 2);
  return a >= b ? [ev(L), ev(L * b / a)] : [ev(L * a / b), ev(L)];
}
function sizeLabel() { const [w, h] = renderSize(); $("#rSize").textContent = `${w} × ${h} px`; $("#rCust").hidden = $("#rRatio").value !== "custom"; }
["#rRatio", "#rLong", "#rA", "#rB"].forEach(q => { $(q).oninput = sizeLabel; });
const stemOf = () => (filePath ? filePath.split("\\").pop().replace(/\.json$/i, "") : "layout");
function defaultFile() { return `${stemOf()}_${$("#rStyle").value}_${$("#rCam").value}`; }
$("#rStyle").onchange = $("#rCam").onchange = () => { if (!$("#rFile").dataset.edited) $("#rFile").value = defaultFile(); };
$("#rFile").oninput = () => { $("#rFile").dataset.edited = "1"; };
$("#bRender").onclick = async () => {
  if (!items.length) return alert("The map is empty.");
  if (!filePath || dirty) { if (!(await save(true))) return; }      // the render builds from the saved file
  const R = await (await fetch("/api/recent")).json(), c = renderCfg || {};
  $("#rCam").value = c.camera || "diamond"; $("#rTurn").value = c.turn || "0"; $("#rStyle").value = c.style || "painted";
  $("#rRatio").value = c.ratio || "16:9"; $("#rLong").value = c.long || "1920"; $("#rA").value = c.a || 16; $("#rB").value = c.b || 9;
  $("#rQ").value = c.samples || "256"; $("#rDir").value = c.folder || R.render_dir;
  $("#rFile").dataset.edited = ""; $("#rFile").value = defaultFile(); sizeLabel();
  $("#dRender").showModal();
};
$("#rBrowse").onclick = async () => { const r = await post("/api/pick", { kind: "folder", dir: $("#rDir").value, title: "Save renders to" }); if (r.path) $("#rDir").value = r.path; };
$("#rGo").onclick = async e => {
  const [w, h] = renderSize();
  renderCfg = { camera: $("#rCam").value, turn: $("#rTurn").value, style: $("#rStyle").value, ratio: $("#rRatio").value, long: $("#rLong").value, a: $("#rA").value, b: $("#rB").value, samples: $("#rQ").value, folder: $("#rDir").value.trim() };
  await writeTo(filePath);                                           // keeps the chosen settings with the layout
  const r = await post("/api/render", { layout: filePath, settings: { ...renderCfg, width: w, height: h, samples: +renderCfg.samples, filename: $("#rFile").value.trim() || defaultFile() } });
  if (r.error) return alert(r.error);
  try { localStorage.setItem("mb_job", r.id); } catch (e) {}
  watchJob(r.id);
};
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
function watchJob(id) {
  const box = $("#job"); box.hidden = false;
  const STG = { build: "1 Build scene", paint: "2 Paint roads", render: "3 Render" };
  const timer = setInterval(async () => {
    let j; try { j = await (await fetch("/api/job?id=" + id)).json(); } catch (e) { return; }
    if (j.error) { clearInterval(timer); box.hidden = true; try { localStorage.removeItem("mb_job"); } catch (e) {} return; }
    $("#jTitle").textContent = j.state === "running" ? (j.layout ? "Rendering" : "Rendering tile pictures") : j.state === "done" ? "Render finished" : j.state === "cancelled" ? "Render cancelled" : "Render failed";
    $("#jBar").style.width = j.pct + "%"; $("#jBar").style.background = j.state === "error" ? "var(--bad)" : "";
    $("#jText").innerHTML = `${Object.entries(STG).map(([k, v]) => k === j.stage && j.state === "running" ? `<b>${v}</b>` : v).join(" · ")}<br>${j.text} · ${Math.round(j.pct)}% · ${mmss(j.elapsed)}` +
      (j.state === "error" ? `<br><span class="bad">${j.log.slice(-3).join("<br>")}</span>` : j.state === "done" ? `<br>${j.output}` : "");
    const btn = [];
    if (j.state === "running") btn.push(`<button data-c="cancel">Cancel</button>`);
    else { if (j.state === "done") btn.push(`<button class="primary" data-c="img">Open image</button><button data-c="dir">Show in folder</button>`); btn.push(`<button data-c="close">Close</button>`); clearInterval(timer); try { localStorage.removeItem("mb_job"); } catch (e) {} if (j.state === "done" && !j.output) { await loadLib(); buildPalette(); draw(); } }
    $("#jBtns").innerHTML = btn.join("");
    $("#jBtns").onclick = ev => {
      const c = ev.target.dataset.c;
      if (c === "cancel") post("/api/cancel", { id });
      if (c === "img") post("/api/reveal", { path: j.output });
      if (c === "dir") post("/api/reveal", { path: j.output, select: true });
      if (c === "close") box.hidden = true;
    };
  }, 800);
}

// ---------------------------------------------------------------- library refresh
$("#bRefresh").onclick = () => { $("#rfOut").textContent = ""; $("#rfGo").disabled = false; $("#dRefresh").showModal(); };
$("#rfGo").onclick = async e => {
  e.preventDefault(); $("#rfGo").disabled = true; $("#rfOut").textContent = "Reading the atlas and catalogue…";
  const r = await post("/api/refresh", { atlas: $("#rfAtlas").checked, pictures: $("#rfPics").checked });
  if (r.error) { $("#rfOut").innerHTML = `<span class="bad">${r.error}</span><br>${(r.log || "").slice(-600)}`; $("#rfGo").disabled = false; return; }
  await loadLib();
  const gone = items.filter(i => !DEF[i.id]); items = items.filter(i => DEF[i.id]); sel = null; changed(); buildPalette();
  const S = r.summary, li = (t, a) => a && a.length ? `<br><b>${t}:</b> ${a.join(", ")}` : "";
  $("#rfOut").innerHTML = `${S.tiles} tiles and ${S.objects} buildings in the library.` + li("New", S.added) + li("Changed size", S.changed) + li("No longer in the catalogue", S.removed) +
    (gone.length ? `<br><span class="bad">${gone.length} item(s) on the map were removed because they left the catalogue.</span>` : "") +
    (S.added.length + S.removed.length + S.changed.length === 0 ? "<br>Nothing new." : "") + (S.warnings.length ? `<br><span class="warn"><b>Needs attention:</b><br>${S.warnings.join("<br>")}</span>` : "");
  if (r.picture_job) { try { localStorage.setItem("mb_job", r.picture_job); } catch (e) {} watchJob(r.picture_job); }
  $("#rfGo").disabled = false;
};

// ---------------------------------------------------------------- UI
// map size: the assembled model at 28 mm scale, shown in mm, cm, inches and feet (all items count, so an overhanging prop is included)
function mapSize() {
  if (!items.length) return null;
  const bs = items.map(aabb);
  return [Math.max(...bs.map(b => b[2])) - Math.min(...bs.map(b => b[0])), Math.max(...bs.map(b => b[3])) - Math.min(...bs.map(b => b[1]))];
}
function sizeHtml() {
  const m0 = mapSize(); if (!m0) return `<div class="sz empty">Nothing on the map yet.</div>`;
  const m = m0.map(v => v * SK());
  const f = (v, u) => v.toFixed(u.d).replace(/\.0+$/, "");
  const U = [{ n: "mm", k: 1, d: 0 }, { n: "cm", k: 0.1, d: 1 }, { n: "inches", k: 1 / 25.4, d: 1 }, { n: "feet", k: 1 / 304.8, d: 2 }];
  return U.map(u => `<div class="sz"><b>${f(m[0] * u.k, u)} × ${f(m[1] * u.k, u)}</b><span>${u.n}</span></div>`).join("") + `<div class="szcap">${SCALES[scaleId].name} scale · a long tile edge is ${SCALES[scaleId].tile} mm</div>`;
}
function updateUI() {
  // ONE SCALE PER MAP: the scale can be changed at any time, but it always changes the WHOLE map (every size is multiplied by the same ratio),
  // so pieces of 15, 28 and 32 mm are never mixed.
  { const sel = $("#scaleSel"); sel.disabled = false;
    sel.parentElement.title = items.length ? "Change the print scale of the whole map: every piece changes size together, so scales are never mixed." : "Choose the print scale."; }
  $("#sizeBox").innerHTML = sizeHtml();
  const tiles = items.filter(i => DEF[i.id].kind === "tile"), objs = items.filter(i => DEF[i.id].kind === "object");
  const ok = A.joins.filter(j => j.ok).length, bad = A.joins.length - ok;
  const st = {}; items.forEach(i => { const d = DEF[i.id]; if (d.set === "stretch") st[d.group] = (st[d.group] || 0) + 1; });
  $("#stats").innerHTML = `${tiles.length} tiles · ${objs.filter(o => !DEF[o.id].prop).length} buildings · ${objs.filter(o => DEF[o.id].prop).length} props<br><span class="ok">${ok} joins OK</span> · <span class="${bad ? "bad" : "mut"}">${bad} mismatched</span><br><span class="${A.open.length ? "warn" : "mut"}">${A.open.length} open road ends</span><br>` +
    (A.over.size ? `<span class="bad">${A.over.size} overlapping</span><br>` : "") + (A.road.size ? `<span class="bad">${A.road.size} building(s) on the road</span><br>` : "") +
    (A.foot.size ? `<span class="warn">${A.foot.size} item(s) on the footpath or road (allowed)</span><br>` : "") +
    "";
  $("#status").innerHTML = `${bad ? `<span class="bad">${bad} mismatch</span> · ` : ""}${A.open.length ? `<span class="warn">${A.open.length} open</span> · ` : ""}<span class="ok">${ok} joined</span>${dirty ? " · unsaved" : ""}`;
  const b = $("#inspBody");
  if (!sel) { b.className = "mut"; b.textContent = "Nothing selected"; return; }
  const d = DEF[sel.id]; b.className = "";
  const warn = [A.over.has(sel) && "overlaps another item", A.road.has(sel) && "a building stands on the road"].filter(Boolean);
  const note = A.foot.has(sel) ? (d.prop ? "stands on the footpath or road" : "stands on the footpath") : "";
  b.innerHTML = `<b>${d.num ? d.num + " · " : ""}${d.label}</b><div class="mut">${d.sku || d.folder} · ${sz(d.w)} × ${sz(d.l)} mm</div>
   <label>x <input type="number" id="ix" value="${Math.round(sel.x * 10) / 10}"></label><label>y <input type="number" id="iy" value="${Math.round(sel.y * 10) / 10}"></label>
   <label>rotation <input type="number" id="ir" step="${d.kind === "tile" ? 90 : 5}" value="${sel.rot}"></label>
   <div style="display:flex;gap:6px;margin-top:6px"><button id="bR">Rotate 90°</button><button id="bD">Duplicate</button><button id="bX">Delete</button></div>
   ${warn.length ? `<p class="bad">⚠ ${warn.join(", ")}</p>` : ""}${note ? `<p class="warn">⚠ ${note} (allowed)</p>` : ""}`;
  const set = () => { sel.x = +$("#ix").value; sel.y = +$("#iy").value; sel.rot = ((+$("#ir").value % 360) + 360) % 360; if (d.kind === "tile") sel.rot = Math.round(sel.rot / 90) * 90 % 360; commit(); };
  ["#ix", "#iy", "#ir"].forEach(s => $(s).onchange = set);
  $("#bR").onclick = () => rotSel(90); $("#bD").onclick = dup; $("#bX").onclick = del;
}
function rotSel(deg) { if (!sel) return; sel.rot = (sel.rot + deg + 360) % 360; commit(); }
function del() { if (!sel) return; items = items.filter(i => i !== sel); sel = null; commit(); }
function dup() { if (!sel) return; const n = { ...sel, uid: uidN++, x: sel.x + 20, y: sel.y - 20 }; items.push(n); sel = n; commit(); }
addEventListener("keydown", e => {
  if (e.target.matches("input,textarea,select")) return;
  if (e.code === "Space") { spaceDown = true; e.preventDefault(); }
  const k = e.key.toLowerCase();
  if (k === "r") { const t = ghost && ghost.item ? ghost.item : sel; if (t) { t.rot = (t.rot + (e.shiftKey ? -90 : 90) + 360) % 360; if (t === sel) commit(); else draw(); } }
  else if (k === "[") rotateMap(1);
  else if (k === "]") rotateMap(-1);
  else if (k === "delete" || k === "backspace") del();
  else if ((e.ctrlKey || e.metaKey) && k === "d") { e.preventDefault(); dup(); }
  else if ((e.ctrlKey || e.metaKey) && k === "s") { e.preventDefault(); e.shiftKey ? saveAs() : save(); }
  else if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); $("#bUndo").onclick(); }
  else if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); $("#bRedo").onclick(); }
  else if (k.startsWith("arrow") && sel) { e.preventDefault(); const s = e.shiftKey ? 20 : 5; sel.x += k === "arrowright" ? s : k === "arrowleft" ? -s : 0; sel.y += k === "arrowup" ? s : k === "arrowdown" ? -s : 0; commit(); }
});
addEventListener("keyup", e => { if (e.code === "Space") spaceDown = false; });

// ---------------------------------------------------------------- pointer
function hit(wx, wy) {
  for (const kind of ["object", "tile"]) for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i], d = DEF[it.id]; if (d.kind !== kind) continue;
    const [lx, ly] = rot2(wx - it.x, wy - it.y, -it.rot);
    if (Math.abs(lx) <= d.w / 2 && Math.abs(ly) <= d.l / 2) return it;
  }
  return null;
}
const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
const overCanvas = e => { const r = cv.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; };
cv.addEventListener("pointerdown", e => {
  const [sx, sy] = pos(e), [wx, wy] = toW(sx, sy);
  if (e.button === 1 || spaceDown) { pan = { sx, sy, ox: view.ox, oy: view.oy }; return; }
  const h = hit(wx, wy);
  if (h) { sel = h; drag = { it: h, dx: wx - h.x, dy: wy - h.y, moved: false }; cv.setPointerCapture(e.pointerId); }
  else { sel = null; pan = { sx, sy, ox: view.ox, oy: view.oy }; cv.setPointerCapture(e.pointerId); }
  updateUI(); draw();
});
addEventListener("pointermove", e => {
  if (pan) { const [sx, sy] = pos(e); view.ox = pan.ox + sx - pan.sx; view.oy = pan.oy + sy - pan.sy; draw(); return; }
  if (!drag) return;
  const [sx, sy] = pos(e), [wx, wy] = toW(sx, sy);
  if (drag.fromPal) {
    if (!overCanvas(e)) { ghost = null; draw(); return; }
    const d = drag.def, base = ghost && ghost.item ? ghost.item : { uid: 0, id: d.id, x: 0, y: 0, rot: 0 };
    const [x, y] = d.kind === "tile" ? snapTile(base, wx, wy, e.altKey) : snapObj(wx, wy, e.altKey, d.prop ? 2 : 5);
    base.x = x; base.y = y; ghost = { item: base }; draw();
  } else if (drag.it) {
    const it = drag.it; drag.moved = true;
    const [x, y] = DEF[it.id].kind === "tile" ? snapTile(it, wx - drag.dx, wy - drag.dy, e.altKey) : snapObj(wx - drag.dx, wy - drag.dy, e.altKey, DEF[it.id].prop ? 2 : 5);
    it.x = x; it.y = y; tilesRev++; A = analyse(); draw();
  }
});
addEventListener("pointerup", e => {
  pan = null;
  if (drag && drag.fromPal && ghost && ghost.item && overCanvas(e)) { const n = { ...ghost.item, uid: uidN++ }; items.push(n); sel = n; commit(); }
  else if (drag && drag.it && drag.moved) commit();
  ghost = null; drag = null; draw();
});
cv.addEventListener("wheel", e => {
  e.preventDefault(); const [sx, sy] = pos(e), [wx, wy] = toW(sx, sy), f = Math.exp(-e.deltaY * .0015);
  view.z = Math.min(6, Math.max(.2, view.z * f)); view.ox = sx - wx * view.z; view.oy = sy + wy * view.z; draw();
}, { passive: false });
cv.addEventListener("dblclick", e => { const [wx, wy] = toW(...pos(e)), h = hit(wx, wy); if (h) { sel = h; rotSel(90); } });
$("#notes").oninput = () => { dirty = true; };
$("#showJoins").onchange = draw;
addEventListener("beforeunload", e => { if (dirty && items.length) { e.preventDefault(); } });
init();

// the right pane folds away to a thin strip; open by default, remembered between visits
function inspOpen(on) {
  $("#insp").classList.toggle("collapsed", !on); $("#inspToggle").textContent = on ? "›" : "‹"; $("#inspToggle").setAttribute("aria-expanded", on);
  try { localStorage.setItem("mb_insp_open", on ? "1" : "0"); } catch (e) {}
  setTimeout(() => { resize(); }, 170);                                  // the map canvas takes the freed space
}
$("#inspToggle").onclick = () => inspOpen($("#insp").classList.contains("collapsed"));
{ let o = true; try { o = localStorage.getItem("mb_insp_open") !== "0"; } catch (e) {} if (!o) { $("#insp").classList.add("collapsed"); $("#inspToggle").textContent = "‹"; } }

// DARK / LIGHT: follows the computer's setting the first time, then remembers the button. ?theme=dark|light overrides (handy for screenshots).
function setTheme(t, keep) {
  document.documentElement.dataset.theme = t; $("#bTheme").textContent = t === "dark" ? "Light look" : "Dark look";
  $("#bTheme").title = t === "dark" ? "Switch to the light look" : "Switch to the dark look";
  if (keep) { try { localStorage.setItem("mb_theme", t); } catch (e) {} }
  if (typeof draw === "function") draw();
}
$("#bTheme").onclick = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true);
{ let t = new URLSearchParams(location.search).get("theme"); try { t = t || localStorage.getItem("mb_theme"); } catch (e) {}
  setTheme(t === "dark" || t === "light" ? t : "dark"); }          // dark is the default until the user picks the light look

$("#scaleSel").onchange = () => {
  const to = $("#scaleSel").value;
  if (to === scaleId) return;
  if (items.length && !confirm("Change the whole map from " + SCALES[scaleId].name + " to " + SCALES[to].name + "?\n\nEvery tile, building and prop changes size together, so nothing is mixed. The layout itself stays the same, and so do the pictures.")) { $("#scaleSel").value = scaleId; return; }
  setScale(to);
};

// MENUS (File, Settings) and the help button
function closeMenus() { document.querySelectorAll(".mlist").forEach(m => { m.hidden = true; }); }
document.querySelectorAll(".mbtn").forEach(b => { b.onclick = e => { e.stopPropagation(); const m = $("#" + b.dataset.menu), was = m.hidden; closeMenus(); m.hidden = !was; }; });
addEventListener("click", closeMenus);
addEventListener("keydown", e => { if (e.key === "Escape") closeMenus(); });
$("#bHelp").onclick = () => { $("#hint").hidden = !$("#hint").hidden; };
