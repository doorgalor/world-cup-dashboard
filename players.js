// Player profiles: one or more widgets, each with its own search, filters and percentile bars, so
// players can be compared side by side. Filters (league, confederation, country, position) choose
// who a player is ranked against; percentiles are computed here from that pool. Data comes from
// scripts/build_player_data.py (web/data/players.json). Uses FLAG_URL and escapeHtml from app.js.

const DEFAULT_PLAYERS = ["Lionel Messi", "Kylian Mbappé"]; // one widget each, side by side on load
const MAX_WIDGETS = 4;
const MAX_OPTIONS = 8;
const MIN_POOL = 5; // fewer players than this in the comparison pool and percentiles mean little
const CONFEDERATIONS = ["UEFA", "CONMEBOL", "CONCACAF", "CAF", "AFC", "OFC"];
// World Cup finishes, furthest first: [result in countries.json, heading in the Country filter].
const STAGES = [
  ["Winner", "Winner"], ["Runner-up", "Runner-up"], ["Third place", "Third place"],
  ["Fourth place", "Fourth place"], ["Eliminated quarter-finals", "Quarter-finals"],
  ["Eliminated round of 16", "Round of 16"], ["Eliminated round of 32", "Round of 32"],
  ["Eliminated group stage", "Group stage"],
];
const FILTER_KINDS = ["leagues", "confs", "teams", "roles"];

const widgetColumn = document.getElementById("player-widgets");
const widgets = [];
let widgetCount = 0; // for unique element ids

Promise.all([d3.json("data/players.json"), d3.json("data/countries.json")]).then(([data, countries]) => {
  data.players = data.players.map((p) => ({ ...p, search: fold(`${p.name} ${p.country}`) }));
  // League averages are shown, never ranked against or counted in anyone's percentiles.
  data.eligible = data.players.filter((p) => p.mins >= data.minMinutes && !p.isAverage);
  data.leagues = leagueList(data.eligible, data.top5);
  data.teams = teamsByStage(countries);
  playerData = data;
  for (const name of DEFAULT_PLAYERS) {
    const player = data.players.find((p) => p.name === name);
    if (player) addWidget(data, player);
  }
  if (!widgets.length) addWidget(data, data.players[0]);
});

// 2025/26 league form (web/data/league_players.json), loaded the first time a widget asks for it.
// Rows get the same shape as World Cup players (stats as [per 90, total] or one value), so the
// filters, percentiles and bars work on them unchanged.
function loadLeagueData(data) {
  data.leagueReady ??= d3.json("data/league_players.json").then((lg) => {
    const worldCup = new Map(data.players.filter((p) => p.optaId).map((p) => [p.optaId, p]));
    const names = new Map(data.players.filter((p) => p.leagueId)
      .map((p) => [p.leagueId, { league: p.league, leagueCountry: p.leagueCountry }]));
    const toRow = (r) => {
      const stats = {};
      lg.keys.forEach((k, i) => {
        const v = r.v[i];
        if (v != null) stats[k] = data.metrics[k].kind === "per90" ? [(v / r.mins) * 90, v] : v;
      });
      const wc = worldCup.get(r.oid); // nationality is only known for World Cup players
      return {
        ...r, ...(names.get(r.league) ?? { league: lg.leagueNames[r.league] ?? r.league, leagueCountry: "" }),
        leagueId: r.league, stats, team: wc?.team, conf: wc?.conf,
        goals: stats.goals?.[1] ?? 0, assists: stats.assists?.[1] ?? 0,
      };
    };
    const rows = lg.players.map(toRow);
    data.leagueMin = lg.minMinutes;
    data.leagueEligible = rows.filter((r) => r.mins >= lg.minMinutes);
    data.leagueLeagues = leagueList(data.leagueEligible, data.top5);
    // A player's league form is their row with the most minutes (a mid-season move gives two).
    data.leagueByOid = new Map();
    for (const r of rows) {
      const best = data.leagueByOid.get(r.oid);
      if (!best || r.mins > best.mins) data.leagueByOid.set(r.oid, r);
    }
    for (const r of lg.averages ?? []) data.leagueByOid.set(r.oid, toRow(r));
  });
  return data.leagueReady;
}

function addWidget(data, player = null) {
  if (widgets.length >= MAX_WIDGETS) return;
  const w = new PlayerWidget(data, player);
  widgets.push(w);
  widgetColumn.append(w.el);
  updateColumn();
  colorCompare();
  if (!player) w.focusSearch();
}

// Used by the analysis charts: open a player in the comparison tool (the last widget is reused when full).
let playerData = null;
function comparePlayer(optaId) {
  const player = playerData?.players.find((p) => p.optaId === optaId);
  if (!player) return;
  if (widgets.length < MAX_WIDGETS) addWidget(playerData, player);
  else widgets[widgets.length - 1].select(player);
  widgetColumn.scrollIntoView({ behavior: "smooth", block: "start" });
}

function removeWidget(w) {
  widgets.splice(widgets.indexOf(w), 1);
  w.destroy();
  updateColumn();
  colorCompare();
}

