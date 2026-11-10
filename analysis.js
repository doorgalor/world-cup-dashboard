// Data analysis section: charts drawn straight on the page (no panels). Data comes from
// web/data/countries.json (scripts/build_map_data.py). Uses FLAG_URL, escapeHtml and RESULT_TEXT
// from app.js.

// How far a team got, left to right; 3rd/4th share "Semi-finals", winner/runner-up share "Final".
const FINISH_STAGES = ["Group stage", "Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"];
const FINISH_OF = {
  "Eliminated group stage": "Group stage", "Eliminated round of 32": "Round of 32",
  "Eliminated round of 16": "Round of 16", "Eliminated quarter-finals": "Quarter-finals",
  "Third place": "Semi-finals", "Fourth place": "Semi-finals", "Runner-up": "Final", Winner: "Final",
};

const FINISH_SHORT = {
  "Group stage": "Groups", "Round of 32": "R32", "Round of 16": "R16",
  "Quarter-finals": "QF", "Semi-finals": "SF", Final: "Final",
};

const analysisRoot =document.getElementById("analysis-content");
const analysisTip = Object.assign(document.createElement("div"), { className: "tooltip", hidden: true });
document.body.append(analysisTip);

Promise.all([d3.json("data/countries.json"), d3.json("data/players.json"), d3.json("data/league_players.json")])
  .then(([countries, players, league]) => {
    analysisRoot.innerHTML = "";
    // Chart 1 and the league table share a row on wide screens.
    const row = Object.assign(document.createElement("div"), { className: "chart-row" });
    analysisRoot.append(row);
    finishVsLeagueChart(countries, row);
    topLeaguesChart(countries, players, row);
    leagueRankVsShareChart(countries);
    whoShowedUpChart(countries, players, league);
    const lamine = players.players.find((p) => p.name === "Lamine Yamal");
    if (lamine) {
      lamineDumbbellChart(lamine, players, league);
      lamineScatters(lamine, players, league);
    }
  });

function chartBlock(title, subtitle, parent = analysisRoot, extraClass = "") {
  const el = document.createElement("figure");
  el.className = `chart ${extraClass}`.trim();
  el.innerHTML = `
    <figcaption>
      <h3 class="chart-title">${title}</h3>
      <p class="chart-subtitle">${subtitle}</p>
    </figcaption>
    <div class="chart-body"></div>`;
  parent.append(el);
  return el.querySelector(".chart-body");
}

// ---------- 1. Finish vs share of World Cup players in the country's top league ----------

function finishVsLeagueChart(countries, parent) {
  const teams = Object.values(countries).filter((c) => c.worldCup).map((c) => ({
    name: c.name,
    flag: c.flag,
    finish: FINISH_OF[c.worldCup.result],
    result: c.worldCup.result,
    league: c.league?.name ?? "",
    share: c.league?.share ?? 0,
    players: c.league?.players ?? 0,
  }));

  const body = chartBlock(
    "Did a strong domestic league mean a deep run?",
    "Each flag is a team, placed by how far it went. Height is the share of all World Cup squad players " +
    "who play in that country's top league (log scale).<br>" +
    "Here we can see that a stronger domestic league is loosely correlated with a better placement. " +
    "Countries like Morocco and Canada overperformed compared to how many players they sent to the World Cup, " +
    "whereas Germany, for the third time in a row failing to make the Round of 16, underperformed. " +
    "Although this is not the best predictive metric, it does help to see the Cinderella stories of this year.",
    parent);

  const draw = () => {
    const width = body.clientWidth;
    const height = Math.max(340, Math.min(480, width * 0.55));
    const m = { top: 12, right: 16, bottom: 36, left: 52 };
    const zeroGap = 28; // the "0%" row sits below a break in the log axis
    const zeroY = height - m.bottom - 6;
    const x = d3.scalePoint(FINISH_STAGES, [m.left, width - m.right]).padding(0.6);
    const step = x.step();
    const positive = teams.filter((t) => t.share > 0);
    const y = d3.scaleLog([0.05, 20], [zeroY - zeroGap, m.top]).clamp(true);
    const yOf = (t) => (t.share > 0 ? y(t.share) : zeroY);
    // Flags as markers; collisions use their width.
    const flagW = width < 600 ? 14 : 18;
    const flagH = flagW * 0.75;
    const r = flagW / 2;

    // Beeswarm: dots keep their exact height and spread sideways only as far as they must.
    const nodes = teams.map((t) => ({ ...t, x: x(t.finish), y: yOf(t), fy: yOf(t) }));
    const sim = d3.forceSimulation(nodes)
      .force("x", d3.forceX((d) => x(d.finish)).strength(0.15))
      .force("collide", d3.forceCollide(r + 1.5))
      .stop();
    for (let i = 0; i < 300; i++) {
      sim.tick();
      for (const d of nodes) d.x = Math.max(x(d.finish) - step * 0.4, Math.min(x(d.finish) + step * 0.4, d.x));
    }

    const svg = d3.create("svg").attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img").attr("aria-label", "Teams by World Cup finish against their top league's share of World Cup players, log scale");

    // Log gridlines, only at the labelled 1-2-5 values.
    const major = [0.1, 0.2, 0.5, 1, 2, 5, 10];
    svg.append("g").attr("class", "chart-grid").selectAll("line").data(major).join("line")
      .attr("x1", m.left).attr("x2", width - m.right).attr("y1", (v) => y(v)).attr("y2", (v) => y(v));
    svg.append("g").attr("class", "chart-axis").selectAll("text").data(major).join("text")
      .attr("x", m.left - 8).attr("y", (v) => y(v)).attr("dy", "0.32em").attr("text-anchor", "end")
      .text((v) => `${v}%`);

    // The zero row, set apart by a small break mark on the axis.
    svg.append("line").attr("class", "chart-grid")
      .attr("x1", m.left).attr("x2", width - m.right).attr("y1", zeroY).attr("y2", zeroY);
    svg.append("text").attr("class", "chart-axis-text").attr("x", m.left - 8).attr("y", zeroY)
      .attr("dy", "0.32em").attr("text-anchor", "end").text("0%");
    const breakY = zeroY - zeroGap / 2;
    svg.append("path").attr("class", "chart-break")
      .attr("d", `M${m.left - 4},${breakY + 3} l8,-6 M${m.left - 4},${breakY + 7} l8,-6`);
    svg.append("line").attr("class", "chart-yaxis").attr("x1", m.left).attr("x2", m.left)
      .attr("y1", m.top).attr("y2", breakY - 2);
    svg.append("line").attr("class", "chart-yaxis").attr("x1", m.left).attr("x2", m.left)
      .attr("y1", breakY + 6).attr("y2", zeroY);

    // Stage labels, abbreviated when the columns get narrow.
    svg.append("g").attr("class", "chart-axis").selectAll("text").data(FINISH_STAGES).join("text")
      .attr("x", (s) => x(s)).attr("y", height - m.bottom + 22).attr("text-anchor", "middle")
      .text((s) => (step < 95 ? FINISH_SHORT[s] : s));

    // Median per stage: a short line across the column (on the zero row if the median is 0).
    const medians = d3.rollups(teams, (v) => d3.median(v, (t) => t.share), (t) => t.finish);
    svg.append("g").selectAll("line").data(medians).join("line")
      .attr("class", "chart-median")
      .attr("x1", ([s]) => x(s) - step * 0.42).attr("x2", ([s]) => x(s) + step * 0.42)
      .attr("y1", ([, v]) => (v > 0 ? y(v) : zeroY)).attr("y2", ([, v]) => (v > 0 ? y(v) : zeroY));

    const dots = svg.append("g").selectAll("g").data(nodes).join("g")
      .attr("class", "chart-flag").attr("transform", (d) => `translate(${d.x},${d.y})`);
    dots.append("rect").attr("class", "chart-flag-ring")
      .attr("x", -flagW / 2 - 1).attr("y", -flagH / 2 - 1).attr("width", flagW + 2).attr("height", flagH + 2).attr("rx", 2);
    dots.append("image").attr("href", (d) => FLAG_URL(d.flag))
      .attr("x", -flagW / 2).attr("y", -flagH / 2).attr("width", flagW).attr("height", flagH)
      .attr("preserveAspectRatio", "none");

    // Name the standouts directly; everyone else is on hover.
    const labelled = new Set([...positive].sort((a, b) => b.share - a.share).slice(0, 4).map((d) => d.name)
      .concat(nodes.filter((d) => d.finish === "Final").map((d) => d.name)));
    svg.append("g").selectAll("text").data(nodes.filter((d) => labelled.has(d.name))).join("text")
      .attr("class", "chart-label").attr("x", (d) => d.x + r + 5).attr("y", (d) => d.y).attr("dy", "0.32em")
      .text((d) => d.name);

    // Hover: generous invisible targets around each dot.
    svg.append("g").selectAll("circle").data(nodes).join("circle")
      .attr("class", "chart-hit").attr("cx", (d) => d.x).attr("cy", (d) => d.y).attr("r", r + 5)
      .on("pointerenter", (e, d) => {
        dots.classed("is-active", (n) => n === d);
        analysisTip.innerHTML = `
          <div class="tt-head">${escapeHtml(d.name)} <img src="${FLAG_URL(d.flag)}" alt=""></div>
          <div class="tt-rank">${escapeHtml(RESULT_TEXT[d.result] ?? d.result)}</div>
          <div class="tt-league">
            <div class="tt-label">Top league</div>
            <div class="tt-league-name">${escapeHtml(d.league || "–")}</div>
            <div>${d.share.toFixed(d.share < 1 ? 2 : 1)}% of World Cup players (${d.players})</div>
          </div>`;
        analysisTip.hidden = false;
        placeTip(e);
      })
      .on("pointermove", placeTip)
      .on("pointerleave", () => { dots.classed("is-active", false); analysisTip.hidden = true; });

    body.replaceChildren(svg.node(), legendNote());
  };

  draw();
  let last = body.clientWidth;
  new ResizeObserver(() => { if (Math.abs(body.clientWidth - last) > 8) { last = body.clientWidth; draw(); } }).observe(body);
}

