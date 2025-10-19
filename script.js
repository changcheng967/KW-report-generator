// ------------------ Config ------------------
const RUNS = ["KW29", "KW30"]; // add more like "KW30" when you have them

// ------------------ Fetch ------------------
async function fetchText(path) {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    return null;
  }
}

// ------------------ Parsing ------------------
function parseMatchLog(text) {
  const models = {};
  // Avg move time lines
  const avgTimeRegex = /Avg move time used by (.+?)\s+([0-9.]+)\s+(\d+)\s+moves/g;
  let m;
  while ((m = avgTimeRegex.exec(text)) !== null) {
    const [, model, time, moves] = m;
    if (!models[model]) models[model] = { avgTime: 0, moves: null, nnRows: 0 };
    models[model].avgTime = parseFloat(time);
    models[model].moves = models[model].moves === null ? parseInt(moves) : Math.min(models[model].moves, parseInt(moves));
  }
  // NN rows lines
  const nnRegex = /NN rows:\s+(\d+)/g;
  const rows = [];
  while ((m = nnRegex.exec(text)) !== null) rows.push(parseInt(m[1]));
  // Assign ordered rows to models (best-effort)
  const keys = Object.keys(models);
  for (let i = 0; i < keys.length && i < rows.length; i++) {
    models[keys[i]].nnRows = rows[i];
  }
  return models;
}

function parseSgfSummary(text) {
  const results = {};
  // Elo lines like: "FMSWA7              :    48.41 +/- 25.16"
  const eloLine = /^([^\n:]+?)\s*:\s*(-?\d+\.\d+)\s*\+\/-\s*(\d+\.\d+)/gm;
  let m;
  while ((m = eloLine.exec(text)) !== null) {
    const name = m[1].trim();
    const elo = parseFloat(m[2]);
    const err = parseFloat(m[3]);
    if (!results[name]) results[name] = {};
    results[name].elo = elo;
    results[name].error = err;
  }
  // Win% lines e.g. "KW29 b18c384nbt 1018   29.5%"
  const winPct = /([A-Za-z0-9\-\s\.]+?)\s+([0-9]+\.[0-9]+)%/g;
  while ((m = winPct.exec(text)) !== null) {
    const name = m[1].trim();
    const winp = parseFloat(m[2]);
    if (!results[name]) results[name] = {};
    results[name].winPercent = winp;
  }
  return results;
}

// ------------------ Derivations ------------------
function pickBaseline(eloData, matchModels) {
  // Prefer FMSWA7 if present, else highest Elo, else first model
  if (eloData["FMSWA7"]) return "FMSWA7";
  const entries = Object.entries(eloData);
  if (entries.length) {
    entries.sort((a, b) => (b[1].elo ?? 0) - (a[1].elo ?? 0));
    return entries[0][0];
  }
  const keys = Object.keys(matchModels);
  return keys.length ? keys[0] : null;
}

function computeDerived(matchModels, eloData, baselineName) {
  const baseline = baselineName || pickBaseline(eloData, matchModels);
  const baselineTime = baseline ? matchModels[baseline]?.avgTime : null;

  const rows = [];
  for (const [model, m] of Object.entries(matchModels)) {
    const elo = eloData[model]?.elo ?? null;
    const winp = eloData[model]?.winPercent ?? null;
    const err = eloData[model]?.error ?? null;

    const relativeSpeed = (baselineTime && m.avgTime) ? (baselineTime / m.avgTime) : null;
    const eloPerRow = (elo !== null && m.nnRows) ? (elo / m.nnRows) : null;
    const efficiency = (elo !== null && m.avgTime) ? (elo / m.avgTime) : null;

    const verdict =
      elo === null ? "Unknown"
        : (elo > (eloData[baseline]?.elo ?? 0)) ? "Stronger than baseline"
        : (elo < (eloData[baseline]?.elo ?? 0)) ? "Weaker than baseline"
        : "Equal";

    rows.push({
      model, baseline,
      avgTime: m.avgTime ?? null,
      moves: m.moves ?? null,
      nnRows: m.nnRows ?? null,
      winPercent: winp,
      elo, error: err,
      relativeSpeed, eloPerRow, efficiency, verdict
    });
  }
  return { baseline, rows };
}

