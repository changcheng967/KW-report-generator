// List of runs to load (folders in repo)
const runs = ["KW28", "KW29"]; // add KW30, KW31 as you commit them

async function loadLog(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function parseMatchLog(text) {
  const result = {};
  const avgTimeRegex = /Avg move time used by (.+?)\s+([0-9.]+)\s+(\d+)/g;
  let m;
  while ((m = avgTimeRegex.exec(text)) !== null) {
    result[m[1]] = { avgTime: parseFloat(m[2]), moves: parseInt(m[3]) };
  }
  const nnRegex = /NN rows:\s+(\d+)/g;
  const rows = [];
  while ((m = nnRegex.exec(text)) !== null) rows.push(parseInt(m[1]));
  if (rows.length) result.nnRows = rows;
  return result;
}

function parseSgfSummary(text) {
  const result = {};
  const eloRegex = /^([^\n:]+?)\s*:\s*(-?\d+\.\d+)\s*\+\/-\s*(\d+\.\d+)/gm;
  let m;
  while ((m = eloRegex.exec(text)) !== null) {
    result[m[1].trim()] = { elo: parseFloat(m[2]), error: parseFloat(m[3]) };
  }
  const winRegex = /([A-Za-z0-9\-\s\.]+?)\s+([0-9]+\.[0-9]+)%/g;
  while ((m = winRegex.exec(text)) !== null) {
    const name = m[1].trim();
    if (!result[name]) result[name] = {};
    result[name].winPercent = parseFloat(m[2]);
  }
  return result;
}

function computeEfficiency(elo, time) {
  return (elo !== undefined && time) ? (elo / time) : null;
}

async function loadAllRuns() {
  const results = [];
  for (const run of runs) {
    const matchText = await loadLog(`${run}/match.log`);
    const sgfText = await loadLog(`${run}/output.log`);
    if (matchText && sgfText) {
      const matchData = parseMatchLog(matchText);
      const sgfData = parseSgfSummary(sgfText);
      results.push({ run, matchData, sgfData });
    }
  }
  return results;
}

function renderComparison(runsData) {
  const tbody = document.querySelector("#comparisonTable tbody");
  tbody.innerHTML = "";

  const eloChartData = { labels: [], datasets: [] };
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
        eloChartData.labels.push(`${run.run}-${model}`);
        eloChartData.datasets.push({ label: model, data: [data.elo] });
        if (eff) effPoints.push({ x: avgTime, y: eff, label: `${run.run}-${model}` });
      }
    });
  });

  // Elo chart
  const ctxElo = document.getElementById("eloChart").getContext("2d");
  new Chart