// ---------- 1b. Leagues ranked by World Cup squad players ----------

const TOP_LEAGUES = 15;

function topLeaguesChart(countries, players, parent) {
  const flagOf = Object.fromEntries(Object.values(countries).map((c) => [c.name, c.flag]));
  const squad = players.players.filter((p) => !p.isAverage);
  const rows = d3.rollups(squad.filter((p) => p.league), (v) => v.length, (p) => p.league)
    .map(([league, n]) => {
      const p = squad.find((q) => q.league === league);
      return { league, n, flag: flagOf[p.leagueCountry], country: p.leagueCountry };
    })
    .sort((a, b) => b.n - a.n).slice(0, TOP_LEAGUES);
  const top5 = d3.sum(rows.slice(0, 5), (d) => d.n);

  const body = chartBlock(
    "Which leagues supplied the World Cup?",
    `Squad players by the league their club plays in. The top five leagues supplied ${top5} of ` +
    `${squad.length} players (${Math.round((100 * top5) / squad.length)}%).`,
    parent, "chart-narrow");

  const draw = () => {
    const width = body.clientWidth;
    // Rows grow so the table ends level with chart 1 beside it (when they share a row).
    const beside = parent.querySelector(".chart .chart-body svg");
    const sideBySide = beside && beside.getBoundingClientRect().top < body.getBoundingClientRect().top + 400
      && parent.querySelector(".chart") !== body.closest(".chart");
    const target = sideBySide ? beside.getBoundingClientRect().bottom - body.getBoundingClientRect().top : 0;
    const rowH = Math.max(22, Math.min(40, (target - 8) / rows.length));
    const big = rowH > 28;
    const m = { top: 4, right: 34, bottom: 4, left: Math.min(big ? 230 : 170, width * 0.48) };
    const height = m.top + rows.length * rowH + m.bottom;
    const x = d3.scaleLinear([0, rows[0].n], [m.left, width - m.right]);
    const svg = d3.create("svg").attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img").attr("aria-label", "Leagues ranked by number of World Cup squad players");
    const g = svg.append("g").selectAll("g").data(rows).join("g")
      .attr("transform", (d, i) => `translate(0,${m.top + i * rowH + rowH / 2})`);
    g.append("text").attr("class", "chart-axis-text").attr("x", 0).attr("dy", "0.32em")
      .text((d, i) => `${i + 1}`);
    const fw = big ? 20 : 14, fh = fw * 0.75, nx = 22 + fw + 8;
    g.append("rect").attr("class", "chart-flag-ring").attr("x", 21).attr("y", -fh / 2 - 1)
      .attr("width", fw + 2).attr("height", fh + 2).attr("rx", 2);
    g.filter((d) => d.flag).append("image").attr("href", (d) => FLAG_URL(d.flag)).attr("x", 22).attr("y", -fh / 2)
      .attr("width", fw).attr("height", fh).attr("preserveAspectRatio", "none");
    g.append("text").attr("class", "chart-bar-label").classed("is-big", big).attr("x", nx).attr("dy", "0.32em")
      .text((d) => d.league);
    g.append("rect").attr("class", "chart-bar").attr("x", m.left).attr("y", big ? -8 : -6).attr("height", big ? 16 : 12).attr("rx", big ? 8 : 6)
      .attr("width", (d) => Math.max(12, x(d.n) - m.left));
    g.append("text").attr("class", "chart-axis-text").attr("x", (d) => x(d.n) + 6).attr("dy", "0.32em")
      .text((d) => d.n);
    g.append("title").text((d) => `${d.league} (${d.country}): ${d.n} World Cup squad players`);
    body.replaceChildren(svg.node());
    // Text can only be measured once it's on the page.
    svg.selectAll(".chart-bar-label").each(function () { truncate(this, m.left - nx - 6); });
  };

  draw();
  requestAnimationFrame(draw); // again once chart 1 beside it has laid out
  let last = body.clientWidth;
  new ResizeObserver(() => { if (Math.abs(body.clientWidth - last) > 8) { last = body.clientWidth; draw(); } }).observe(body);
  addEventListener("resize", () => requestAnimationFrame(draw));
}

function truncate(el, max) {
  let t = el.textContent;
  while (t.length > 3 && el.getComputedTextLength() > max) { t = t.slice(0, -1); el.textContent = `${t.trimEnd()}…`; }
}

// ---------- 2. Domestic league rank vs share of World Cup players ----------

