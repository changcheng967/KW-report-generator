// ---------- Parsing helpers ----------

function parseMatchLog(text) {
  const models = {};
  const avgTimeRegex = /Avg move time used by (.+?)\s+([0-9.]+)\s+(\d+)\s+moves/g;
  let match;
  while ((match = avgTimeRegex.exec(text)) !== null) {
    const [, model, time, moves] = match;
    if (!models[model]) models[model] = { avgTime: 0, moves: null, nnRows: 0 };
    models[model].avgTime = parseFloat(time); // latest sample; they stabilize
    models[model].moves = models[model].moves === null ? parseInt(moves) : Math.min(models[model].moves, parseInt(moves));
  }
  const nnRegex = /NN rows:\s+(\d+)/g;
  const rowsFound = [];
  while ((match = nnRegex.exec(text)) !== null) rowsFound.push(parseInt(match[1]));
  // Assign NN rows in order of appearance to models by sorted key (best-effort heuristic)
  const keys = Object.keys(models);
  if (rowsFound.length && keys.length) {
    for (let i = 0; i < keys.length && i < rowsFound.length; i++) {
      models[keys[i]].nnRows = rowsFound[i];
    }
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
  // Win% matrix simplified capture e.g. "KW29 b18c384nbt 1018   29.5%"
  const winPct = /([A-Za-z0-9\-\s\.]+?)\s+([0-9]+\.[0-9]+)%/g;
  while ((m = winPct.exec(text)) !== null) {
    const name = m[1].trim();
    const winp = parseFloat(m[2]);
    if (!results[name]) results[name] = {};
    results[name].winPercent = winp;
  }
  return results;
}

// ---------- Derivations ----------

function pickBaseline(eloData, fallbackModel) {
  const entries = Object.entries(eloData);
  if (!entries.length) return fallbackModel || null;
  entries.sort((a, b) => (b[1].elo ?? 0) - (a[1].elo ?? 0));
  return entries[0][0];
}

function computeDerived(matchModels, eloData, baselineName) {
  const baseline = baselineName || pickBaseline(eloData, Object.keys(matchModels)[0]);
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

// ---------- Rendering ----------

let eloChart, timeChart, winChart, effChart, historyChart;
const historyRuns = [];

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
      <td>${m.nnRows?.toLocaleString() ?? "-"}</td>
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

  // Efficiency scatter
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

function renderHistory() {
  const tableBody = document.querySelector("#historyTable tbody");
  tableBody.innerHTML = "";
  historyRuns.forEach(run => {
    run.rows.forEach(r => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${run.label}</td>
        <td>${r.model}</td>
        <td>${r.winPercent !== null && r.winPercent !== undefined ? r.winPercent.toFixed(1) + "%" : "-"}</td>
        <td>${r.elo !== null && r.elo !== undefined ? r.elo.toFixed(2) : "-"}</td>
        <td>${r.error !== null && r.error !== undefined ? "±" + r.error.toFixed(2) : "-"}</td>
        <td>${r.avgTime !== null && r.avgTime !== undefined ? r.avgTime.toFixed(6) : "-"}</td>
        <td>${r.nnRows !== null && r.nnRows !== undefined ? r.nnRows.toLocaleString() : "-"}</td>
        <td>${r.efficiency !== null && r.efficiency !== undefined ? r.efficiency.toFixed(2) : "-"}</td>
      `;
      tableBody.appendChild(tr);
    });
  });

  // Build a simple Elo progression chart for non-baseline models across runs
  const labels = historyRuns.map(r => r.label);
  const modelsSet = new Set();
  historyRuns.forEach(r => r.rows.forEach(row => { if (row.model !== row.baseline) modelsSet.add(row.model); }));
  const models = Array.from(modelsSet);

  const datasets = models.map((model, idx) => {
    const colorPalette = ["#60a5fa", "#34d399", "#f59e0b", "#ef4444", "#a78bfa", "#22c55e", "#06b6d4"];
    const color = colorPalette[idx % colorPalette.length];
    const data = labels.map(label => {
      const run = historyRuns.find(h => h.label === label);
      const row = run.rows.find(r => r.model === model);
      return row?.elo ?? null;
    });
    return {
      label: model,
      data,
      borderColor: color,
      backgroundColor: color,
      tension: 0.25
    };
  });

  historyChart && historyChart.destroy();
  historyChart = new Chart(document.getElementById("historyChart").getContext("2d"), {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom" } },
      scales: { y: { beginAtZero: false } }
    }
  });

  document.getElementById("history").classList.remove("hidden");
}

// ---------- Export ----------

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
  a.download = "kw_vs_baseline.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------- Wire-up ----------

document.addEventListener("DOMContentLoaded", () => {
  const generateBtn = document.getElementById("generateBtn");
  const exportBtn = document.getElementById("exportBtn");
  const resetBtn = document.getElementById("resetBtn");
  const addRunBtn = document.getElementById("addRunBtn");

  let lastDerived = null;
  let lastMatch = null;
  let lastElo = null;

  generateBtn.addEventListener("click", () => {
    const matchText = document.getElementById("matchlog").value.trim();
    const sgfText = document.getElementById("sgfsummary").value.trim();

    if (!matchText && !sgfText) {
      alert("Please paste either match.log or summarize_sgfs.py output.");
      return;
    }

    const matchModels = matchText ? parseMatchLog(matchText) : {};
    const eloData = sgfText ? parseSgfSummary(sgfText) : {};

    const derived = computeDerived(matchModels, eloData, null);

    renderTables(matchModels, eloData, derived);
    renderCharts(matchModels, eloData, derived);

    document.getElementById("summary").classList.remove("hidden");
    document.getElementById("charts").classList.remove("hidden");
    exportBtn.disabled = false;

    lastDerived = derived;
    lastMatch = matchModels;
    lastElo = eloData;
  });

  exportBtn.addEventListener("click", () => {
    if (!lastDerived) return;
    exportCSV(lastDerived);
  });

  addRunBtn.addEventListener("click", () => {
    if (!lastDerived) { alert("Generate a report first."); return; }
    const label = prompt("Run label (e.g., KW29 v FMSWA7 @ 40/10 visits):", `Run ${historyRuns.length + 1}`);
    if (!label) return;
    historyRuns.push({ label, rows: lastDerived.rows });
    renderHistory();
  });

  resetBtn.addEventListener("click", () => {
    document.getElementById("matchlog").value = "";
    document.getElementById("sgfsummary").value = "";
    document.getElementById("summary").classList.add("hidden");
    document.getElementById("charts").classList.add("hidden");
    document.getElementById("history").classList.add("hidden");
    [eloChart, timeChart, winChart, effChart, historyChart].forEach(c => c && c.destroy());
    lastDerived = null; lastMatch = null; lastElo = null;
    exportBtn.disabled = true;
    historyRuns.length = 0;
    document.querySelector("#historyTable tbody").innerHTML = "";
  });
});