// With 2+ players, colour each metric's name by how the players compare on it: best green,
// worst red, anyone in between a shade of yellow (brighter = closer to the best). Ties share a colour.
const COMPARE_BEST = "#3ddc84";
const COMPARE_WORST = "#ff6b6b";
const COMPARE_MID = d3.interpolateRgb("#ffe066", "#e0a100");

function colorCompare() {
  const byKey = d3.group(widgets.flatMap((w) => [...w.view.querySelectorAll(".bar-row[data-value]")]),
    (row) => row.dataset.key);
  for (const [key, rows] of byKey) {
    const lowerIsBetter = widgets[0].data.metrics[key]?.lowerIsBetter;
    const ranked = [...new Set(rows.map((r) => +r.dataset.value))].sort((a, b) => (lowerIsBetter ? a - b : b - a));
    for (const row of rows) {
      const rank = ranked.indexOf(+row.dataset.value);
      const n = ranked.length;
      const color = rows.length < 2 || n < 2 ? ""
        : rank === 0 ? COMPARE_BEST : rank === n - 1 ? COMPARE_WORST : COMPARE_MID((rank - 1) / Math.max(1, n - 3));
      row.querySelector(".bar-name").style.color = color;
    }
  }
}

// Classes the CSS uses to show "+" only on the last widget, and the sync buttons only with 2+ widgets.
function updateColumn() {
  widgetColumn.classList.toggle("is-full", widgets.length >= MAX_WIDGETS);
  widgetColumn.classList.toggle("is-multi", widgets.length > 1);
}

// Copy one widget's filters to every other widget. Position filters only carry over to players in
// the same position group (a centre back isn't compared with wingers); others keep their own.
function syncFilters(source) {
  for (const w of widgets) {
    if (w === source) continue;
    for (const kind of ["leagues", "confs", "teams"]) w.filters[kind] = new Set(source.filters[kind]);
    if (w.shown && source.shown && groupOf(w.shown) === groupOf(source.shown)) {
      w.filters.roles = new Set(source.filters.roles);
    }
    w.render();
  }
}

// Copy one widget's added metrics to every other widget. (Goalkeeping metrics on an outfield
// player, or the reverse, are skipped when drawn, so syncing across them is harmless.)
function syncMetrics(source) {
  for (const w of widgets) {
    if (w === source) continue;
    w.extraBars = [...source.extraBars];
    w.render();
  }
}