function leagueRankVsShareChart(countries) {
  // One flag per country whose top league had at least one World Cup squad player.
  const leagues = Object.values(countries).filter((c) => c.league?.share > 0 && c.league.rank && c.league.rank <= 250).map((c) => ({
    name: c.name, flag: c.flag, league: c.league.name, rank: c.league.rank,
    share: c.league.share, players: c.league.players,
  }));

  const body = chartBlock(
    "Domestic league rank vs share of WC players",
    "Each flag is a country's top league, placed by its Opta league rank and the share of all World Cup " +
    "squad players who play there (both log scale). The dashed line is the best fit. Leagues with no World Cup players, or ranked below #250, are left out.",
    analysisRoot, "chart-side");

  const draw = () => {
    const width = body.clientWidth;
    const height = Math.max(320, Math.min(440, width * 0.5));
    const m = { top: 12, right: 24, bottom: 40, left: 52 };
    const x = d3.scaleLog([250, 1], [m.left, width - m.right]);
    const y = d3.scaleLog([0.05, 20], [height - m.bottom, m.top]).clamp(true);
    const flagW = width < 600 ? 14 : 18, flagH = flagW * 0.75;

    const svg = d3.create("svg").attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img").attr("aria-label", "Opta league rank against share of World Cup players, log scales");

    const yTicks = [0.1, 0.2, 0.5, 1, 2, 5, 10];
    const xTicks = [200, 100, 50, 20, 10, 5, 2, 1];
    const grid = svg.append("g").attr("class", "chart-grid");
    grid.selectAll(".gy").data(yTicks).join("line")
      .attr("x1", m.left).attr("x2", width - m.right).attr("y1", y).attr("y2", y);
    grid.selectAll(".gx").data(xTicks).join("line")
      .attr("x1", x).attr("x2", x).attr("y1", m.top).attr("y2", height - m.bottom);
    svg.append("g").attr("class", "chart-axis").selectAll("text").data(yTicks).join("text")
      .attr("x", m.left - 8).attr("y", y).attr("dy", "0.32em").attr("text-anchor", "end").text((v) => `${v}%`);
    svg.append("g").attr("class", "chart-axis").selectAll("text").data(xTicks).join("text")
      .attr("x", x).attr("y", height - m.bottom + 18).attr("text-anchor", "middle").text((v) => `#${v}`);
    svg.append("text").attr("class", "chart-axis-text").attr("x", (m.left + width - m.right) / 2)
      .attr("y", height - 4).attr("text-anchor", "middle").text("Opta league rank (1 = strongest)");

    // Least-squares fit in log-log space, drawn across the full rank range.
    const lx = leagues.map((d) => Math.log10(d.rank)), ly = leagues.map((d) => Math.log10(d.share));
    const mx = d3.mean(lx), my = d3.mean(ly);
    const slope = d3.sum(lx, (v, i) => (v - mx) * (ly[i] - my)) / d3.sum(lx, (v) => (v - mx) ** 2);
    const fit = (r) => 10 ** (my + slope * (Math.log10(r) - mx));
    svg.append("line").attr("class", "chart-fit")
      .attr("x1", x(250)).attr("y1", y(fit(250))).attr("x2", x(1)).attr("y2", y(fit(1)));

    const nodes = leagues.map((d) => ({ ...d, cx: x(d.rank), cy: y(d.share) }));
    const dots = svg.append("g").selectAll("g").data(nodes).join("g")
      .attr("class", "chart-flag").attr("transform", (d) => `translate(${d.cx},${d.cy})`);
    dots.append("rect").attr("class", "chart-flag-ring")
      .attr("x", -flagW / 2 - 1).attr("y", -flagH / 2 - 1).attr("width", flagW + 2).attr("height", flagH + 2).attr("rx", 2);
    dots.append("image").attr("href", (d) => FLAG_URL(d.flag))
      .attr("x", -flagW / 2).attr("y", -flagH / 2).attr("width", flagW).attr("height", flagH)
      .attr("preserveAspectRatio", "none");

    // Name the five biggest suppliers; everyone else is on hover.
    const labelled = [...nodes].sort((a, b) => b.share - a.share).slice(0, 5);
    svg.append("g").selectAll("text").data(labelled).join("text")
      .attr("class", "chart-label").attr("x", (d) => d.cx - flagW / 2 - 5).attr("y", (d) => d.cy).attr("dy", "0.32em")
      .attr("text-anchor", "end").text((d) => d.league);

    svg.append("g").selectAll("circle").data(nodes).join("circle")
      .attr("class", "chart-hit").attr("cx", (d) => d.cx).attr("cy", (d) => d.cy).attr("r", flagW / 2 + 4)
      .on("pointerenter", (e, d) => {
        dots.classed("is-active", (n) => n === d);
        analysisTip.innerHTML = `
          <div class="tt-head">${escapeHtml(d.name)} <img src="${FLAG_URL(d.flag)}" alt=""></div>
          <div class="tt-league">
            <div class="tt-league-name">${escapeHtml(d.league)}</div>
            <div>Opta rank #${d.rank}</div>
            <div>${d.share.toFixed(d.share < 1 ? 2 : 1)}% of World Cup players (${d.players})</div>
          </div>`;
        analysisTip.hidden = false;
        placeTip(e);
      })
      .on("pointermove", placeTip)
      .on("pointerleave", () => { dots.classed("is-active", false); analysisTip.hidden = true; });

    body.replaceChildren(svg.node());
  };

  draw();
  let last = body.clientWidth;
  new ResizeObserver(() => { if (Math.abs(body.clientWidth - last) > 8) { last = body.clientWidth; draw(); } }).observe(body);
}

// ---------- 3. Who showed up: club attacking output vs World Cup attacking output ----------

const SCATTER_MIN_DEFAULT = 180;
const SCATTER_COLORS = { MF: "#7f9cd9", FW: "#d9a77f" };
const STEP_UP = "#3ddc84";
const DROP_OFF = "#ff6b6b";
const touchOnly = window.matchMedia("(hover: none)").matches;

