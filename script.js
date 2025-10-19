async function fetchText(path) {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function parseMatchLog(text) {
  const models = {};
  const avgTimeRegex = /Avg move time used by (.+?)\s+([0-9.]+)\s+(\d+)\s+moves/g;
  let m;
  while ((m = avgTimeRegex.exec(text)) !== null) {
    const [, model, time, moves] = m;
    if (!models[model]) models[model] = { avgTime: 0, moves: null, nnRows: 0 };
    models[model].avgTime = parseFloat(time);
    models[model].moves = models[model].moves === null ? parseInt(moves) : Math.min(models[model].moves, parseInt(moves));
  }
  const nnRegex = /NN rows:\s+(\d+)/g;
  const rows = [];
  while ((m = nnRegex.exec(text)) !== null) rows.push(parseInt(m[1]));
  const keys = Object.keys(models);
  for (let i = 0; i < keys.length && i < rows.length; i++) {
    models[keys[i]].nnRows = rows[i];
  }
  return models;
}

function parseSgfSummary(text) {
  const results = {};
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
  const winPct = /([A-Za-z0-9\-\s\.]+?)\s+([0-9]+\.[0-9]+)%/g;
  while ((m = winPct.exec(text)) !== null) {
    const name = m[1].trim();
    const winp = parseFloat(m[2]);
    if (!results[name]) results[name] = {};
    results[name].winPercent = winp;
  }
  return results;
}

function computeEfficiency(elo, time) {
  return (elo !== undefined && time) ? (elo / time) : null;
}

async function loadRuns() {
  const status = document.getElementById("status");
  status.textContent = "Loading runs…";

  const manifest = await fetchText("runs.json");
  if (!manifest) {
    status.textContent = "Could not load runs.json";
    return;
  }
  const runList = JSON.parse(manifest).runs;
  const results = [];

  for (const run of runList) {
    const matchText = await fetchText(`${run}/match.log`);
    const sgfText = await fetchText(`${run}/output.log`);
    if (matchText && sgfText) {
      const matchData = parseMatchLog(matchText);
      const sgfData = parseSgfSummary(sgfText);
      results.push({ run, matchData, sgfData });
    }
  }

  renderComparison(results);
  status.textContent = "Runs loaded.";
}

function renderComparison(runsData) {
  const tbody = document.querySelector("#comparisonTable tbody");
  tbody.innerHTML = "";

  const eloLabels = [];
  const eloValues = [];
  const effPoints = [];

  runsData.forEach(run => {
    Object.entries(run.sgfData).forEach(([model, data]) => {
      const avgTime = run.matchData[model]?.avgTime;
      const nnRows = run.matchData[model]?.nnRows;
      const eff = computeEfficiency(data.elo, avgTime);

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${run.run}</td>
        <td>${model}</td>
        <td>${data.winPercent ?? "-"}%</td>
        <td>${data.elo ?? "-"} ${data.error ? "±" + data.error : ""}</td>
        <td>${avgTime ?? "-"}</td>
        <td>${nnRows ?? "-"}</td>
        <td>${eff ? eff.toFixed(2) : "-"}</td>
        <td>${data.elo > 0 ? "Stronger" : "Weaker"}</td>
      `;
      tbody.appendChild(tr);

      if (data.elo !== undefined) {
        eloLabels.push(`${run.run}-${model}`);
        eloValues.push(data.elo);
        if (eff) effPoints.push({ x: avgTime, y: eff, label: `${run.run}-${model}` });
      }
    });
  });

  document.getElementById("summary").classList.remove("hidden");
  document.getElementById("charts").classList.remove("hidden");

  // Elo chart
  new Chart(document.getElementById("eloChart").getContext("2d"), {
    type: "bar",
    data: { labels: eloLabels, datasets: [{