class PlayerWidget {
  constructor(data, player) {
    this.data = data;
    this.player = player;
    this.id = ++widgetCount;
    this.statMode = "p90"; // "p90" (per-90) or "total" (tournament totals); each ranked separately
    this.source = "wc"; // "wc" (World Cup) or "league" (2025/26 club season)
    // Empty set = no filter. With no roles picked, players are compared with their own position group.
    this.filters = Object.fromEntries(FILTER_KINDS.map((k) => [k, new Set()]));
    this.extraBars = []; // metrics added with "Add metric", shown after the position's default bars
    this.posOverride = null; // a detailed position picked in the card, in place of Opta's
    this.options = [];
    this.highlighted = 0;
    this.abort = new AbortController(); // removes document listeners when the widget is removed

    this.el = document.createElement("section");
    this.el.className = "panel player-panel";
    this.el.setAttribute("aria-labelledby", `player-title-${this.id}`);
    this.el.innerHTML = `
      <div class="panel-head">
        <h2 id="player-title-${this.id}">Player profile</h2>
        <div class="panel-head-actions">
          <div class="metric-picker">
            <button type="button" class="metric-btn" aria-expanded="false">+ Add metric</button>
            <div class="filter-pop metric-pop" hidden></div>
          </div>
          <div class="segmented" role="group" aria-label="Stats from">
            <button type="button" data-source="wc" aria-pressed="true">World Cup</button>
            <button type="button" data-source="league" aria-pressed="false">League 25/26</button>
          </div>
          <div class="segmented" role="group" aria-label="Stat values">
            <button type="button" data-mode="p90" aria-pressed="true">Per 90</button>
            <button type="button" data-mode="total" aria-pressed="false">Overall</button>
          </div>
          ${this.id > 1 ? `<button type="button" class="widget-remove" aria-label="Remove this player">×</button>` : ""}
        </div>
      </div>
      <div class="search">
        <input type="search" placeholder="Search a player or country…" autocomplete="off"
               role="combobox" aria-expanded="false" aria-controls="player-options-${this.id}" aria-autocomplete="list">
        <ul id="player-options-${this.id}" class="search-options" role="listbox" hidden></ul>
      </div>
      <div class="filters" aria-label="Compare with"></div>
      <div class="player-view"></div>`;
    this.searchInput = this.el.querySelector(".search input");
    this.optionList = this.el.querySelector(".search-options");
    this.view = this.el.querySelector(".player-view");
    this.filterBar = this.el.querySelector(".filters");

    this.el.querySelectorAll(".segmented [data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.statMode = btn.dataset.mode;
        this.el.querySelectorAll(".segmented [data-mode]")
          .forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
        this.render();
      });
    });
    this.el.querySelectorAll(".segmented [data-source]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.source = btn.dataset.source;
        this.el.querySelectorAll(".segmented [data-source]")
          .forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
        this.render(); // shows "Loading…" the first time, until the league file arrives
        if (this.source === "league") loadLeagueData(data).then(() => this.render());
      });
    });
    this.el.querySelector(".widget-remove")?.addEventListener("click", () => removeWidget(this));
    // The "+" lives inside the re-rendered view, so listen on the view.
    this.view.addEventListener("click", (e) => { if (e.target.closest(".add-widget")) addWidget(data); });

    this.view.addEventListener("change", (e) => {
      if (e.target.matches(".pos-select")) this.setPosition(e.target.value);
    });
    // Remove an added metric with the × on its bar.
    this.view.addEventListener("click", (e) => {
      const btn = e.target.closest(".bar-remove");
      if (!btn) return;
      this.extraBars = this.extraBars.filter((k) => k !== btn.dataset.key);
      this.render();
    });

    this.setupSearch();
    this.setupFilters();
    this.setupMetricPicker();
    this.render();
  }

  // ---------- add metric ----------

  setupMetricPicker() {
    const btn = this.el.querySelector(".metric-btn");
    const pop = this.el.querySelector(".metric-pop");
    const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
    const fill = (search = "") => fillPop(pop, this.metricPopHtml(search));
    btn.addEventListener("click", () => {
      if (!pop.hidden) return close();
      fill();
      pop.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      pop.querySelector(".pop-search").focus();
    });
    pop.addEventListener("change", (e) => {
      const key = e.target.value;
      this.extraBars = e.target.checked ? [...this.extraBars, key] : this.extraBars.filter((k) => k !== key);
      fill(pop.querySelector(".pop-search").value);
      this.render();
    });
    pop.addEventListener("input", (e) => { if (e.target.matches(".pop-search")) applySearch(pop); });
    const { signal } = this.abort;
    document.addEventListener("click", (e) => { if (!e.target.closest(".metric-picker") || !this.el.contains(e.target)) close(); }, { signal });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); }, { signal });
  }

  // Metrics this player can show, grouped; their default bars are ticked and fixed.
  metricPopHtml(search) {
    const p = this.shown;
    const defaults = p ? this.data.defaultBars[p.pos] : [];
    const gk = p?.pos === "GK";
    const groups = d3.group(Object.entries(this.data.metrics).filter(([k]) => k.startsWith("gk:") === gk),
      ([, m]) => m.group);
    return `
      <input class="pop-search" type="search" placeholder="Find a metric…" value="${escapeHtml(search)}">
      <div class="pop-searchable">${[...groups].map(([group, items]) => `
        <div class="pop-section">
          <div class="pop-stage">${escapeHtml(group)}</div>
          <div class="pop-indent">${items.map(([k, m]) => {
            const fixed = defaults.includes(k);
            return `<label${fixed ? ' class="is-fixed" title="Shown by default"' : ""}>
              <input type="checkbox" value="${k}" ${fixed || this.extraBars.includes(k) ? "checked" : ""} ${fixed ? "disabled" : ""}>
              <span>${escapeHtml(m.label)}</span></label>`;
          }).join("")}</div>
        </div>`).join("")}</div>`;
  }

  // The player as this widget treats them: with a picked position, that position's group decides
  // the default bars and who they're compared with.
  get shown() {
    const p = this.player;
    if (!p || !this.posOverride) return p;
    return { ...p, posDetail: this.posOverride, pos: roleGroup(this.data, this.posOverride) };
  }

  get isLeague() { return this.source === "league"; }

  // Who can be compared with, and the league list for the League filter, for the current source.
  get src() {
    const { data } = this;
    return this.isLeague
      ? { eligible: data.leagueEligible ?? [], leagues: data.leagueLeagues ?? [], minMinutes: data.leagueMin ?? 900 }
      : { eligible: data.eligible, leagues: data.leagues, minMinutes: data.minMinutes };
  }

  // The stats being shown: the player's World Cup record, or their league row (keeping the
  // position this widget gives them). null when they have no league stats.
  get form() {
    const p = this.shown;
    if (!p || !this.isLeague) return p;
    const row = this.data.leagueByOid?.get(p.optaId);
    return row ? { ...row, pos: p.pos, posDetail: p.posDetail } : null;
  }

  // Picking a position also compares the player with that position (the Position filter shows it
  // and can still be changed); going back to Opta's position goes back to the whole group.
  setPosition(role) {
    this.posOverride = role === this.player.posDetail ? null : role;
    this.filters.roles = new Set(this.posOverride ? [role] : []);
    this.render();
  }

  destroy() {
    this.abort.abort();
    this.el.remove();
  }

  focusSearch() {
    this.searchInput.focus();
    this.el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ---------- search ----------

  setupSearch() {
    const input = this.searchInput;
    input.addEventListener("input", () => this.renderOptions());
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); this.moveHighlight(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); this.moveHighlight(-1); }
      else if (e.key === "Enter" && this.options[this.highlighted]) { e.preventDefault(); this.select(this.options[this.highlighted]); }
      else if (e.key === "Escape") this.closeOptions();
    });
    // mousedown (not click) so the choice lands before the input loses focus.
    this.optionList.addEventListener("mousedown", (e) => {
      const li = e.target.closest("[role=option]");
      if (li) { e.preventDefault(); this.select(this.options[+li.dataset.i]); }
    });
    input.addEventListener("blur", () => this.closeOptions());
    input.addEventListener("focus", () => { if (input.value.trim()) this.renderOptions(); });
  }

  select(p) {
    // Picked roles belong to one position group; drop them when switching to a different group.
    if (this.shown && groupOf(p) !== groupOf(this.shown)) this.filters.roles.clear();
    this.player = p;
    this.posOverride = null;
    // A league average is compared with its own position (average winger vs wingers).
    if (p.isAverage && p.pos !== "GK") this.filters.roles = new Set([p.posDetail]);
    this.render();
    this.searchInput.value = "";
    this.closeOptions();
    this.searchInput.blur();
  }

  renderOptions() {
    const q = fold(this.searchInput.value.trim());
    const words = q.split(/\s+/);
    // Every word must appear; name-starts-with matches first, then the rest.
    this.options = q
      ? this.data.players.filter((p) => words.every((w) => p.search.includes(w)))
          .sort((a, b) => fold(b.name).startsWith(q) - fold(a.name).startsWith(q))
          .slice(0, MAX_OPTIONS)
      : [];
    this.highlighted = 0;
    this.optionList.innerHTML = this.options.length
      ? this.options.map((p, i) => `
          <li role="option" id="opt-${this.id}-${i}" data-i="${i}" aria-selected="${i === 0}">
            ${p.flag ? `<img src="${FLAG_URL(p.flag)}" alt="">` : ""}
            <span class="opt-name">${escapeHtml(p.name)}</span>
            <span class="opt-meta">${p.isAverage ? "League average" : escapeHtml(p.country)} · ${p.pos}</span>
          </li>`).join("")
      : `<li class="opt-empty">No players found</li>`;
    this.optionList.hidden = !q;
    this.searchInput.setAttribute("aria-expanded", String(!!q));
    this.searchInput.setAttribute("aria-activedescendant", this.options.length ? `opt-${this.id}-0` : "");
  }

  moveHighlight(step) {
    if (!this.options.length) return;
    this.highlighted = (this.highlighted + step + this.options.length) % this.options.length;
    this.optionList.querySelectorAll("[role=option]")
      .forEach((li, i) => li.setAttribute("aria-selected", i === this.highlighted));
    this.searchInput.setAttribute("aria-activedescendant", `opt-${this.id}-${this.highlighted}`);
    this.optionList.querySelector(`#opt-${this.id}-${this.highlighted}`).scrollIntoView({ block: "nearest" });
  }

  closeOptions() {
    this.optionList.hidden = true;
    this.searchInput.setAttribute("aria-expanded", "false");
  }

  // ---------- filters ----------

  setupFilters() {
    this.filterBar.innerHTML = FILTER_KINDS.map((kind) => `
      <div class="filter" data-filter="${kind}">
        <button type="button" class="filter-btn" aria-expanded="false"></button>
        <div class="filter-pop" hidden></div>
      </div>`).join("") + `
      <button type="button" class="filter-reset">Reset</button>
      <button type="button" class="filter-reset filter-sync" data-sync="filters" title="Copy these filters to the other players">Sync filters</button>
      <button type="button" class="filter-reset filter-sync" data-sync="metrics" title="Copy these added metrics to the other players">Sync metrics</button>`;

    const close = () => this.filterBar.querySelectorAll(".filter").forEach((f) => {
      f.querySelector(".filter-pop").hidden = true;
      f.querySelector(".filter-btn").setAttribute("aria-expanded", "false");
    });

    this.filterBar.querySelectorAll(".filter").forEach((f) => {
      const kind = f.dataset.filter;
      const btn = f.querySelector(".filter-btn");
      const pop = f.querySelector(".filter-pop");
      btn.addEventListener("click", () => {
        const open = pop.hidden;
        close();
        if (open && !btn.disabled) {
          fillPop(pop, popHtml(kind, this.data, this.src, this.filters[kind]));
          pop.hidden = false;
          btn.setAttribute("aria-expanded", "true");
          pop.querySelector(".pop-search")?.focus();
        }
      });
      pop.addEventListener("change", (e) => {
        const set = this.filters[kind];
        const box = e.target;
        // Group checkboxes ("Top 5 leagues", "Forwards") tick or untick every option under them.
        const values = box.dataset.group ? JSON.parse(box.dataset.group) : [box.value];
        values.forEach((v) => (box.checked ? set.add(v) : set.delete(v)));
        fillPop(pop, popHtml(kind, this.data, this.src, set, pop.querySelector(".pop-search")?.value));
        this.render();
      });
      pop.addEventListener("input", (e) => { if (e.target.matches(".pop-search")) applySearch(pop); });
      pop.addEventListener("click", (e) => {
        if (e.target.matches(".pop-clear")) { this.filters[kind].clear(); close(); this.render(); }
      });
    });

    this.filterBar.querySelector(".filter-reset:not(.filter-sync)").addEventListener("click", () => {
      Object.values(this.filters).forEach((s) => s.clear());
      close();
      this.render();
    });
    this.filterBar.querySelector("[data-sync=filters]").addEventListener("click", () => { close(); syncFilters(this); });
    this.filterBar.querySelector("[data-sync=metrics]").addEventListener("click", () => { close(); syncMetrics(this); });

    const { signal } = this.abort;
    document.addEventListener("click", (e) => { if (!this.filterBar.contains(e.target)) close(); }, { signal });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); }, { signal });
  }

  updateFilterButtons() {
    const { data, filters, shown: p } = this;
    const label = (kind, text) => {
      const btn = this.filterBar.querySelector(`[data-filter=${kind}] .filter-btn`);
      btn.innerHTML = `${text} <span aria-hidden="true">▾</span>`;
      btn.classList.toggle("active", filters[kind].size > 0);
    };
    label("leagues", `League: ${leaguesText(this.src.leagues, data.top5, filters)}`);
    label("confs", `Confederation: ${filters.confs.size ? [...filters.confs].join(", ") : "All"}`);
    label("teams", `Country: ${teamsText(data, filters) ?? "All"}`);
    const isGK = p?.pos === "GK";
    this.filterBar.querySelector("[data-filter=roles] .filter-btn").disabled = !p || isGK;
    const group = p ? `All ${data.positionLabels[p.pos].toLowerCase()}` : "All";
    label("roles", `Position: ${isGK ? "Goalkeepers" : rolesText(data, filters) ?? group}`);
  }

  // Players the selected player is ranked against.
  comparisonPool() {
    const { filters: f, shown: p } = this;
    return this.src.eligible.filter((q) =>
      (p.pos === "GK" ? q.pos === "GK"
        : f.roles.size ? q.pos !== "GK" && f.roles.has(q.posDetail) : q.pos === p.pos)
      && (!f.leagues.size || f.leagues.has(q.leagueId))
      && (!f.confs.size || f.confs.has(q.conf))
      && (!f.teams.size || f.teams.has(q.team)));
  }

  poolDescription(n) {
    const { data, filters: f, shown: p } = this;
    const who = p.pos !== "GK" && f.roles.size ? rolesText(data, f, true) : data.positionLabels[p.pos].toLowerCase();
    const parts = [`${n} ${who}`];
    if (f.leagues.size) {
      const leagues = leaguesText(this.src.leagues, data.top5, f);
      parts.push(leagues === "Top 5" ? "in the top 5 leagues" : `in ${leagues}`);
    }
    const from = [...f.confs, teamsText(data, f)].filter(Boolean);
    if (from.length) parts.push(`from ${from.join(", ")}`);
    return parts.join(" ");
  }

  // ---------- render ----------

  render() {
    this.updateFilterButtons();
    const p = this.shown;
    const addButton = `<button type="button" class="add-widget" aria-label="Add a player to compare"
      title="Add a player to compare">+</button>`;
    if (!p) {
      this.view.innerHTML = `<div class="player-empty"><p>Search a player above to compare.</p></div>`;
      return;
    }
    const initials = p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("");
    const photo = p.photo
      ? `<img class="player-photo" src="${p.photo}" alt="${escapeHtml(p.name)}"
           onerror="this.replaceWith(Object.assign(document.createElement('div'), {className: 'player-photo initials', textContent: '${escapeHtml(initials)}'}))">`
      : `<div class="player-photo initials">${escapeHtml(initials)}</div>`;
    const flag = p.flag ? `<img class="player-flag" src="${FLAG_URL(p.flag)}" alt="">` : "";
    const broad = ({ GK: "Goalkeeper", DF: "Defender", MF: "Midfielder", FW: "Forward" })[this.player.pos];
    const position = roleLabel(this.data, p.posDetail) ?? broad;
    // Apps, minutes, goals and assists for whichever competition is shown.
    const f = this.form ?? {};
    // Averages keep a decimal (5.2 goals); real players' counts are whole numbers.
    const num = (v) => (v == null ? "–" : p.isAverage && !Number.isInteger(v) ? v.toFixed(1) : Math.round(v));
    const facts = [
      ["Age", p.age ?? "–"],
      ["Apps", num(f.apps)],
      ["Minutes", num(f.mins)],
      ...(p.pos === "GK" ? [] : [["Goals", num(f.goals ?? (f.mins ? 0 : null))], ["Assists", num(f.assists ?? (f.mins ? 0 : null))]]),
    ];
    const club = this.isLeague && this.form
      ? `${escapeHtml(this.form.club)} · ${escapeHtml(this.form.league)} ${escapeHtml(this.form.season)}`
      : p.isAverage ? `Average of ${p.count} World Cup player${p.count === 1 ? "" : "s"} from ${escapeHtml(p.league)}`
      : `${escapeHtml(p.club || "No club")}${p.league ? ` · ${escapeHtml(p.league)}` : ""}`;

    this.view.innerHTML = `
      <div class="player-card">
        ${photo}
        <div class="player-name">${escapeHtml(p.name)}</div>
        <div class="player-country">${flag}${escapeHtml(p.country)}</div>
        <div class="player-club">${club}</div>
        <div class="player-pos">${this.positionHtml(position)}</div>
        <dl class="player-facts">
          ${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}
        </dl>
        ${addButton}
      </div>
      <div class="player-stats">${this.statsHtml()}</div>`;
    colorCompare();
  }

  // Outfield players who played get a position dropdown; Opta's position is listed first.
  positionHtml(label) {
    const p = this.player;
    if (!p.mins || p.pos === "GK" || p.isAverage) return escapeHtml(label);
    const original = p.posDetail;
    const current = this.posOverride ?? original;
    const groups = Object.entries(this.data.roles).map(([group, roles]) => `
      <optgroup label="${escapeHtml(group)}">${Object.entries(roles).map(([id, [name]]) =>
        `<option value="${escapeHtml(id)}" ${id === current ? "selected" : ""}>${escapeHtml(name)}${id === original ? " (Opta)" : ""}</option>`).join("")}
      </optgroup>`).join("");
    // A couple of players have no detailed position in Opta's data: start from their broad group.
    const unknown = roleGroup(this.data, original) ? ""
      : `<option value="${escapeHtml(original)}" ${current === original ? "selected" : ""}>${escapeHtml(label)}</option>`;
    return `<label class="pos-picker${this.posOverride ? " is-changed" : ""}" title="Change position">
      <span class="visually-hidden">Position</span>
      <select class="pos-select">${unknown}${groups}</select></label>`;
  }

  statsHtml() {
    const { data, statMode } = this;
    const player = this.shown;
    const group = data.positionLabels[player.pos].toLowerCase();
    if (this.isLeague && !data.leagueByOid) return `<p class="stats-empty">Loading league stats…</p>`;
    const p = this.form;
    if (this.isLeague && !p) {
      const covered = data.leagueLeagues.map((l) => l.label).join(", ");
      return `<p class="stats-empty">No 2025/26 league stats for ${escapeHtml(player.name)}. League form covers: ${escapeHtml(covered)}.</p>`;
    }
    if (!p.mins) {
      return `<p class="stats-empty">${p.isAverage ? `No ${escapeHtml(p.league)} players in this position played 90+ World Cup minutes.`
        : "Didn't play at the World Cup, so there are no stats to show."}</p>`;
    }

    const { minMinutes } = this.src;
    const what = this.isLeague ? "league minutes" : "minutes";
    const pool = this.comparisonPool();
    const ranked = p.mins >= minMinutes && pool.length >= MIN_POOL;
    const unit = statMode === "p90" ? "per 90" : this.isLeague ? "season totals" : "tournament totals";
    // In league form, nationality is only known for World Cup players.
    const nationNote = this.isLeague && (this.filters.confs.size || this.filters.teams.size)
      ? " (World Cup players only)" : "";
    const season = this.isLeague ? " in 2025/26" : " at the World Cup";
    let head;
    if (p.mins < minMinutes) {
      head = `Played under ${minMinutes} ${what}${season}, too few to rank against other ${group}. Showing ${unit}.`;
    } else if (pool.length < MIN_POOL) {
      head = `Only ${this.poolDescription(pool.length)}${nationNote} with ${minMinutes}+ ${what}, too few to compare. Try widening the filters.`;
    } else {
      head = `Percentile vs ${this.poolDescription(pool.length)}${nationNote} with ${minMinutes}+ ${what}${season}, ${unit}`;
    }

    const defaults = data.defaultBars[p.pos];
    // Added metrics a different kind of player can't have (goalkeeping vs outfield) are skipped.
    const keys = [...defaults, ...this.extraBars.filter((k) => !defaults.includes(k) && data.metrics[k]
      && k.startsWith("gk:") === (p.pos === "GK"))];
    const rows = keys.map((key) => {
      const s = { key, ...data.metrics[key] };
      const value = statValue(p, key, statMode);
      const added = !defaults.includes(key);
      const remove = added ? `<button type="button" class="bar-remove" data-key="${key}"
        aria-label="Remove ${escapeHtml(s.label)}" title="Remove">×</button>` : "";
      if (value == null) {
        // e.g. goals per xG with too little xG to mean anything
        return `<div class="bar-row"><div class="bar-label"><span class="bar-name">${escapeHtml(s.label)}</span>${remove}</div>
          <div class="bar-empty">Not enough data for this player</div></div>`;
      }
      const values = pool.map((q) => statValue(q, key, statMode)).filter((v) => v != null);
      const pct = ranked && values.length >= MIN_POOL ? percentile(values, value, s.lowerIsBetter) : null;
      const shown = formatValue(value, s.kind, statMode, key);
      const note = s.lowerIsBetter ? `<span class="bar-note">lower is better</span>` : "";
      const fill = pct ?? 0;
      // The value tag sits just inside the end of the blue; on short bars it sits just past the end.
      const tipClass = fill >= 22 ? "bar-tip inside" : "bar-tip outside";
      return `
        <div class="bar-row" data-key="${key}" data-value="${value}" title="${escapeHtml(s.label)}: ${shown}${statMode === "p90" && s.kind === "per90" ? " per 90" : ""}${pct == null ? "" : `, ${ordinal(pct)} percentile`}">
          <div class="bar-label"><span class="bar-name">${escapeHtml(s.label)}</span>${note}${remove}</div>
          <div class="bar-line">
            <div class="bar-track" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${fill}"
                 aria-label="${escapeHtml(s.label)} percentile">
              <div class="bar-fill" style="width: ${fill}%"></div>
              <span class="${tipClass}" style="left: ${fill}%">${shown}</span>
            </div>
            <span class="bar-pct">${pct == null ? "–" : ordinal(pct)}</span>
          </div>
        </div>`;
    });
    // The key for colorCompare(); the CSS shows it only when 2+ players are open.
    const key = `<p class="compare-key">Stat names compare the open players:
      <span style="color:${COMPARE_BEST}">best</span> · <span style="color:${COMPARE_MID(0)}">in between</span> ·
      <span style="color:${COMPARE_WORST}">worst</span></p>`;
    return `<p class="stats-head">${head}</p>` + key + rows.join("");
  }
}