function whoShowedUpChart(countries, players, league) {
  // xG + xA per 90 on both sides. Club form is the 2025/26 (MLS: 2026) row with the most minutes (900+).
  const k = { xg: league.keys.indexOf("xg"), xa: league.keys.indexOf("xa"),
    goals: league.keys.indexOf("goals"), assists: league.keys.indexOf("assists") };
  const club = new Map();
  for (const r of league.players) {
    if (r.mins < league.minMinutes) continue;
    if (!club.has(r.oid) || r.mins > club.get(r.oid).mins) club.set(r.oid, r);
  }
  const flagOf = Object.fromEntries(Object.values(countries).map((c) => [c.name, c.flag]));
  const all = players.players.filter((p) => (p.pos === "MF" || p.pos === "FW") && club.has(p.optaId)).map((p) => {
    const r = club.get(p.optaId);
    const cxg = ((r.v[k.xg] ?? 0) / r.mins) * 90, cxa = ((r.v[k.xa] ?? 0) / r.mins) * 90;
    const wxg = p.stats.xg?.[0] ?? 0, wxa = p.stats.xa?.[0] ?? 0;
    return {
      id: p.optaId, name: p.name, surname: surname(p.name), pos: p.pos, flag: p.flag || flagOf[p.country],
      country: p.country, photo: p.photo, club: p.club, league: league.leagueNames[r.league] ?? r.league,
      mins: p.mins, clubMins: r.mins, season: String(r.season).replace(/^20(\d\d)\/20?(\d\d)$/, "$1/$2"), wcG: p.goals ?? 0, wcA: p.assists ?? 0,
      clubG: r.v[k.goals] ?? 0, clubA: r.v[k.assists] ?? 0, cxg, cxa, wxg, wxa, clubV: cxg + cxa, wcV: wxg + wxa,
      // Rounded to the 2 decimals shown, so a player level with club form (0.00) counts as stepping up.
      diff: Math.round((wxg + wxa - cxg - cxa) * 100) / 100 + 0, search: fold(p.name),
    };
  });
  if (!all.length) return;
  // Everyone else the search might look for, to say why they're not on the chart.
  const inChart = new Set(all.map((d) => d.id));
  const missing = players.players.filter((p) => (p.pos === "MF" || p.pos === "FW") && !p.isAverage && !inChart.has(p.optaId))
    .map((p) => ({ name: p.name, search: fold(p.name), why: league.leagues.includes(p.leagueId)
      ? `he played under ${league.minMinutes} league minutes for ${p.club} in ${p.league === "Major League Soccer" ? "2026" : "2025/26"}`
      : `there are no 2025/26 stats for ${p.league || "his league"}` }));

  const base = all.filter((d) => d.mins >= SCATTER_MIN_DEFAULT);
  const quieter = base.filter((d) => d.diff < 0).length;
  const top = d3.greatest(base, (d) => d.diff), worst = d3.least(base, (d) => d.diff);
  const body = chartBlock(
    "Who showed up at the World Cup?",
    "Each dot is a player. Across is their attacking output per 90 (xG + xA) for their club in 2025/26 (2026 for MLS); " +
    "up is the same at the World Cup.<br>" +
    `${quieter} of ${base.length} midfielders and forwards (${Math.round((100 * quieter) / base.length)}%) produced less ` +
    `for their country than for their club, and the typical player fell from ${fmt(d3.median(base, (d) => d.clubV))} ` +
    `to ${fmt(d3.median(base, (d) => d.wcV))} per 90. ${top.name} stepped up the most (+${fmt(top.diff)}), ` +
    `while ${worst.name} went from ${fmt(worst.clubV)} to ${fmt(worst.wcV)}.`);

  body.closest(".chart").classList.add("chart-scatter");
  const leagues = [...new Set(all.map((d) => d.league))].sort();
  const maxMins = d3.max(all, (d) => d.mins);
  const state = { pos: "all", league: "all", min: SCATTER_MIN_DEFAULT, focus: null };

  const controls = document.createElement("div");
  controls.className = "scatter-controls";
  controls.innerHTML = `
    <select class="filter-btn" data-k="pos" aria-label="Position">
      <option value="all">Midfielders and forwards</option><option value="MF">Midfielders</option><option value="FW">Forwards</option>
    </select>
    <select class="filter-btn" data-k="league" aria-label="League">
      <option value="all">All leagues</option>${leagues.map((l) => `<option>${escapeHtml(l)}</option>`).join("")}
    </select>
    <label class="scatter-range">World Cup minutes <b>${state.min}+</b>
      <input type="range" min="90" max="${Math.min(600, maxMins)}" step="30" value="${state.min}"></label>
    <input class="filter-btn scatter-search" type="search" placeholder="Find a player" list="scatter-names" aria-label="Find a player">
    <span class="scatter-msg tt-note"></span>
    <datalist id="scatter-names">${[...all, ...missing].sort((a, b) => a.name.localeCompare(b.name)).map((d) => `<option value="${escapeHtml(d.name)}">`).join("")}</datalist>`;
  body.before(controls);

  const card = Object.assign(document.createElement("div"), { className: "tooltip scatter-card", hidden: true });
  const lists = document.createElement("div");
  lists.className = "scatter-lists";
  const note = document.createElement("p");
  note.className = "chart-note sc-note";
  const foot = Object.assign(document.createElement("div"), { className: "scatter-foot" });
  const sidePanel = Object.assign(document.createElement("div"), { className: "scatter-side" });
  // On wide screens the description sits in the side column, under the rankings.
  const sideDesc = Object.assign(document.createElement("p"), { className: "chart-subtitle scatter-side-desc" });
  sideDesc.innerHTML = body.closest(".chart").querySelector(".chart-subtitle").innerHTML;
  const source = Object.assign(document.createElement("p"), {
    className: "chart-source", textContent: "Player stats: Opta (personal use only). Squads and photos: Wikipedia." });

  controls.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.k) state[t.dataset.k] = t.value;
    if (t.type === "range") { state.min = +t.value; t.previousElementSibling.textContent = `${state.min}+`; }
    if (t.type === "search") {
      const q = fold(t.value.trim());
      const hit = q && all.find((d) => d.search === q);
      state.focus = hit?.id ?? null;
      const gone = q && !hit && missing.find((d) => d.search === q);
      let msg = gone ? `${gone.name} isn't on the chart: ${gone.why}.` : "";
      if (hit && (hit.mins < state.min || (state.pos !== "all" && hit.pos !== state.pos)
        || (state.league !== "all" && hit.league !== state.league))) {
        msg = `${hit.name} is hidden by the filters (${hit.mins} World Cup minutes, ${hit.league}).`;
      }
      controls.querySelector(".scatter-msg").textContent = msg;
    }
    draw();
  });

  const cardHtml = (d) => `
    <div class="sc-head">
      ${d.photo ? `<img class="sc-photo" src="${d.photo}" alt="">` : ""}
      <div><div class="tt-head">${escapeHtml(d.name)} <img src="${FLAG_URL(d.flag)}" alt=""></div>
      <div class="tt-rank">${escapeHtml(d.club)} · ${escapeHtml(d.league)}</div></div>
    </div>
    <div class="tt-league">
      <div class="tt-label">xG + xA per 90</div>
      <div class="sc-row"><span>Club ${d.season}</span><b>${fmt(d.clubV)}</b></div>
      <div class="sc-row"><span>World Cup</span><b>${fmt(d.wcV)}</b></div>
      <div class="sc-row sc-diff" style="color:${d.diff >= 0 ? STEP_UP : DROP_OFF}">
        <span>${d.diff >= 0 ? "▲ Stepped up" : "▼ Went quiet"}</span><b>${d.diff >= 0 ? "+" : "−"}${fmt(Math.abs(d.diff))}</b></div>
      <div class="sc-ga">
        <div class="tt-label">Goals + assists</div>
        <div class="sc-row"><span>Club ${d.season}</span><b>${d.clubG} G · ${d.clubA} A</b></div>
        <div class="sc-row"><span>World Cup</span><b>${d.wcG} G · ${d.wcA} A</b></div>
        <div class="tt-note">${d.clubMins.toLocaleString()} club minutes · ${d.mins} World Cup minutes</div>
      </div>
      <div class="tt-note">Split: club ${fmt(d.cxg)} + ${fmt(d.cxa)}, World Cup ${fmt(d.wxg)} + ${fmt(d.wxa)}</div>
      ${touchOnly ? `<button class="filter-btn sc-compare" data-id="${d.id}">Add to comparison</button>` : `<div class="tt-note">Click to add to the comparison</div>`}
    </div>`;
  card.addEventListener("click", (e) => { const b = e.target.closest(".sc-compare"); if (b) comparePlayer(+b.dataset.id); });

  function draw() {
    const pool = all.filter((d) => d.mins >= state.min && (state.pos === "all" || d.pos === state.pos)
      && (state.league === "all" || d.league === state.league));
    // Both axes share one max, from the players currently shown.
    const axisMax = Math.max(0.4, Math.ceil(d3.max(pool, (d) => Math.max(d.clubV, d.wcV)) / 0.2 - 1e-9) * 0.2);
    const outerW = body.clientWidth;
    const m = { top: 12, right: 24, bottom: 40, left: 44 };
    // Square plot area, small enough that the heading, controls and whole chart fit on one screen.
    const side = Math.max(280, Math.min(outerW - m.left - m.right, 720, window.innerHeight - 200));
    const width = m.left + side + m.right, height = m.top + side + m.bottom;
    const x = d3.scaleLinear([0, axisMax], [m.left, m.left + side]);
    const y = d3.scaleLinear([0, axisMax], [m.top + side, m.top]);
    const ticks = d3.range(0, axisMax + 0.001, 0.2);
    const r = d3.scaleSqrt([state.min, maxMins], [2, 5]).clamp(true);

    const svg = d3.create("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
      .attr("aria-label", "Club attacking output per 90 against World Cup attacking output per 90")
      .style("max-width", `${width}px`); // don't let the page scale it back up past the screen-height fit
    const [x0, x1, y0, y1] = [x(0), x(axisMax), y(0), y(axisMax)];
    svg.append("path").attr("class", "sc-tint-up").attr("d", `M${x0},${y0}L${x1},${y1}L${x0},${y1}Z`);
    svg.append("path").attr("class", "sc-tint-down").attr("d", `M${x0},${y0}L${x1},${y0}L${x1},${y1}Z`);
    const grid = svg.append("g").attr("class", "chart-grid");
    grid.selectAll(".h").data(ticks).join("line").attr("x1", x0).attr("x2", x1).attr("y1", y).attr("y2", y);
    grid.selectAll(".v").data(ticks).join("line").attr("y1", y0).attr("y2", y1).attr("x1", x).attr("x2", x);
    svg.append("g").attr("class", "chart-axis").selectAll("text").data(ticks).join("text")
      .attr("x", x0 - 8).attr("y", y).attr("dy", "0.32em").attr("text-anchor", "end").text((v) => v.toFixed(1));
    svg.append("g").attr("class", "chart-axis").selectAll("text").data(ticks).join("text")
      .attr("x", x).attr("y", y0 + 18).attr("text-anchor", "middle").text((v) => v.toFixed(1));
    svg.append("text").attr("class", "chart-axis-text").attr("x", (x0 + x1) / 2).attr("y", height - 4)
      .attr("text-anchor", "middle").text("Club season: xG + xA per 90");
    svg.append("text").attr("class", "chart-axis-text").attr("transform", `translate(11,${(y0 + y1) / 2}) rotate(-90)`)
      .attr("text-anchor", "middle").text("World Cup: xG + xA per 90");

    svg.append("line").attr("class", "sc-diagonal").attr("x1", x0).attr("y1", y0).attr("x2", x1).attr("y2", y1);
    svg.append("text").attr("class", "sc-zone").attr("x", x(axisMax * 0.93)).attr("y", y(axisMax * 0.93) - 8)
      .attr("text-anchor", "end").attr("transform", `rotate(-45 ${x(axisMax * 0.93)} ${y(axisMax * 0.93) - 8})`)
      .text("Same as club form");
    svg.append("text").attr("class", "sc-zone").attr("x", x0 + 10).attr("y", y1 + 18).text("Stepped up");
    svg.append("text").attr("class", "sc-zone").attr("x", x1 - 10).attr("y", y0 - 10).attr("text-anchor", "end").text("Went quiet");

    const focused = state.focus != null && pool.some((d) => d.id === state.focus);
    const dots = svg.append("g").selectAll("circle").data(pool).join("circle")
      .attr("class", "sc-dot").attr("cx", (d) => x(d.clubV)).attr("cy", (d) => y(Math.min(d.wcV, axisMax)))
      .attr("r", (d) => r(d.mins)).attr("fill", (d) => SCATTER_COLORS[d.pos])
      .classed("is-dim", (d) => focused && d.id !== state.focus);

    // Outliers: the biggest gaps either side of the line, as headshots with flag + surname.
    const n = touchOnly || outerW < 600 ? 3 : 5;
    const ups = [...pool].filter((d) => d.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, n);
    const downs = [...pool].filter((d) => d.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, n);
    const picks = [...ups, ...downs];
    const focusRow = focused && pool.find((d) => d.id === state.focus);
    if (focusRow && !picks.includes(focusRow)) picks.push(focusRow);
    const R = 6; // labels sit just clear of the dot
    const labels = placeLabels(picks.map((d) => ({ d, px: x(d.clubV), py: y(Math.min(d.wcV, axisMax)) })), R, x0, x1);

    const lead = svg.append("g");
    lead.selectAll("line").data(labels.filter((l) => Math.abs(l.ly - l.py) > 3)).join("line").attr("class", "sc-leader")
      .attr("x1", (l) => l.px + (l.right ? R : -R)).attr("y1", (l) => l.py).attr("x2", (l) => l.lx).attr("y2", (l) => l.ly);
    // Labelled players' dots get a thin green or red outline to tie them to their name.
    dots.filter((d) => picks.includes(d)).attr("stroke", (d) => (d.diff >= 0 ? STEP_UP : DROP_OFF))
      .attr("stroke-width", 1.25).attr("fill-opacity", 0.9);
    const tags = svg.append("g").selectAll("g").data(labels).join("g")
      .classed("is-dim", (l) => focused && l.d.id !== state.focus)
      .attr("transform", (l) => `translate(${l.lx},${l.ly})`);
    const fw = 14, fh = 10.5;
    tags.append("rect").attr("class", "chart-flag-ring").attr("x", (l) => (l.right ? 0 : -fw) - 1).attr("y", -fh / 2 - 1)
      .attr("width", fw + 2).attr("height", fh + 2).attr("rx", 2);
    tags.append("image").attr("href", (l) => FLAG_URL(l.d.flag)).attr("x", (l) => (l.right ? 0 : -fw)).attr("y", -fh / 2)
      .attr("width", fw).attr("height", fh).attr("preserveAspectRatio", "none");
    tags.append("text").attr("class", "chart-label").attr("x", (l) => (l.right ? fw + 5 : -fw - 5)).attr("dy", "0.32em")
      .attr("text-anchor", (l) => (l.right ? "start" : "end")).text((l) => l.d.surname);

    // Hover (or tap) targets: nearest player within reach.
    const delaunay = d3.Delaunay.from(pool, (d) => x(d.clubV), (d) => y(Math.min(d.wcV, axisMax)));
    let active = null;
    const ring = svg.append("circle").attr("class", "sc-active").attr("r", 0);
    // The hovered player's headshot, drawn over their dot.
    const HR = outerW < 600 ? 11 : 14;
    const face = svg.append("g").attr("class", "sc-face").style("display", "none");
    face.append("clipPath").attr("id", "sc-face-clip").append("circle").attr("r", HR);
    face.append("circle").attr("r", HR).attr("class", "sc-photo-bg");
    const faceImg = face.append("image").attr("x", -HR).attr("y", -HR).attr("width", 2 * HR).attr("height", 2 * HR)
      .attr("preserveAspectRatio", "xMidYMin slice").attr("clip-path", "url(#sc-face-clip)");
    const faceRing = face.append("circle").attr("r", HR).attr("fill", "none").attr("stroke-width", 1.5);
    const show = (d, e) => {
      active = d;
      const cx = x(d.clubV), cy = y(Math.min(d.wcV, axisMax));
      if (d.photo) {
        face.style("display", null).attr("transform", `translate(${cx},${cy})`);
        faceImg.attr("href", d.photo);
        faceRing.attr("stroke", d.diff >= 0 ? STEP_UP : DROP_OFF);
        ring.attr("r", 0);
      } else {
        face.style("display", "none");
        ring.attr("cx", cx).attr("cy", cy).attr("r", r(d.mins) + 3);
      }
      if (touchOnly) { card.innerHTML = cardHtml(d); card.hidden = false; return; }
      analysisTip.innerHTML = cardHtml(d); analysisTip.hidden = false; placeTip(e);
    };
    const hide = () => { active = null; ring.attr("r", 0); face.style("display", "none"); if (!touchOnly) analysisTip.hidden = true; };
    const nearest = (e) => {
      const [mx, my] = d3.pointer(e, svg.node());
      const i = delaunay.find(mx, my), d = pool[i];
      return d && Math.hypot(x(d.clubV) - mx, y(Math.min(d.wcV, axisMax)) - my) < 18 ? d : null;
    };
    svg.append("rect").attr("class", "chart-hit").attr("x", x0).attr("y", y1).attr("width", side).attr("height", side)
      .style("cursor", "pointer")
      .on("pointermove", (e) => { if (touchOnly) return; const d = nearest(e); d ? show(d, e) : hide(); })
      .on("pointerleave", () => { if (!touchOnly) hide(); })
      .on("click", (e) => {
        const d = nearest(e);
        if (touchOnly) { d ? show(d, e) : (hide(), (card.hidden = true)); return; }
        if (d) comparePlayer(d.id);
      });

    body.replaceChildren(svg.node(), card);
    if (touchOnly) card.hidden = true;

    const item = (d) => `<li>${d.photo ? `<img class="sc-li-photo" src="${d.photo}" alt="">` : `<span class="sc-li-photo"></span>`}
      <img class="sc-li-flag" src="${FLAG_URL(d.flag)}" alt=""><span class="sc-li-name">${escapeHtml(d.name)}</span>
      <b style="color:${d.diff >= 0 ? STEP_UP : DROP_OFF}">${d.diff >= 0 ? "+" : "−"}${fmt(Math.abs(d.diff))}</b></li>`;
    const list = (title, rows) => `<div><h4 class="sc-list-title">${title}</h4>
      <ol>${rows.length ? rows.slice(0, 5).map(item).join("") : `<li class="tt-note">No one</li>`}</ol></div>`;
    lists.innerHTML = list("Biggest step-ups", ups.length >= 5 ? ups : [...pool].filter((d) => d.diff > 0).sort((a, b) => b.diff - a.diff))
      + list("Biggest drop-offs", downs.length >= 5 ? downs : [...pool].filter((d) => d.diff < 0).sort((a, b) => a.diff - b.diff));
    note.innerHTML = `<span class="sc-diag-key"></span> Same output for club and country. ` +
      `<span style="color:${SCATTER_COLORS.MF}">Midfielders</span> and <span style="color:${SCATTER_COLORS.FW}">forwards</span> ` +
      `with ${state.min}+ World Cup minutes and ${league.minMinutes}+ league minutes (${pool.length} shown), sized by World Cup minutes. ` +
      `League stats cover the top 5 leagues, Championship, League One, League Two, Saudi Pro League and MLS (its 2026 season, as no 2025 data was available).`;
    foot.replaceChildren(note, source);
    sidePanel.replaceChildren(lists, sideDesc, foot);
    body.after(sidePanel);
  }

  draw();
  let last = body.clientWidth;
  new ResizeObserver(() => { if (Math.abs(body.clientWidth - last) > 8) { last = body.clientWidth; draw(); } }).observe(body);
  let lastH = window.innerHeight; // the plot size also follows the window height
  addEventListener("resize", () => { if (Math.abs(window.innerHeight - lastH) > 20) { lastH = window.innerHeight; draw(); } });
}

