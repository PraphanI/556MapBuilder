"use strict";
// FEEDBACK (web copy only). The form in index.html is a Netlify Form: Netlify finds it when the site is deployed and keeps every
// submission under Forms in the dashboard. This file only switches the sections, adds the map and the page details, and sends it.
const fbLog = [];                                                    // the last few things the person clicked, sent with the report
document.addEventListener("click", e => {
  const b = e.target.closest("button, a, .card"); if (!b || b.closest("#dFeed")) return;
  const t = (b.id || b.dataset.id || b.textContent || "").trim().slice(0, 40); if (t) { fbLog.push(t); if (fbLog.length > 12) fbLog.shift(); }
}, true);
function fbSections() {
  const t = document.querySelector('#fbForm [name=type]:checked').value;
  document.querySelectorAll("#fbForm .fbsec").forEach(s => { s.hidden = s.dataset.t !== t; });
  $("#fbAttach").checked = t === "Bug";                              // a bug is easier to chase with the map; a wish does not need one
}
document.querySelectorAll('#fbForm [name=type]').forEach(r => r.onchange = fbSections);
$("#fbHeard").onchange = () => { $("#fbHeardOther").hidden = $("#fbHeard").value !== "Other"; };
$("#bFeed").onclick = () => { $("#fbMsg").textContent = ""; $("#fbGo").disabled = false; fbSections(); $("#dFeed").showModal(); };
$("#fbCancel").onclick = () => $("#dFeed").close();
$("#fbForm").onsubmit = async e => {
  e.preventDefault();
  const f = e.target, t = f.type.value;
  const main = { "Bug": f.bug_what, "Feature request": f.feat_wish, "Other": f.other_text }[t];
  if (!main.value.trim()) { $("#fbMsg").textContent = "Please write a few words first."; main.focus(); return; }
  $("#fbMap").value = $("#fbAttach").checked ? JSON.stringify(serialise()) : "";
  const n = { tile: 0, building: 0, prop: 0 };
  items.forEach(i => { const d = DEF[i.id]; n[d.kind === "tile" ? "tile" : d.prop ? "prop" : "building"]++; });
  $("#fbCtx").value = JSON.stringify({ scale: scaleId, tiles: n.tile, buildings: n.building, props: n.prop, theme: document.documentElement.dataset.theme,
    screen: screen.width + "x" + screen.height, window: innerWidth + "x" + innerHeight, browser: navigator.userAgent, lastClicks: fbLog, when: new Date().toISOString() });
  $("#fbGo").disabled = true; $("#fbMsg").textContent = "Sending…";
  try {
    const r = await fetch("/", { method: "POST", body: new FormData(f) });
    if (!r.ok) throw new Error(r.status);
    $("#fbMsg").textContent = "Thank you. Your feedback was sent.";
    f.reset(); fbSections();
    setTimeout(() => { if ($("#dFeed").open) $("#dFeed").close(); $("#fbMsg").textContent = ""; }, 2200);
  } catch (x) { $("#fbGo").disabled = false; $("#fbMsg").textContent = "Could not send. Please try again in a moment."; }
};