// ---------- shared helpers ----------

const groupOf = (p) => p.pos;
const ROLE_GROUPS = { Forwards: "FW", Midfielders: "MF", Defenders: "DF" };

// "Central Defender" -> "Centre back"; null for positions outside the list (Goalkeeper, "0").
function roleLabel(data, role) {
  for (const roles of Object.values(data.roles)) if (role in roles) return roles[role][0];
  return null;
}

// "Winger" -> "FW": the position group a detailed position belongs to.
function roleGroup(data, role) {
  const [group] = Object.entries(data.roles).find(([, roles]) => role in roles) ?? [];
  return ROLE_GROUPS[group];
}

// Every league with ranked players: top 5 first (in a fixed order), then the rest by player count.
function leagueList(eligible, top5) {
  const counts = d3.rollup(eligible.filter((p) => p.leagueId), (v) => v.length, (p) => p.leagueId);
  const sample = new Map(eligible.map((p) => [p.leagueId, p]));
  const names = d3.rollup([...sample.values()], (v) => v.length, (p) => p.league);
  return [...counts].map(([id, n]) => {
    const p = sample.get(id);
    // Same short name in several countries ("Ligue 1", "Premier League"): add the country.
    const label = names.get(p.league) > 1 ? `${p.league} (${p.leagueCountry})` : p.league;
    return { id, label, country: p.leagueCountry, count: n, top5: top5.includes(id) };
  }).sort((a, b) => (a.top5 && b.top5 ? top5.indexOf(a.id) - top5.indexOf(b.id)
    : b.top5 - a.top5 || b.count - a.count));
}