// ---------- 4. Lamine Yamal: World Cup vs his own club level ----------

const lamineRoot = document.getElementById("lamine-content");

// A player's club row with the most minutes, like the "who showed up" chart uses.
function clubRowOf(player, league) {
  const rows = league.players.filter((r) => r.oid === player.optaId && r.mins >= league.minMinutes);
  return d3.greatest(rows, (r) => r.mins);
}

const LAMINE_STATS = ["assists", "goals", "chances_created", "goals_per_xg", "xg", "xa", "xg_per_shot",
  "progressive_carries", "successful_final_third_passes", "ground_duel_perc", "shots", "tackles",
  "shots_on_target", "fouls_commited"];

function lamineDumbbellChart(p, players, league) {
  const club = clubRowOf(p, league);
  if (!club) return;
  // Per 90 stats are [per 90, total] at the World Cup and season totals in the club row.
  const wcOf = (k) => (Array.isArray(p.stats[k]) ? p.stats[k][0] : p.stats[k]);
  const clubOf = (k) => {
    const v = club.v[league.keys.indexOf(k)] ?? 0;
    return players.metrics[k].kind === "per90" ? (v / club.mins) * 90 : v;
  };
  const rows = LAMINE_STATS.filter((k) => players.metrics[k] && p.stats[k] != null).map((k) => {
    const m = players.metrics[k], c = clubOf(k), w = wcOf(k) ?? 0;
    const pct = c > 0 ? Math.round((100 * w) / c) : 100;
    return { k, label: m.label, lower: m.lowerIsBetter, unit: m.kind === "pct" ? "%" : "", c, w, pct,
      worse: m.lowerIsBetter ? pct > 100 : pct < 100 };
  });
  // Biggest drops first; stats where lower is better go last.
  rows.sort((a, b) => a.lower - b.lower || a.pct - b.pct);
  const body = chartBlock(
    "Club vs Country",
    "Lamine's stats for Barcelona in the 25/26 season vs at the World Cup. We can see that almost every stat " +
    "fell a significant amount.",
    lamineRoot);

  const draw = () => {
    const width = body.clientWidth;
    // Narrow screens put each label above its row, so the dumbbells get the full width.
    const stacked = width < 480;
    const rowH = stacked ? 46 : 30, dotY = stacked ? 8 : 0;
    const m = { top: 24, right: 52, bottom: 8, left: stacked ? 0 : Math.min(200, width * 0.4) };
    const height = m.top + rows.length * rowH + m.bottom;
    const max = Math.max(200, Math.ceil(d3.max(rows, (r) => r.pct) / 50) * 50);
    // Room left of 0% for a value label on a stat that fell to nothing.
    const x = d3.scaleLinear([0, max], [m.left + 36, width - m.right]);
    // Every 100% on narrow screens, so the tick labels don't run together.
    const ticks = d3.range(0, max + 1, x(50) - x(0) < 40 ? 100 : 50);

    const svg = d3.create("svg").attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img").attr("aria-label", "Lamine Yamal's World Cup stats as a percentage of his club level");
    svg.append("g").attr("class", "chart-grid").selectAll("line").data(ticks).join("line")
      .attr("x1", x).attr("x2", x).attr("y1", m.top - 6).attr("y2", height - m.bottom);
    svg.append("g").attr("class", "chart-axis").selectAll("text").data(ticks).join("text")
      .attr("x", x).attr("y", m.top - 12).attr("text-anchor", "middle").text((v) => `${v}%`);
    svg.append("line").attr("class", "sc-diagonal")
      .attr("x1", x(100)).attr("x2", x(100)).attr("y1", m.top - 6).attr("y2", height - m.bottom);

    const g = svg.append("g").selectAll("g").data(rows).join("g")
      .attr("transform", (d, i) => `translate(0,${m.top + i * rowH + rowH / 2})`);
    g.append("text").attr("class", "chart-bar-label lm-label").attr("dy", "0.32em")
      .attr("x", stacked ? 0 : m.left - 14).attr("y", stacked ? -11 : 0).attr("text-anchor", stacked ? "start" : "end")
      .text((d) => d.label + (d.lower ? " ↓" : ""));
    g.append("line").attr("class", "lm-bar").attr("x1", x(100)).attr("x2", (d) => x(d.pct)).attr("y1", dotY).attr("y2", dotY)
      .attr("stroke", (d) => (d.worse ? DROP_OFF : STEP_UP));
    g.append("circle").attr("class", "lm-club").attr("cx", x(100)).attr("cy", dotY).attr("r", 5);
    g.append("circle").attr("class", "lm-wc").attr("cx", (d) => x(d.pct)).attr("cy", dotY).attr("r", 6);
    g.append("text").attr("class", "chart-axis-text").attr("dy", "0.32em").attr("y", dotY)
      .attr("x", (d) => x(d.pct) + (d.pct < 100 ? -12 : 12)).attr("text-anchor", (d) => (d.pct < 100 ? "end" : "start"))
      .text((d) => `${d.pct}%`);

    const num = (v, d) => `${v.toFixed(v >= 10 ? 1 : 2)}${d.unit}`;
    g.append("rect").attr("class", "chart-hit").attr("x", 0).attr("y", -rowH / 2).attr("width", width).attr("height", rowH)
      .on("pointerenter", (e, d) => {
        analysisTip.innerHTML = `
          <div class="tt-head">${escapeHtml(d.label)}</div>
          <div class="tt-league">
            <div class="tt-label">${d.unit ? "Rate" : players.metrics[d.k].kind === "per90" ? "Per 90" : "Ratio"}</div>
            <div class="sc-row"><span>Barcelona ${club.season}</span><b>${num(d.c, d)}</b></div>
            <div class="sc-row"><span>World Cup</span><b>${num(d.w, d)}</b></div>
            <div class="sc-row sc-diff" style="color:${d.worse ? DROP_OFF : STEP_UP}">
              <span>${d.worse ? "▼ Worse" : "▲ Better"}${d.lower ? " (lower is better)" : ""}</span><b>${d.pct}% of club</b></div>
          </div>`;
        analysisTip.hidden = false;
        placeTip(e);
      })
      .on("pointermove", placeTip)
      .on("pointerleave", () => { analysisTip.hidden = true; });

    const note = document.createElement("p");
    note.className = "chart-note lm-note";
    note.innerHTML = `<span class="lm-key lm-key-club"></span> Barcelona ${club.season} (${club.mins.toLocaleString()} min)
      <span class="lm-key lm-key-wc"></span> World Cup (${p.mins} min)
      <span class="lm-key-line" style="border-color:${DROP_OFF}"></span> Worse
      <span class="lm-key-line" style="border-color:${STEP_UP}"></span> Better · ↓ lower is better`;
    body.replaceChildren(svg.node(), note);
    if (!stacked) svg.selectAll(".chart-bar-label").each(function () { truncate(this, m.left - 18); });
  };

  draw();
  let last = body.clientWidth;
  new ResizeObserver(() => { if (Math.abs(body.clientWidth - last) > 8) { last = body.clientWidth; draw(); } }).observe(body);
}

