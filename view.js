"use strict";
// QUICK VIEW: the map as a picture, stacked from pre-rendered transparent sprites (4 angles per tile and building).
// No Blender and no render queue: the browser places every sprite where its footprint centre lies on the map.
// Camera: orthographic, 24 deg up, azimuth 315 + 90*v. An item turned by r (degrees, CCW) is seen from the sprite k = v - r/90.
const VW = { v: 0, zoom: 1, panx: 0, pany: 0, spr: null, imgs: {}, pend: {}, ready: false, missing: 0 };
const SIN_EL = Math.sin(24 * Math.PI / 180), COS_EL = Math.cos(24 * Math.PI / 180);
const vcv = $("#vcv"), vctx = vcv.getContext("2d");

async function viewLoad() {
  if (!VW.spr) { try { VW.spr = await (await fetch("sprites.json" + BUST())).json(); } catch (e) { VW.spr = { items: {} }; } }
  const need = [];
  for (const it of items) {
    const s = VW.spr.items[it.id]; if (!s) continue;
    const k = spriteK(it), e = s[k]; if (!e) continue;
    if (!VW.pend[e[0]]) {                                    // one promise per picture, so overlapping draws all wait for it
      const im = new Image(); VW.imgs[e[0]] = im;
      VW.pend[e[0]] = new Promise(r => { im.onload = im.onerror = r; im.src = "img/sprites/" + e[0]; });
    }
    need.push(VW.pend[e[0]]);
  }
  await Promise.all(need);
}
const rotIdx = it => ((Math.round(it.rot / 90) % 4) + 4) % 4;
const spriteK = it => (((VW.v - rotIdx(it)) % 4) + 4) % 4;

// world (x, y, z) -> screen millimetres, y down
function proj(x, y, z) {
  const V = (315 + 90 * VW.v) * Math.PI / 180, c = Math.cos(V), s = Math.sin(V);
  return [-s * x + c * y, (c * x + s * y) * SIN_EL - z * COS_EL];
}

// buildings far to near. A is behind B when they are separated along x or y on the far side of the camera direction.
function orderBuildings(bs) {
  const V = (315 + 90 * VW.v) * Math.PI / 180, dx = Math.cos(V), dy = Math.sin(V);
  const box = it => { const d = DEF[it.id], q = rotIdx(it) % 2 ? [d.l, d.w] : [d.w, d.l]; return [it.x - q[0] / 2, it.y - q[1] / 2, it.x + q[0] / 2, it.y + q[1] / 2]; };
  const B = bs.map(box), n = bs.length, behind = Array.from({ length: n }, () => new Set()), indeg = new Array(n).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;                                  // edge i -> j means i is drawn before j (i is behind j)
    const a = B[i], b = B[j];
    const sepX = a[2] <= b[0] + 0.5 ? -1 : b[2] <= a[0] + 0.5 ? 1 : 0;      // a is left (-1) or right (+1) of b in x
    const sepY = a[3] <= b[1] + 0.5 ? -1 : b[3] <= a[1] + 0.5 ? 1 : 0;
    let before = false;
    if (sepX && Math.abs(dx) > 0.01) before = before || (sepX * dx < 0);     // farther along -dx is behind
    if (sepY && Math.abs(dy) > 0.01) before = before || (sepY * dy < 0);
    if (before && !behind[i].has(j)) { behind[i].add(j); indeg[j]++; }
  }
  const depth = bs.map(it => it.x * dx + it.y * dy), out = [], left = new Set(bs.keys());
  while (left.size) {
    let pick = [...left].filter(i => indeg[i] === 0);
    if (!pick.length) pick = [...left];                     // a cycle (corner-touching): fall back to depth
    pick.sort((p, q) => depth[p] - depth[q]);
    const i = pick[0]; left.delete(i); out.push(bs[i]);
    for (const j of behind[i]) indeg[j]--;
  }
  return out;
}