// ------------------ Rendering ------------------
let eloChart, timeChart, winChart, effChart;

function renderTables(matchModels, eloData, derived) {
  // Match table
  const mtBody = document.querySelector("#matchTable tbody");
  mtBody.innerHTML = "";
  Object.entries(matchModels).forEach(([model, m]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${model}</td>
      <td>${m.avgTime?.toFixed(6) ?? "-"}</td>
      <td>${m.moves ?? "-"}</td>
      <td>${m.nnRows !== undefined && m.nnRows !== null ? m.nnRows.toLocaleString() : "-"}</td>
    `;
    mtBody.appendChild(tr);
  });

  // Elo table
  const etBody = document.querySelector("#eloTable tbody");
  etBody.innerHTML = "";
  Object.entries(eloData).forEach(([model, data]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${model}</td>
      <td>${data.winPercent !== undefined ? (data.winPercent.toFixed(1) + "%") : "-"}</td>
      <td>${data.elo !== undefined ? data.elo.toFixed(2) : "-"}</td>
      <td>${data.error !== undefined ? ("±" + data.error.toFixed(2)) : "-"}</td>
    `;
    etBody.appendChild(tr);
  });

  // Derived table
  const dtBody = document.querySelector("#derivedTable tbody");
  dtBody.innerHTML = "";
  derived.rows.forEach(r => {
    const verdictColor =
      r.verdict.includes("Stronger") ? "var(--success)" :
      r.verdict.includes("Weaker") ? "var(--danger)" : "var(--muted)";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.model}</td>
      <td>${r.baseline}</td>
      <td>${r.relativeSpeed !== null ? r.relativeSpeed.toFixed(2) : "-"}</td>
      <td>${r.eloPerRow !== null ? r.eloPerRow.toExponential(3) : "-"}</td>
      <td>${r.efficiency !== null ? r.efficiency.toFixed(2) : "-"}</td>
      <td style="color:${verdictColor}">${r.verdict}</td>
    `;
    dtBody.appendChild(tr);
  });
}

function renderCharts(matchModels, eloData, derived) {
  const labelsElo = Object.keys(eloData);
  const dataElo = labelsElo.map(k => eloData[k].elo ?? 0);

  const labelsTime = Object.keys(matchModels);
  const dataTime = labelsTime.map(k => matchModels[k].avgTime ?? 0);

  const labelsWin = Object.keys(eloData);
  const dataWin = labelsWin.map(k => eloData[k].winPercent ?? 0);

  const effPoints = derived.rows
    .filter(r => r.efficiency !== null && r.relativeSpeed !== null)
    .map(r => ({ x: r.relativeSpeed, y: r.efficiency, label: r.model }));

  [eloChart, timeChart, winChart, effChart].forEach(c => c && c.destroy());

  // Elo bar
  eloChart = new Chart(document.getElementById("eloChart").getContext("2d"), {
    type: "bar",
    data: {
      labels: labelsElo,
      datasets: [{
        label: "Elo",
        data: dataElo,
        backgroundColor: labelsElo.map(l => l === derived.baseline ? "#60a5fa" : "#34d399"),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      scales: { y: { beginAtZero: true } }
    }
  });

  // Time bar
  timeChart = new Chart(document.getElementById("timeChart").getContext("2d"), {
    type: "bar",
    data: {
      labels: labelsTime,
      datasets: [{
        label: "Avg move time (s)",
        data: dataTime,
        backgroundColor: labelsTime.map(l => l === derived.baseline ? "#60a5fa" : "#f59e0b"),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      scales: { y: { beginAtZero: true } }
    }
  });

  // Win% pie
  winChart = new Chart(document.getElementById("winChart").getContext("2d"), {
    type: "pie",
    data: {
      labels: labelsWin,
      datasets: [{
        label: "Win%",
        data: dataWin,
        backgroundColor: ["#60a5fa", "#34d399", "#f59e0b", "#ef4444", "#a78bfa", "#22c55e", "#06b6d4"]
      }]
    },
    options: { responsive: true }
  });

  // Efficiency scatter (relative speed vs efficiency)
  effChart = new Chart(document.getElementById("effChart").getContext("2d"), {
    type: "scatter",
    data: {
      datasets: [{
        label: "Eff (Elo/sec) vs Rel speed",
        data: effPoints.map(p => ({ x: p.x, y: p.y })),
        pointBackgroundColor: "#34d399",
        pointBorderColor: "#34d399"
      }]
    },
    options: {
      responsive: true,
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const idx = ctx.dataIndex;
              const p = effPoints[idx];
              return `${p.label}: speed ${p.x.toFixed(2)}, eff ${p.y.toFixed(2)}`;
            }
          }
        }
      },
      scales: {
        x: { title: { display: true, text: "Relative speed (baseline / model)" }, beginAtZero: true },
        y: { title: { display: true, text: "Efficiency (Elo/sec)" }, beginAtZero: true }
      }
    }
  });
}

// ------------------ Export ------------------
function exportCSV(derived) {
  const headers = [
    "Model","Baseline","AvgMoveTime(s)","TotalMoves(sample)","NNRows",
    "WinPercent","Elo","EloError","RelativeSpeed","EloPerNNRow","Efficiency(Elo_per_sec)","Verdict"
  ];
  const lines = [headers.join(",")];

  derived.rows.forEach(r => {
    const row = [
      r.model,
      r.baseline,
      r.avgTime ?? "",
      r.moves ?? "",
      r.nnRows ?? "",
      r.winPercent ?? "",
      r.elo ?? "",
      r.error ?? "",
      r.relativeSpeed !== null && r.relativeSpeed !== undefined ? r.relativeSpeed.toFixed(4) : "",
      r.eloPerRow !== null && r.eloPerRow !== undefined ? r.eloPerRow.toExponential(6) : "",
      r.efficiency !== null && r.efficiency !== undefined ? r.efficiency.toFixed(4) : "",
      r.verdict
    ];
    lines.push(row.map(v => (typeof v === "string" && v.includes(",")) ? `"${v}"` : v).join(","));
  });

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "kw29_report.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ------------------ Orchestration ------------------
async function loadKW29() {
  const status = document.getElementById("status");
  status.textContent = "Loading KW29 logs…";
  const matchText = await fetchText("KW29/match.log");
  const sgfText = await fetchText("KW29/output.log");

  if (!matchText || !sgfText) {
    status.textContent = "Failed to load KW29 logs. Make sure GitHub Pages is enabled for this repo and the files exist at /KW29/match.log and /KW29/output.log.";
    return null;
  }

  const matchModels = parseMatchLog(matchText);
  const eloData = parseSgfSummary(sgfText);

  const derived = computeDerived(matchModels, eloData, null);

  renderTables(matchModels, eloData, derived);
  renderCharts(matchModels, eloData, derived);

  document.getElementById("summary").classList.remove("hidden");
  document.getElementById("charts").classList.remove("hidden");
  document.getElementById("exportBtn").disabled = false;

  status.textContent = "KW29 loaded.";
  return { matchModels, eloData, derived };
}

document.addEventListener("DOMContentLoaded", () => {
  const reloadBtn = document.getElementById("reloadBtn");
  const exportBtn = document.getElementById("exportBtn");
  let last = null;

  reloadBtn.addEventListener("click", async () => {
    last = await loadKW29();
  });

  exportBtn.addEventListener("click", () => {
    if (!last || !last.derived) return;
    exportCSV(last.derived);
  });

  // Auto-load on page open
  loadKW29();
});