// ---------- 5. Lamine Yamal: shot volume vs chance quality, and goals vs xG ----------

const SHOT_MIN_MINS = 270;
const ARROW_NOTE = "The red arrow runs from Lamine's 25/26 club season to his World Cup.";

// Both scatters share one layout and a penalties toggle; the configs below say what goes on each axis.
function lamineScatters(p, players, league) {
  const pair = Object.assign(document.createElement("div"), { className: "lm-pair" });
  lamineRoot.append(pair);
  const total = (q, k) => q.stats[k]?.[1] ?? 0;
  const per90 = (q, k) => q.stats[k]?.[0] ?? 0;
  const ratio = (a, b) => (b > 0 ? a / b : 0);

  lamineScatter(p, players, league, pair, {
    id: "shots",
    title: "Shots vs xG",
    xLabel: "Shots per 90", yLabel: "xG per shot", xFmt: (v) => v.toFixed(2), yFmt: (v) => v.toFixed(2),
    xTick: (v) => v, yTick: (v) => v.toFixed(2),
    point: (q, pens) => pens
      ? { x: per90(q, "shots"), y: ratio(total(q, "xg"), total(q, "shots")) }
      : { x: per90(q, "np_shots"), y: ratio(total(q, "np_xg"), total(q, "np_shots")) },
    club: (kv, mins, pens) => {
      const [sh, xg] = pens ? [kv("shots"), kv("xg")] : [kv("np_shots"), kv("np_xg")];
      return sh > 0 ? { x: (sh / mins) * 90, y: xg / sh } : null;
    },
    keep: (d) => d.x > 0,
    medians: true,
    zones: { tl: "Few shots, good chances", tr: "Lots of good chances", bl: "Few shots, poor chances", br: "Lots of shots, poor chances" },
    named: (others) => [...d3.sort(others, (d) => -d.x).slice(0, 2), ...d3.sort(others, (d) => -d.y).slice(0, 2)],
    subtitle: (pens) => `Forwards with ${SHOT_MIN_MINS}+ minutes in the World Cup. ${pens ? "Shots" : "Non-penalty shots"} ` +
      `per 90 on the x axis and xG per shot on the y axis. The two dashed lines are the median forward: players right ` +
      `of the vertical line shot more often than most, and players above the horizontal line had better chances than ` +
      `most. ${ARROW_NOTE}`,
    tip: (d) => [["Shots per 90", d.x.toFixed(2)], ["xG per shot", d.y.toFixed(2)], ["Goals", d.goals]],
    note: (pool, pens) => `${pool.length} forwards shown. ` +
      (pens ? "Penalties count as shots worth about 0.79 xG each." : "Penalties left out of shots and xG."),
  });

  lamineScatter(p, players, league, pair, {
    id: "finish",
    title: "Goals vs xG",
    xLabel: "xG per 90", yLabel: "Goals per 90", xFmt: (v) => v.toFixed(2), yFmt: (v) => v.toFixed(2),
    xTick: (v) => v.toFixed(1), yTick: (v) => v.toFixed(1),
    point: (q, pens) => pens ? { x: per90(q, "xg"), y: per90(q, "goals"), gt: total(q, "goals"), xt: total(q, "xg") }
      : { x: per90(q, "np_xg"), y: per90(q, "np_goals"), gt: total(q, "np_goals"), xt: total(q, "np_xg") },
    club: (kv, mins, pens) => {
      const [g, xg] = pens ? [kv("goals"), kv("xg")] : [kv("np_goals"), kv("np_xg")];
      return { x: (xg / mins) * 90, y: (g / mins) * 90, gt: g, xt: xg };
    },
    keep: () => true,
    diagonal: true,
    zones: { tl: "Scored more than expected", br: "Scored less than expected" },
    named: (others) => [...d3.sort(others, (d) => -(d.gt - d.xt)).slice(0, 2), ...d3.sort(others, (d) => d.gt - d.xt).slice(0, 1),
      ...d3.sort(others, (d) => -d.y).slice(0, 1)],
    subtitle: (pens) => `Forwards with ${SHOT_MIN_MINS}+ minutes in the World Cup. ${pens ? "xG" : "Non-penalty xG"} per 90 ` +
      `on the x axis and ${pens ? "goals" : "non-penalty goals"} per 90 on the y axis. The dashed diagonal is where goals ` +
      `equal xG: players above it scored more than their chances were worth, players below it scored fewer. ${ARROW_NOTE}`,
    tip: (d) => [["xG per 90", d.x.toFixed(2)], ["Goals per 90", d.y.toFixed(2)],
      ["Goals vs xG (total)", `${d.gt} from ${d.xt.toFixed(1)}`]],
    note: (pool, pens) => `${pool.length} forwards shown. ` +
      (pens ? "Includes penalty goals and their xG." : "Penalty goals and their xG left out."),
  });
}