// buildings and props can be hidden to see the roads alone; the framing still counts everything, so nothing jumps when you tick
const visible = it => { const d = DEF[it.id]; return d.kind === "tile" || (d.prop ? $("#vProps").checked : $("#vBuild").checked); };
function sceneItems() {
  const tiles = items.filter(i => DEF[i.id].kind === "tile"), V = (315 + 90 * VW.v) * Math.PI / 180, dx = Math.cos(V), dy = Math.sin(V);
  tiles.sort((a, b) => (a.x * dx + a.y * dy) - (b.x * dx + b.y * dy));
  return [...tiles, ...orderBuildings(items.filter(i => DEF[i.id].kind === "object"))];
}

// draw the whole scene into ctx (W x H css px); s = pixels per mm; (ox, oy) = screen position of world origin
function paintView(c, W, H, s, ox, oy, order) {
  const g = c.createRadialGradient(W / 2, H * 0.45, 10, W / 2, H * 0.45, Math.max(W, H) * 0.75);
  g.addColorStop(0, "#26282d"); g.addColorStop(1, "#08080a");
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.imageSmoothingQuality = "high";
  let missing = 0;
  for (const it of order) {
    const d = DEF[it.id], spr = VW.spr.items[it.id], e = spr && spr[spriteK(it)], im = e && VW.imgs[e[0]];
    const [mx, my] = proj(it.x, it.y, 0), X = ox + mx * s, Y = oy + my * s;
    if (im && im.complete && im.naturalWidth) {
      const f = s / (e[5] || VW.spr.ppm);
      c.drawImage(im, X - e[3] * f, Y - e[4] * f, e[1] * f, e[2] * f);
    } else {
      missing++;
      c.save();
      if (d.kind === "tile" && IMG[it.id] && IMG[it.id].complete) {      // no sprite yet: the flat top-view picture, laid on the ground
        const V = (315 + 90 * VW.v) * Math.PI / 180, cs = Math.cos(V), sn = Math.sin(V), r = it.rot * Math.PI / 180, cr = Math.cos(r), sr = Math.sin(r);
        const [tx, ty] = proj(it.x, it.y, 10);
        const ax = -sn * cr + cs * sr, ay = SIN_EL * (cs * cr + sn * sr), bx = -sn * -sr + cs * cr, by = SIN_EL * (cs * -sr + sn * cr);
        c.transform(ax * s, ay * s, bx * s, by * s, ox + tx * s, oy + ty * s); c.scale(1, -1);
        c.drawImage(IMG[it.id], -d.w / 2, -d.l / 2, d.w, d.l);
      } else {                                                           // a building without sprites: its footprint as a block
        const hh = d.h || 40, pts = obb(it).map(p => [p, [p[0], p[1]]]);
        c.fillStyle = "#9a9a9a"; c.strokeStyle = "#222"; c.beginPath();
        obb(it).forEach(([px, py], i) => { const [a, b] = proj(px, py, 8 + hh); const m = [ox + a * s, oy + b * s]; i ? c.lineTo(...m) : c.moveTo(...m); });
        c.closePath(); c.fill(); c.stroke();
      }
      c.restore();
    }
  }
  return missing;
}

// fit: scale + origin that put the union of all sprite rectangles inside W x H with a margin
function viewFit(W, H, order, margin = 0.06) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const it of order) {
    const d = DEF[it.id], spr = VW.spr.items[it.id], e = spr && spr[spriteK(it)];
    const [mx, my] = proj(it.x, it.y, 0), f = 1 / ((e && e[5]) || VW.spr.ppm);
    if (e) { x0 = Math.min(x0, mx - e[3] * f); x1 = Math.max(x1, mx - e[3] * f + e[1] * f); y0 = Math.min(y0, my - e[4] * f); y1 = Math.max(y1, my - e[4] * f + e[2] * f); }
    else for (const [px, py] of obb(it)) for (const z of [0, 8 + (d.h || 12)]) { const [a, b] = proj(px, py, z); x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b); }
  }
  if (x0 > x1) return { s: 1, ox: W / 2, oy: H / 2 };
  const s = Math.min(W * (1 - 2 * margin) / (x1 - x0), H * (1 - 2 * margin) / (y1 - y0));
  return { s, ox: W / 2 - (x0 + x1) / 2 * s, oy: H / 2 - (y0 + y1) / 2 * s };
}

