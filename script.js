// --------------------- Parsing ---------------------

function parseMatchLog(text) {
  const models = {};
  const avgTimeRegex = /Avg move time used by (.+?) ([0-9.]+) (\d+) moves/g;
  let match;
  while ((match = avgTimeRegex.exec(text)) !== null) {
    const [, model, time, moves] = match;
    if (!models[model]) models[model] = { avgTime: parseFloat(time), moves: parseInt(moves), nnRows: 0 };
    // Keep the earliest sample for moves; update avgTime each time (they stabilize)
    models[model].avgTime = parseFloat(time);
    models[model].moves = Math.min(models[model].moves || Infinity, parseInt(moves));
  }
  const nnRegex = /NN rows: (\d+)/g;
  const rowsFound = [];
  while ((match = nnRegex.exec(text)) !== null) {
    rowsFound.push(parseInt(match[1]));
  }
  // Heuristic: If two models, first NN rows vector is model A, second is model B.
  const modelKeys = Object.keys(models).filter(k => k !== "NN_rows");
  if (rowsFound.length && modelKeys.length >= 2) {
    // Assign by order of appearance at end: baseline first, challenger second
    models[modelKeys[0]].nnRows = rowsFound[0] || 0;
    models[modelKeys[1]].nnRows = rowsFound[1] || 0;
  }
  return models;
}

function parseSgfSummary(text) {
  const results = {};
  // Win% by player matrix simplified lines like: 'KW29 b18c384nbt 1018   24.5%       -'
  const winRegex = /([A-Za-z0-9\-\s\.]+?):?\s+(-?\d+\.\d+)\s*\+\/-\s*(\d+\.\d+)/g; // Elo lines
  let m;
  while ((m = winRegex.exec(text)) !== null) {
    const name = m[1].trim();
    const elo = parseFloat(m[2]);
    const err = parseFloat(m[3]);
    if (!results[name]) results[name] = {};
    results[name].elo = elo;
    results[name].error = err;
  }
  // Separate capture for win% lines
  const winPctRegex = /([A-Za-z0-9\-\s\.]+?)\s+([0-9]+\.[0-9]+)%/g;
  while ((m = winPctRegex.exec(text)) !== null) {
    const name = m[1].trim();
    const winp = parseFloat(m[2]);
    if (!results[name]) results[name] = {};
    results[name].winPercent = winp;
  }
  return results;
}

// --------------------- Derivations ---------------------

function computeDerived(matchModels, eloData, baselineNameGuess = null) {
  // Pick baseline as the strongest positive Elo if present, else first model
  let baseline = baselineNameGuess;
  if (!baseline) {
    const entries = Object.entries(eloData);
    if (entries.length) {
      entries.sort((a, b) => (b[1].elo ?? 0) - (a[1].elo ?? 0));
      baseline = entries[0][0];
    } else {
      baseline = Object.keys(matchModels)[0];
    }
  }

  const baselineTime = matchModels[baseline]?.avgTime || null;
  const rows = [];

  for (const [model, m] of Object.entries(matchModels)) {
    const elo = eloData[model]?.elo ?? null;
    const winp = eloData[model]?.winPercent ?? null;
    const err = eloData[model]?.error ?? null;

    const relativeSpeed =
      baselineTime && m.avgTime ? (baselineTime / m.avgTime) : null;

    const eloPerRow =
      elo !== null && m.nnRows ? (elo / m.nnRows) : null;

    const efficiency =
      elo !== null && m.avgTime ? (elo / m.avgTime) : null;

    const verdict =
      elo !== null
        ? elo > 0 ? "Stronger than baseline" : elo < 0 ? "Weaker than baseline" : "Equal"
        : "Unknown";

    rows.push({
      model,
      baseline,
      avgTime: m.avgTime ?? null,
      moves: m.moves ?? null,
      nnRows: m.nnRows ?? null,
      winPercent: winp,
      elo,
      error: err,
      relativeSpeed,
      eloPerRow,
      efficiency,
      verdict,
    });
  }
  return { baseline, rows };
}

// --------------------- Rendering ---------------------

let eloChart, timeChart, winChart, effChart;

