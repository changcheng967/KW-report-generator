function parseMatchLog(text) {
  const results = {};
  const avgTimeRegex = /Avg move time used by (.+?) ([0-9.]+) (\d+) moves/g;
  let match;
  while ((match = avgTimeRegex.exec(text)) !== null) {
    const [_, model, time, moves] = match;
    results[model] = { avgTime: parseFloat(time), moves: parseInt(moves) };
  }
  const nnRegex = /NN rows: (\d+)/g;
  let rows = [];
  while ((match = nnRegex.exec(text)) !== null) {
    rows.push(parseInt(match[1]));
  }
  if (rows.length) results["NN_rows"] = rows;
  return results;
}

function parseSgfSummary(text) {
  const results = {};
  const eloRegex = /(.+?):\s+(-?\d+\.\d+) \+\/- (\d+\.\d+)/g;
  let match;
  while ((match = eloRegex.exec(text)) !== null) {
    const name = match[1].trim();
    results[name] = { elo: parseFloat(match[2]), error: parseFloat(match[3]) };
  }
  const winRegex = /([A-Za-z0-9\-\s\.]+?)\s+([0-9]+\.[0-9]+)%/g;
  while ((match = winRegex.exec(text)) !== null) {
    const name = match[1].trim();
    if (!results[name]) results[name] = {};
    results[name].winPercent = parseFloat(match[2]);
  }
  return results;
}

function generateReport() {
  const matchText = document.getElementById("matchlog").value;
  const sgfText = document.getElementById("sgfsummary").value;

  const matchData = parseMatchLog(matchText);
  const sgfData = parseSgfSummary(sgfText);

  let html = "<h2>📊 Report</h2>";

  if (Object.keys(matchData).length) {
    html += "<h3>Match Log</h3><table><tr><th>Model</th><th>Avg Time</th><th>Moves</th></tr>";
    for (const [model, data] of Object.entries(matchData)) {
      if (model === "NN_rows") continue;
      html += `<tr><td>${model}</td><td>${data.avgTime}</td><td>${data.moves}</td></tr>`;
    }
    html += "</table>";
  }

  if (Object.keys(sgfData).length) {
    html += "<h3>Elo Summary</h3><table><tr><th>Model</th><th>Win%</th><th>Elo</th><th>Error</th></tr>";
    for (const [model, data] of Object.entries(sgfData)) {
      html += `<tr><td>${model}</td><td>${data.winPercent || "-"}%</td><td>${data.elo || "-"} </td><td>${data.error || "-"}</td></tr>`;
    }
    html += "</table>";
  }

  document.getElementById("report").innerHTML = html;
  document.getElementById("report").classList.remove("hidden");
  document.getElementById("charts").classList.remove("hidden");

  // Charts
  const ctxElo = document.getElementById("eloChart").getContext("2d");
  const ctxTime = document.getElementById("timeChart").getContext("2d");
  const ctxWin = document.getElementById("winChart").getContext("2d");

  const eloLabels = Object.keys(sgfData);
  const eloValues = eloLabels.map(m => sgfData[m].elo || 0);

  new Chart(ctxElo, {
    type: 'bar',
    data: { labels: eloLabels, datasets: [{ label: 'Elo', data: eloValues, backgroundColor: '#3b82f6' }] },
    options: { responsive: true }
  });

  const timeLabels = Object.keys(matchData).filter(m => m !== "NN_rows");
  const timeValues = timeLabels.map(m => matchData[m].avgTime);

  new Chart(ctxTime, {
    type: 'bar',
    data: { labels: timeLabels, datasets: [{ label: 'Avg Move Time (s)', data: timeValues, backgroundColor: '#10b981' }] },
    options: { responsive: true }
  });

  const winLabels = Object.keys(sgfData);
  const winValues = winLabels.map(m => sgfData[m].winPercent || 0);

  new Chart(ctxWin, {
    type: 'pie',
    data: { labels: winLabels, datasets: [{ data: winValues, backgroundColor: ['#3b82f6','#f59e0b','#ef4444','#10b981'] }] },
   