async function viewDraw() {
  const r = vcv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  const W2 = Math.round(r.width * dpr), H2 = Math.round(r.height * dpr);
  if (vcv.width !== W2 || vcv.height !== H2) { vcv.width = W2; vcv.height = H2; }      // resizing clears the picture, so only when it changed
  await viewLoad();
  const order = sceneItems(), f = viewFit(r.width, r.height, order), s = f.s * VW.zoom;
  vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = r.width / 2, cy = r.height / 2;
  VW.missing = paintView(vctx, r.width, r.height, s, cx + (f.ox - cx) * VW.zoom + VW.panx, cy + (f.oy - cy) * VW.zoom + VW.pany, order.filter(visible));
  $("#vInfo").textContent = `View ${VW.v + 1} of 4 · ${items.length} items` + (VW.missing ? ` · ${VW.missing} drawn simply (sprites not rendered yet)` : "");
}

$("#bView").onclick = async () => {
  if (!items.length) return alert("The map is empty.");
  VW.v = 0; VW.zoom = 1; VW.panx = VW.pany = 0;
  $("#dView").showModal(); await viewDraw();
};
$("#vL").onclick = () => { VW.v = (VW.v + 3) % 4; VW.panx = VW.pany = 0; viewDraw(); };
$("#vR").onclick = () => { VW.v = (VW.v + 1) % 4; VW.panx = VW.pany = 0; viewDraw(); };
$("#vBuild").onchange = $("#vProps").onchange = viewDraw;
$("#vClose").onclick = () => $("#dView").close();
let vdrag = null;
vcv.addEventListener("pointerdown", e => { vdrag = { x: e.clientX, y: e.clientY, px: VW.panx, py: VW.pany }; vcv.setPointerCapture(e.pointerId); });
vcv.addEventListener("pointermove", e => { if (vdrag) { VW.panx = vdrag.px + e.clientX - vdrag.x; VW.pany = vdrag.py + e.clientY - vdrag.y; viewDraw(); } });
vcv.addEventListener("pointerup", () => { vdrag = null; });
vcv.addEventListener("wheel", e => { e.preventDefault(); VW.zoom = Math.min(8, Math.max(0.3, VW.zoom * Math.exp(-e.deltaY * 0.0015))); viewDraw(); }, { passive: false });
addEventListener("resize", () => { if ($("#dView").open) viewDraw(); });

// export: the same scene at the chosen ratio and size, saved into the render folder
const VRATIO = () => $("#vRatio").value.split(":").map(Number);
$("#vSave").onclick = async () => {
  await viewLoad();
  const [a, b] = VRATIO(), L = +$("#vLong").value, ev = n => Math.max(2, Math.round(n / 2) * 2);
  const W = a >= b ? ev(L) : ev(L * a / b), H = a >= b ? ev(L * b / a) : ev(L);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const order = sceneItems(), f = viewFit(W, H, order, 0.05);
  paintView(c.getContext("2d"), W, H, f.s, f.ox, f.oy, order.filter(visible));
  if (WEB) {                                                       // no render folder on the web: the picture downloads
    const stem = (filePath ? filePath.replace(/\.json$/i, "") : "layout") + "_view" + (VW.v + 1);
    const a = document.createElement("a"); a.href = c.toDataURL("image/png"); a.download = stem + ".png"; a.click();
    $("#vInfo").textContent = "Downloaded " + stem + ".png"; return;
  }
  const R = await (await fetch("/api/recent")).json();
  const folder = (renderCfg && renderCfg.folder) || R.render_dir;
  const stem = (filePath ? filePath.split("\\").pop().replace(/\.json$/i, "") : "layout") + "_view" + (VW.v + 1);
  const r = await post("/api/save-view", { folder, filename: stem, data: c.toDataURL("image/png") });
  $("#vInfo").innerHTML = r.path ? `Saved ${r.path} <button id="vShow">Show in folder</button>` : `<span class="bad">${r.error || "could not save"}</span>`;
  if (r.path) $("#vShow").onclick = () => post("/api/reveal", { path: r.path, select: true });
};
