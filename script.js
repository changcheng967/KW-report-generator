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
  const winRegex = /(\w.+?)\s+([0-9.]+)%/g;
  let match;
  while ((match = winRegex.exec(text)) !== null) {
    results[match[1].trim()] = { winPercent: parseFloat(match[2]) };
  }
  const eloRegex = /(.+?):\s+(-?\d+\.\d+) \+\/- (\d+\.\d+)/g;
  while ((match = eloRegex.exec(text)) !== null) {
    const name = match[1].trim();
    if (!results[name]) results[name] = {};
    results[name].elo = parseFloat(match[2]);
    results[name].error = parseFloat(match[3]);
  }
  return results;
}

function generateReport() {
  const matchText = document.getElementById("matchlog").value;
  const sgfText = document.getElementById("sgfsummary").value;

  const matchData = matchText ? parseMatchLog(matchText) : {};
  const sgfData = sgfText ? parseSgfSummary(sgfText) : {};

  let html = "<h2>📊 Match Log Summary</h2>";
  if (Object.keys(matchData).length) {
    html += "<table><tr><th>Model</th><th>Avg Move Time (s)</th><th>Moves</th></tr>";
    for (const [model, data] of Object.entries(matchData)) {
      if (model === "NN_rows") continue;
      html += `<tr><td>${model}</td><td>${data.avgTime}</td><td>${data.moves}</td></tr>`;
    }
    html += "</table>";
    if (matchData.NN_rows) {
      html += `<p><b>NN Rows:</b> ${matchData.NN_rows.join(", ")}</p>`;
    }
  } else {
    html += "<p>No match.log data parsed.</p>";
  }

  html += "<h2>📈 SGF Elo Summary</h2>";
  if (Object.keys(sgfData).length) {
    html += "<table><tr><th>Model</th><th>Win%</th><th>Elo</th><th>Error</th></tr>";
    for (const [model, data] of Object.entries(sgfData)) {
      html += `<tr><td>${model}</td><td>${data.winPercent || "-"}%</td><td>${data.elo || "-"} </td><td>${data.error || "-"}</td></tr>`;
    }
    html += "</table>";
  } else {
    html += "<p>No summarize_sgfs.py data parsed.</p>";
  }

  document.getElementById("report").innerHTML = html;

  // Charts
  const ctxElo = document.getElementById("eloChart").getContext("2d");
  const ctxTime = document.getElementById("timeChart").getContext("2d");

  const eloLabels = Object.keys(sgfData);
  const eloValues = eloLabels.map(m => sgfData[m].elo || 0);

  new Chart(ctxElo, {
    type: 'bar',
    data: {
      labels: eloLabels,
      datasets: [{
        label: 'Elo',
        data: eloValues,
        backgroundColor: ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0']
      }]
    },
    options: { responsive: true, plugins: { legend: { display: false } } }
  });

  const timeLabels = Object.keys(matchData).filter(m => m !== "NN_rows");
  const timeValues = timeLabels.map(m => matchData[m].avgTime);

  new Chart(ctxTime, {
    type: 'bar',
    data: {
      labels: timeLabels,
      datasets: [{
        label: 'Avg Move Time (s)',
        data: timeValues,
        backgroundColor: ['#03A9F4', '#E91E63']
      }]
    },
    options: { responsive: true, plugins: { legend: { display: false } } }
  });
}