function lamineScatter(p, players, league, parent, cfg) {
  const club = clubRowOf(p, league);
  const kv = (k) => club?.v[league.keys.indexOf(k)] ?? 0;
  const state = { pens: true, focus: null };
  const poolFor = (pens) => players.players.filter((q) => q.pos === "FW" && !q.isAverage && q.mins >= SHOT_MIN_MINS)
    .map((q) => ({ id: q.optaId, name: q.name, surname: surname(q.name), flag: q.flag, photo: q.photo, mins: q.mins,
      goals: q.goals ?? 0, me: q.optaId === p.optaId, ...cfg.point(q, pens) }))
    .filter(cfg.keep);
  if (!poolFor(true).some((d) => d.me)) return;

  const body = chartBlock(cfg.title, "", parent);
  const subtitle = body.closest(".chart").querySelector(".chart-subtitle");
  // Penalties toggle and a search that highlights any other forward on the chart.
  const names = poolFor(true).filter((d) => !d.me).map((d) => d.name).sort((a, b) => a.localeCompare(b));
  const controls = document.createElement("div");
  controls.className = "lm-controls";
  controls.innerHTML = `
    <label class="toggle lm-toggle"><input type="checkbox" checked aria-label="Include penalties">
      <span class="toggle-track" aria-hidden="true"></span><span class="toggle-on">Including penalties</span></label>
    <input class="filter-btn lm-search" type="search" placeholder="Find a player" list="lm-names-${cfg.id}" aria-label="Find a player">
    <datalist id="lm-names-${cfg.id}">${names.map((n) => `<option value="${escapeHtml(n)}">`).join("")}</datalist>
    <span class="lm-msg tt-note"></span>`;
  controls.querySelector(".lm-toggle input").addEventListener("change", (e) => { state.pens = e.target.checked; draw(); });
  controls.querySelector(".lm-search").addEventListener("input", (e) => {
    const q = fold(e.target.value.trim());
    const hit = q && poolFor(true).find((d) => !d.me && fold(d.name) === q);
    state.focus = hit ? hit.id : null;
    const other = q && !hit && players.players.find((r) => !r.isAverage && fold(r.name) === q);
    controls.querySelector(".lm-msg").textContent = other ? `${other.name} isn't on this chart: ` +
      (other.pos !== "FW" ? "only forwards are shown." : `he played ${other.mins} World Cup minutes (under ${SHOT_MIN_MINS}).`) : "";
    draw();
  });
  body.before(controls);

  function draw() {
    const pool = poolFor(state.pens), me = pool.find((d) => d.me);
    const from = club ? cfg.club(kv, club.mins, state.pens) : null;
    subtitle.textContent = cfg.subtitle(state.pens);
    const found = state.focus != null ? pool.find((d) => d.id === state.focus) : null;

    const outerW = body.clientWidth;
    const m = { top: 12, right: 24, bottom: 40, left: 48 };
    const plotW = Math.max(240, outerW - m.left - m.right), plotH = Math.max(240, Math.min(plotW * 0.85, 460));
    const width = m.left + plotW + m.right, height = m.top + plotH + m.bottom;
    const pts = from ? [...pool, from] : pool;
    const xMax = d3.max(pts, (d) => d.x) * 1.08, yMax = d3.max(pts, (d) => d.y) * 1.08;
    const x = d3.scaleLinear([0, xMax], [m.left, m.left + plotW]).nice();
    const y = d3.scaleLinear([0, yMax], [m.top + plotH, m.top]).nice();
    const [x0, x1, y0, y1] = [x.range()[0], x.range()[1], y.range()[0], y.range()[1]];
    const [xEnd, yEnd] = [x.domain()[1], y.domain()[1]];
    const cx = (d) => x(Math.min(d.x, xEnd)), cy = (d) => y(Math.min(d.y, yEnd));

    const svg = d3.create("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
      .attr("aria-label", `Forwards' ${cfg.xLabel} against ${cfg.yLabel} at the World Cup, with Lamine Yamal highlighted`);
    const xt = x.ticks(6), yt = y.ticks(5);
    const grid = svg.append("g").attr("class", "chart-grid");
    grid.selectAll(".h").data(yt).join("line").attr("x1", x0).attr("x2", x1).attr("y1", y).attr("y2", y);
    grid.selectAll(".v").data(xt).join("line").attr("y1", y0).attr("y2", y1).attr("x1", x).attr("x2", x);
    svg.append("g").attr("class", "chart-axis").selectAll("text").data(yt).join("text")
      .attr("x", x0 - 8).attr("y", y).attr("dy", "0.32em").attr("text-anchor", "end").text(cfg.yTick);
    svg.append("g").attr("class", "chart-axis").selectAll("text").data(xt).join("text")
      .attr("x", x).attr("y", y0 + 18).attr("text-anchor", "middle").text(cfg.xTick);
    svg.append("text").attr("class", "chart-axis-text").attr("x", (x0 + x1) / 2).attr("y", height - 4)
      .attr("text-anchor", "middle").text(cfg.xLabel);
    svg.append("text").attr("class", "chart-axis-text").attr("transform", `translate(11,${(y0 + y1) / 2}) rotate(-90)`)
      .attr("text-anchor", "middle").text(cfg.yLabel);

    if (cfg.medians) {
      // Medians split the plot into four kinds of shooter.
      const mx = x(d3.median(pool, (d) => d.x)), my = y(d3.median(pool, (d) => d.y));
      svg.append("line").attr("class", "sc-diagonal").attr("x1", mx).attr("x2", mx).attr("y1", y0).attr("y2", y1);
      svg.append("line").attr("class", "sc-diagonal").attr("x1", x0).attr("x2", x1).attr("y1", my).attr("y2", my);
    }
    if (cfg.diagonal) {
      const e = Math.min(xEnd, yEnd);
      svg.append("line").attr("class", "sc-diagonal").attr("x1", x(0)).attr("y1", y(0)).attr("x2", x(e)).attr("y2", y(e));
    }
    const z = cfg.zones;
    if (z.tl) svg.append("text").attr("class", "sc-zone").attr("x", x0 + 8).attr("y", y1 + 16).text(z.tl);
    if (z.tr) svg.append("text").attr("class", "sc-zone").attr("x", x1 - 8).attr("y", y1 + 16).attr("text-anchor", "end").text(z.tr);
    if (z.bl) svg.append("text").attr("class", "sc-zone").attr("x", x0 + 8).attr("y", y0 - 10).text(z.bl);
    if (z.br) svg.append("text").attr("class", "sc-zone").attr("x", x1 - 8).attr("y", y0 - 10).attr("text-anchor", "end").text(z.br);

    const others = pool.filter((d) => !d.me);
    svg.append("g").selectAll("circle").data(others).join("circle")
      .attr("class", "sc-dot").attr("cx", cx).attr("cy", cy).attr("r", 4).attr("fill", SCATTER_COLORS.FW)
      .classed("is-dim", (d) => found && d !== found);

    // Where he was at Barcelona, with an arrow to his World Cup.
    const mx = cx(me), my = cy(me), HR = 7;
    if (from) {
      const fx = cx(from), fy = cy(from);
      const len = Math.hypot(mx - fx, my - fy);
      svg.append("defs").html(`<marker id="lm-arrow-${cfg.id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6"
        markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10Z" fill="${DROP_OFF}"/></marker>`);
      if (len > HR + 8) {
        svg.append("line").attr("class", "lm-arrow").attr("x1", fx).attr("y1", fy)
          .attr("x2", mx - ((mx - fx) / len) * (HR + 3)).attr("y2", my - ((my - fy) / len) * (HR + 3))
          .attr("marker-end", `url(#lm-arrow-${cfg.id})`);
      }
      svg.append("circle").attr("class", "lm-club").attr("cx", fx).attr("cy", fy).attr("r", 6);
      const left = fx > x1 - 130;
      svg.append("text").attr("class", "chart-label").attr("x", fx + (left ? -10 : 10)).attr("y", fy).attr("dy", "0.32em")
        .attr("text-anchor", left ? "end" : "start").text(`Lamine's ${String(club.season).replace(/^20(\d\d)\/(\d\d)$/, "$1/$2")} Club Season`);
    }
    svg.append("circle").attr("class", "lm-wc").attr("cx", mx).attr("cy", my).attr("r", HR);
    svg.append("text").attr("class", "chart-label lm-name").attr("x", mx).attr("y", my + HR + 14)
      .attr("text-anchor", "middle").text("Lamine Yamal");
    // A searched-for player: ringed and named, with everyone else dimmed.
    if (found) {
      svg.append("circle").attr("class", "lm-found").attr("cx", cx(found)).attr("cy", cy(found)).attr("r", 7);
      const right = cx(found) < x1 - 110;
      svg.append("text").attr("class", "chart-label lm-name").attr("x", cx(found) + (right ? 12 : -12)).attr("y", cy(found))
        .attr("dy", "0.32em").attr("text-anchor", right ? "start" : "end").text(found.name);
    }

    // A few other names for reference, skipping any that would land on one already placed.
    const named = [];
    for (const d of found ? [] : new Set(cfg.named(others))) {
      const clash = [...named, me].some((o) => Math.abs(cy(o) - cy(d)) < 13 && Math.abs(cx(o) - cx(d)) < 80);
      if (!clash) named.push(d);
    }
    svg.append("g").selectAll("text").data(named).join("text").attr("class", "chart-label")
      .attr("x", (d) => cx(d) + (cx(d) > x1 - 90 ? -8 : 8)).attr("y", cy).attr("dy", "0.32em")
      .attr("text-anchor", (d) => (cx(d) > x1 - 90 ? "end" : "start")).text((d) => d.surname);

    const delaunay = d3.Delaunay.from(pool, cx, cy);
    const ring = svg.append("circle").attr("class", "sc-active").attr("r", 0);
    svg.append("rect").attr("class", "chart-hit").attr("x", x0).attr("y", y1).attr("width", plotW).attr("height", plotH)
      .on("pointermove", (e) => {
        const [px, py] = d3.pointer(e, svg.node());
        const d = pool[delaunay.find(px, py)];
        if (!d || Math.hypot(cx(d) - px, cy(d) - py) > 18) { ring.attr("r", 0); analysisTip.hidden = true; return; }
        ring.attr("cx", cx(d)).attr("cy", cy(d)).attr("r", d.me ? HR + 3 : 7);
        analysisTip.innerHTML = `
          <div class="tt-head">${escapeHtml(d.name)} <img src="${FLAG_URL(d.flag)}" alt=""></div>
          <div class="tt-league">
            ${cfg.tip(d).map(([k, v]) => `<div class="sc-row"><span>${k}</span><b>${v}</b></div>`).join("")}
            <div class="tt-note">${d.mins} World Cup minutes</div>
          </div>`;
        analysisTip.hidden = false;
        placeTip(e);
      })
      .on("pointerleave", () => { ring.attr("r", 0); analysisTip.hidden = true; });

    const note = document.createElement("p");
    note.className = "chart-note sc-note";
    note.innerHTML = cfg.note(pool, state.pens);
    body.replaceChildren(svg.node(), note);
  }

  draw();
  let last = body.clientWidth;
  new ResizeObserver(() => { if (Math.abs(body.clientWidth - last) > 8) { last = body.clientWidth; draw(); } }).observe(body);
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Labels sit beside their headshot; any that would collide are pushed apart vertically, with a leader line.
function placeLabels(items, R, xMin, xMax) {
  const gap = 15;
  for (const l of items) { l.right = l.px + R + 90 < xMax || l.px - R - 90 < xMin; l.lx = l.px + (l.right ? R + 5 : -R - 5); l.ly = l.py; }
  for (const side of [true, false]) {
    const g = items.filter((l) => l.right === side).sort((a, b) => a.ly - b.ly);
    for (let pass = 0; pass < 20; pass++) {
      let moved = false;
      for (let i = 1; i < g.length; i++) {
        if (Math.abs(g[i].lx - g[i - 1].lx) > 110) continue;
        const overlap = gap - (g[i].ly - g[i - 1].ly);
        if (overlap > 0) { g[i - 1].ly -= overlap / 2; g[i].ly += overlap / 2; moved = true; }
      }
      if (!moved) break;
    }
  }
  // Pushed labels move out a little further so the leader line has room.
  for (const l of items) if (Math.abs(l.ly - l.py) > 3) l.lx += l.right ? 8 : -8;
  return items;
}

function surname(name) {
  const parts = name.split(" ");
  if (/^(Júnior|Junior|Jr\.?|Neto|Filho)$/.test(parts.at(-1))) return name; // "Vinícius Júnior", not "Júnior"
  return parts.length > 1 ? parts.slice(1).join(" ") : name;
}

function fmt(v) { return v.toFixed(2); }

function legendNote() {
  const el = document.createElement("p");
  el.className = "chart-note";
  el.innerHTML = `<span class="chart-median-key"></span> Median for the stage. Log scale; teams whose top
    league sent no players sit on the 0% row. Semi-finals = 3rd and 4th place; Final = winner and runner-up.`;
  return el;
}

function placeTip(e) {
  const pad = 14;
  const { width, height } = analysisTip.getBoundingClientRect();
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + width > window.innerWidth - 8) x = e.clientX - width - pad;
  if (y + height > window.innerHeight - 8) y = e.clientY - height - pad;
  analysisTip.style.left = `${Math.max(8, x)}px`;
  analysisTip.style.top = `${Math.max(8, y)}px`;
}