// The 48 teams grouped by how far they got; alphabetical within a stage.
function teamsByStage(countries) {
  const teams = Object.entries(countries).filter(([, c]) => c.worldCup)
    .map(([code, c]) => ({ code, name: c.name, flag: c.flag, result: c.worldCup.result }));
  return STAGES.map(([result, heading]) => ({
    heading,
    teams: teams.filter((t) => t.result === result).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((s) => s.teams.length);
}

// Partly-selected group boxes show the dash state (only settable from script).
function fillPop(pop, html) {
  pop.innerHTML = html;
  pop.querySelectorAll("input.partial").forEach((box) => { box.indeterminate = true; });
  applySearch(pop);
}

// Hide options in the searchable part that don't match the search box, and any section left empty.
function applySearch(pop) {
  const input = pop.querySelector(".pop-search");
  if (!input) return;
  const q = fold(input.value.trim());
  pop.querySelectorAll(".pop-searchable label:not(.pop-group)").forEach((l) => {
    l.hidden = !fold(l.textContent).includes(q);
  });
  pop.querySelectorAll(".pop-searchable .pop-section").forEach((s) => {
    s.hidden = !s.querySelector("label:not(.pop-group):not([hidden])");
  });
}

function checkbox(value, label, checked, extra = "") {
  return `<label><input type="checkbox" value="${escapeHtml(value)}" ${checked ? "checked" : ""}>
    <span>${label}</span>${extra}</label>`;
}

function groupBox(label, values, set) {
  const n = values.filter((v) => set.has(v)).length;
  return `<label class="pop-group"><input type="checkbox" data-group='${escapeHtml(JSON.stringify(values))}'
    ${n === values.length ? "checked" : ""} ${n > 0 && n < values.length ? 'class="partial"' : ""}>
    <span>${label}</span></label>`;
}

function popHtml(kind, data, src, set, search = "") {
  const count = (n) => `<span class="pop-count">${n}</span>`;
  if (kind === "leagues") {
    const top = src.leagues.filter((l) => l.top5);
    const other = src.leagues.filter((l) => !l.top5);
    return `
      ${groupBox("Top 5 leagues", top.map((l) => l.id), set)}
      <div class="pop-indent">${top.map((l) => checkbox(l.id, escapeHtml(l.label), set.has(l.id), count(l.count))).join("")}</div>
      <div class="pop-divider">Other leagues</div>
      <input class="pop-search" type="search" placeholder="Find a league…" value="${escapeHtml(search)}">
      <div class="pop-searchable">${other.map((l) => checkbox(l.id, escapeHtml(l.label), set.has(l.id), count(l.count))).join("")}</div>
      <button type="button" class="pop-clear">Clear</button>`;
  }
  if (kind === "teams") {
    const counts = d3.rollup(src.eligible, (v) => v.length, (p) => p.team);
    const flag = (t) => (t.flag ? `<img class="pop-flag" src="${FLAG_URL(t.flag)}" alt="">` : "");
    return `
      <input class="pop-search" type="search" placeholder="Find a country…" value="${escapeHtml(search)}">
      <div class="pop-searchable">${data.teams.map((s) => `
        <div class="pop-section">
          ${s.teams.length > 1 ? groupBox(s.heading, s.teams.map((t) => t.code), set) : `<div class="pop-stage">${s.heading}</div>`}
          <div class="pop-indent">${s.teams.map((t) =>
            checkbox(t.code, `${flag(t)}${escapeHtml(t.name)}`, set.has(t.code), count(counts.get(t.code) ?? 0))).join("")}</div>
        </div>`).join("")}</div>
      <button type="button" class="pop-clear">Clear</button>`;
  }
  if (kind === "confs") {
    const counts = d3.rollup(src.eligible, (v) => v.length, (p) => p.conf);
    return CONFEDERATIONS.map((c) => checkbox(c, c, set.has(c), count(counts.get(c) ?? 0))).join("")
      + `<button type="button" class="pop-clear">Clear</button>`;
  }
  const counts = d3.rollup(src.eligible, (v) => v.length, (p) => p.posDetail);
  return Object.entries(data.roles).map(([group, roles]) => `
      ${groupBox(group, Object.keys(roles), set)}
      <div class="pop-indent">${Object.entries(roles)
        .map(([id, [label]]) => checkbox(id, escapeHtml(label), set.has(id), count(counts.get(id) ?? 0))).join("")}</div>`)
    .join("") + `<button type="button" class="pop-clear">Clear</button>`;
}

function leaguesText(leagues, top5, filters) {
  const s = filters.leagues;
  if (!s.size) return "All";
  if (s.size === top5.length && top5.every((l) => s.has(l))) return "Top 5";
  const labels = leagues.filter((l) => s.has(l.id)).map((l) => l.label);
  return labels.length <= 2 ? labels.join(", ") : `${labels.length} leagues`;
}

function teamsText(data, filters) {
  if (!filters.teams.size) return null;
  const names = data.teams.flatMap((s) => s.teams).filter((t) => filters.teams.has(t.code)).map((t) => t.name);
  return names.length <= 2 ? names.join(", ") : `${names.length} countries`;
}

// Button text ("Winger, Striker") or, with plural, pool text ("wingers and strikers").
function rolesText(data, filters, plural = false) {
  if (!filters.roles.size) return null;
  const picked = Object.values(data.roles).flatMap((r) => Object.entries(r))
    .filter(([id]) => filters.roles.has(id)).map(([, names]) => names[plural ? 1 : 0]);
  if (picked.length > 2) return plural ? `players in ${picked.length} positions` : `${picked.length} positions`;
  return picked.join(plural ? " and " : ", ");
}

// Share of the pool this value beats (ties count half), 0-100.
function percentile(values, v, lowerIsBetter) {
  const below = values.filter((x) => (lowerIsBetter ? x > v : x < v)).length;
  const equal = values.filter((x) => x === v).length;
  return Math.round((100 * (below + 0.5 * equal)) / values.length);
}

// Counts are stored as [per 90, total]; percentages and ratios as one number for both modes.
function statValue(p, key, mode) {
  const v = p.stats[key];
  if (v == null) return null;
  return Array.isArray(v) ? v[mode === "p90" ? 0 : 1] : v;
}

function formatValue(v, kind, mode, key) {
  if (kind === "pct") return `${v.toFixed(1)}%`;
  // "Goals minus xG": show the sign so over- and under-performance read at a glance.
  const sign = key.includes("_vs_") && v > 0 ? "+" : "";
  if (mode === "total" && Number.isInteger(v)) return sign + v;
  return sign + v.toFixed(2);
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Lowercase and strip accents so "mbappe" finds "Mbappé".
function fold(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