function renderTables(matchModels, eloData, derived) {
  // Match table
  const mtBody = document.querySelector("#matchTable tbody");
  mtBody.innerHTML = "";
  for (const [model, m] of Object.entries(matchModels)) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${model}</td>
      <td>${(m.avgTime ?? "-")}</td>
      <td>${(m.moves ?? "-")}</td>
      <td>${(m.nnRows ?? "-")}</td>
    `;
    mtBody.appendChild(tr);
  }

  // Elo table
  const etBody = document.querySelector("#eloTable tbody");
  etBody.innerHTML = "";
  for (const [model, data] of Object.entries(eloData)) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${model}</td>
      <td>${data.winPercent !== undefined ? (data.winPercent + "%") : "-"}</td>
      <td>${data.elo !== undefined ? data.elo : "-"}</td>
      <td>${data.error !== undefined ? ("±" + data.error) : "-"}</td>
    `;
    etBody.appendChild(tr);
  }

  // Derived table
  const dtBody = document.querySelector("#derivedTable tbody");
  dtBody.innerHTML = "";
  derived.rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.model}</td>
      <td>${r.baseline}</td>
      <td>${r.relativeSpeed !== null ? r.relativeSpeed.toFixed(2) : "-"}</td>
      <td>${r.eloPerRow !== null ? r.eloPerRow.toExponential(3) : "-"}</td>
      <td>${r.efficiency !== null ? r.efficiency.toFixed(2) : "-"}</td>
      <td style="color:${r.verdict.includes("Stronger") ? "#34d399" : r.verdict.includes("Weaker") ? "#f87171" : "#9ca3af"}">${r.verdict}</td>
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

  // Destroy previous charts to avoid overlap
  [eloChart, timeChart, winChart, effChart].forEach(c => c && c.destroy());

  // Elo chart
  eloChart = new Chart(document.getElementById("eloChart").getContext("2d"), {
    type: "bar",
    data: {
      labels: labelsElo,
      datasets: [{
        label: "Elo",
        data: dataElo,
        backgroundColor: labelsElo.map(l => l === derived.baseline ? "#60a5fa" : "#34d399")
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });

  // Time chart
  timeChart = new Chart(document.getElementById("timeChart").getContext("2d"), {
    type: "bar",
    data: {
      labels: labelsTime,
      datasets: [{
        label: "Avg move time (s)",
        data: dataTime,
        backgroundColor: labelsTime.map(l => l === derived.baseline ? "#60a5fa" : "#f59e0b")
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });

  // Win% chart
  winChart = new Chart(document.getElementById("winChart").getContext("2d"), {
    type: "pie",
    data: {
      labels: labelsWin,
      datasets: [{
        label: "Win%",
        data: dataWin,
        backgroundColor: ["#60a5fa", "#34d399", "#f59e0b", "#f87171", "#a78bfa", "#22c55e", "#06b6d4"]
      }]
    },
    options: { responsive: true }
  });

  // Efficiency scatter
  effChart = new Chart(document.getElementById("effChart").getContext("2d"), {
    type: "scatter",
    data: {
      datasets: [{
        label: "Efficiency (Elo/sec) vs Relative speed",
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

// --------------------- Export ---------------------

function exportCSV(derived) {
  const headers = [
    "Model",
    "Baseline",
    "AvgMoveTime(s)",
    "TotalMoves(sample)",
    "NNRows",
    "WinPercent",
    "Elo",
    "EloError",
    "RelativeSpeed",
    "EloPerNNRow",
    "Efficiency(Elo_per_sec)",
    "Verdict"
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
      r.relativeSpeed !== null ? r.relativeSpeed.toFixed(4) : "",
      r.eloPerRow !== null ? r.eloPerRow.toExponential(6) : "",
      r.efficiency !== null ? r.efficiency.toFixed(4) : "",
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

// --------------------- Wire-up ---------------------

document.addEventListener("DOMContentLoaded", () => {
  const generateBtn = document.getElementById("generateBtn");
  const clearBtn = document.getElementById("clearBtn");
  const exportBtn = document.getElementById("exportBtn");

  generateBtn.addEventListener("click", () => {
    const matchText = document.getElementById("matchlog").value.trim();
    const sgfText = document.getElementById("sgfsummary").value.trim();

    if (!matchText && !sgfText) {
      alert("Please paste either match.log or summarize_sgfs.py output.");
      return;
    }

    const matchModels = matchText ? parseMatchLog(matchText) : {};
    const eloData = sgfText ? parseSgfSummary(sgfText) : {};

    const derived = computeDerived(matchModels, eloData);

    renderTables(matchModels, eloData, derived);
    renderCharts(matchModels, eloData, derived);

    document.getElementById("summary").classList.remove("hidden");
    document.getElementById("charts").classList.remove("hidden");
    exportBtn.disabled = false;

    // Save last report to window for export
    window.__kw_last_derived = derived;
  });

  clearBtn.addEventListener("click", () => {
    document.getElementById("matchlog").value = "";
    document.getElementById("sgfsummary").value = "";
    document.getElementById("summary").classList.add("hidden");
    document.getElementById("charts").classList.add("hidden");
    if (window.__kw_last_derived) delete window.__kw_last_derived;
    document.getElementById("exportBtn").disabled = true;
  });

  exportBtn.addEventListener("click", () => {
    if (!window.__kw_last_derived) return;
    exportCSV(window.__kw_last_derived);
  });
});
