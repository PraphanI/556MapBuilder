"use strict";
// PARTS LIST: what a player has to print for the map on screen. Counts every tile, building and prop by type.
const GROUP_ORDER = ["Street", "Offset street", "Median", "Roundabout", "Plain ground", "One-lane", "Alley", "Transition", "Parking"];

function partsData() {
  const by = {};
  for (const it of items) { const d = DEF[it.id]; (by[it.id] = by[it.id] || { d, n: 0 }).n++; }
  const rows = Object.values(by).map(({ d, n }) => ({
    kind: d.kind === "tile" ? "Road tile" : d.prop ? "Prop" : d.wall ? "Wall piece" : "Building", n, name: (d.num ? d.num + " " : "") + d.label,
    model: d.kind === "tile" ? "556_RoadSystem_" + d.sku : d.folder, size: d.kind === "tile" ? `${sz(d.w)} × ${sz(d.l)}` : `${sz(d.w)} × ${sz(d.l)} × ${sz(d.h)}`,
    set: d.set === "core" ? "Core set" : "Stretch goal", group: d.group, img: d.img, d,
  }));
  const rank = r => ({ "Road tile": 0, "Building": 1, "Wall piece": 2, "Prop": 3 }[r.kind]) * 100 + (r.kind === "Road tile" ? (GROUP_ORDER.indexOf(r.group) + 99) % 99 : 0);
  rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const bs = items.length ? items.map(aabb) : null;
  const size = bs ? [Math.max(...bs.map(b => b[2])) - Math.min(...bs.map(b => b[0])), Math.max(...bs.map(b => b[3])) - Math.min(...bs.map(b => b[1]))].map(v => Math.round(v * SK())) : [0, 0];
  const tot = k => rows.filter(r => r.kind === k).reduce((s, r) => s + r.n, 0), typ = k => rows.filter(r => r.kind === k).length;
  const goals = {};
  rows.filter(r => r.d.set === "stretch").forEach(r => { const g = r.d.goal || "stretch goal"; goals[g] = (goals[g] || 0) + r.n; });
  return { rows, size, tiles: tot("Road tile"), tileTypes: typ("Road tile"), builds: tot("Building"), buildTypes: typ("Building"), walls: tot("Wall piece"), wallTypes: typ("Wall piece"), props: tot("Prop"), propTypes: typ("Prop"), goals };
}

function partsText(P, name) {
  const L = [`${name} - parts to print`, `Map size ${P.size[0]} x ${P.size[1]} mm (${SCALES[scaleId].name} scale)`, ""];
  P.rows.forEach(r => L.push(`${r.n} x ${r.name}   [${r.kind}, ${r.size} mm, ${r.set}]`));
  L.push("", `Road tiles: ${P.tiles} (${P.tileTypes} types) | Buildings: ${P.builds} (${P.buildTypes} types) | Wall pieces: ${P.walls} (${P.wallTypes} types) | Props: ${P.props} (${P.propTypes} types)`);
  return L.join("\n");
}

function partsCsv(P) {
  const q = v => '"' + String(v).replace(/"/g, '""') + '"';
  return ["Qty,Type,Name,Model,Size mm,Set"].concat(P.rows.map(r => [r.n, r.kind, r.name, r.model, r.size, r.set].map(q).join(","))).join("\r\n");
}

// the live list in the right-hand pane: rebuilt whenever the map changes; collapsible, open by default
function renderParts() {
  const box = $("#pBody");
  if (!items.length) { box.className = "mut"; box.textContent = "Nothing on the map yet."; return; }
  const P = partsData(); let last = "";
  const rows = P.rows.map(r => {
    const head = r.kind !== last ? `<tr class="ph"><td colspan="3">${r.kind}s</td></tr>` : ""; last = r.kind;
    return head + `<tr><td class="q">${r.n}×</td><td><img src="${r.img || ""}" alt=""></td><td class="nm">${r.name}<small>${r.size} mm${r.d.set === "core" ? "" : " · " + r.set}</small></td></tr>`;
  }).join("");
  box.className = "";
  box.innerHTML = `<div class="sum"><b>${P.tiles}</b> tiles (${P.tileTypes} types) · <b>${P.builds}</b> buildings · <b>${P.walls}</b> wall pieces · <b>${P.props}</b> props<br><span class="mut">Map ${P.size[0]} × ${P.size[1]} mm</span></div><table>${rows}</table>`;
}
const _updateUI = updateUI;
updateUI = function () { _updateUI(); renderParts(); };
function partsCollapse(on) {
  $("#partsPane").hidden = !on; $("#pToggle").textContent = on ? "▾" : "▸"; $("#pToggle").setAttribute("aria-expanded", on);
  try { localStorage.setItem("mb_parts_open", on ? "1" : "0"); } catch (e) {}
}
$("#pToggle").onclick = () => partsCollapse($("#partsPane").hidden);
$(".phead h3").onclick = $("#pToggle").onclick;
let _open = true; try { _open = localStorage.getItem("mb_parts_open") !== "0"; } catch (e) {}
partsCollapse(_open);
$("#pCopy").onclick = async () => { await navigator.clipboard.writeText(partsText(partsData(), $("#name").value || "map")); flash("Parts list copied"); };
$("#pCsv").onclick = () => {
  const a = document.createElement("a"), nm = ($("#name").value || "map").replace(/[\\/:*?"<>|]/g, "_");
  a.href = URL.createObjectURL(new Blob(["﻿" + partsCsv(partsData())], { type: "text/csv" })); a.download = nm + "_parts.csv"; a.click();
};
$("#pPrint").onclick = () => {                               // a clean page of its own: the browser's print dialog also saves to PDF
  const P = partsData(), nm = $("#name").value || "map", w = window.open("", "_blank");
  let last = "";
  const rows = P.rows.map(r => { const h = r.kind !== last ? `<tr><th colspan="5">${r.kind}s</th></tr>` : ""; last = r.kind;
    return h + `<tr><td class="q">${r.n}×</td><td><img src="${r.img ? location.origin + "/" + r.img : ""}"></td><td><b>${r.name}</b><br><small>${r.model}</small></td><td>${r.size} mm</td><td>${r.set}</td></tr>`; }).join("");
  w.document.write(`<!doctype html><title>${nm} - parts</title><style>body{font:13px system-ui;margin:24px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ccc;padding:5px 8px;text-align:left;vertical-align:middle}th{background:#eee}img{width:52px;height:52px;object-fit:contain}.q{font-size:18px;font-weight:700;width:48px}small{color:#666}@media print{th{-webkit-print-color-adjust:exact}}</style>
    <h2>${nm} — parts to print</h2><p>${P.tiles} road tiles (${P.tileTypes} types) · ${P.builds} buildings (${P.buildTypes} types) · ${P.props} props (${P.propTypes} types)<br>Assembled map ${P.size[0]} × ${P.size[1]} mm at ${SCALES[scaleId].name} scale</p><table>${rows}</table>`);
  w.document.close(); w.onload = () => w.print(); setTimeout(() => { try { w.print(); } catch (e) {} }, 700);
};
