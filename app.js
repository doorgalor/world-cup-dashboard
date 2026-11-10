// World map: colour each country by how far it got at the 2026 World Cup, with a hover card.
// Data comes from scripts/build_map_data.py (web/data/*.json).

const WIDTH = 960;
const PAD = 6;
const SMALL_AREA = 10; // px² at full-world zoom: Curaçao, Cabo Verde, Qatar get a dot so they can be hovered
const MARKER_R = 6; // on-screen radius, kept the same at every zoom level
const MARKER_HIDE_ZOOM = 4; // dots disappear at this zoom level and beyond
const TOOLTIP_OFFSET = 16;
const FLAG_URL = (code) => `https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/flags/4x3/${code}.svg`;

const RESULT_TEXT = { Winner: "Won the 2026 World Cup" };

// Heat map: pale lavender (fewest players) through pink to deep crimson (most), blended smoothly.
const HEAT_COLORS = ["#f1eef6", "#d4b9da", "#c994c7", "#df65b0", "#e7298a", "#ce1256", "#980043"];
const HEAT_TICKS = [0.1, 1, 5]; // % of all World Cup squad players

const svg = d3.select("#map");
const tooltip = document.getElementById("tooltip");

Promise.all([d3.json("data/world.geojson"), d3.json("data/countries.json")]).then(([world, countries]) => {
  const byMapId = new Map(Object.values(countries).map((c) => [c.mapId, c]));
  const status = (id) => mapStatus(byMapId.get(id));

  // Robinson (from d3-geo-projection), sized to the full width; the height follows the map's own
  // shape so there's no empty band above or below it.
  const projection = d3.geoRobinson().fitWidth(WIDTH - 2 * PAD, world);
  const path = d3.geoPath(projection);
  const [[, y0], [, y1]] = path.bounds(world);
  const HEIGHT = Math.ceil(y1 - y0) + 2 * PAD;
  projection.fitExtent([[PAD, PAD], [WIDTH - PAD, HEIGHT - PAD]], world);
  svg.attr("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
  const g = svg.append("g");

  const shapes = g.selectAll("path")
    .data(world.features)
    .join("path")
    .attr("class", (d) => `country ${status(d.id)}`)
    .attr("d", path);

  // Tiny World Cup nations (Curaçao, Cabo Verde, ...) get a dot on top of their shape.
  const tiny = world.features.filter((d) => byMapId.get(d.id)?.worldCup && path.area(d) < SMALL_AREA);
  const markers = g.selectAll("circle")
    .data(tiny)
    .join("circle")
    .attr("class", (d) => `marker ${status(d.id)}`)
    .attr("cx", (d) => path.centroid(d)[0])
    .attr("cy", (d) => path.centroid(d)[1])
    .attr("r", MARKER_R);

  // Heat map mode: shade countries by the share of all World Cup squad players in their leagues.
  // Log scale, since England (16%) would otherwise wash out everyone else.
  const heatValue = (id) => byMapId.get(id)?.league?.allShare ?? 0;
  const values = world.features.map((d) => heatValue(d.id)).filter((v) => v > 0);
  const heat = d3.scaleSequentialLog([d3.min(values), d3.max(values)], d3.interpolateRgbBasis(HEAT_COLORS));
  const heatFill = (d) => (heatValue(d.id) ? heat(heatValue(d.id)) : "var(--country-none)");
  drawHeatLegend(heat);

  const setMode = (heatOn) => {
    shapes.style("fill", heatOn ? heatFill : null);
    markers.style("fill", heatOn ? heatFill : null);
    document.getElementById("legend-result").hidden = heatOn;
    document.getElementById("legend-heat").hidden = !heatOn;
  };
  const toggle = document.getElementById("heat-toggle");
  toggle.addEventListener("change", () => setMode(toggle.checked));
  setMode(toggle.checked);

  // Bring the hovered shape to the front so its outline isn't hidden by neighbours.
  const setActive = (id) => {
    shapes.classed("active", (d) => d.id === id).filter((d) => d.id === id).raise();
    markers.classed("active", (d) => d.id === id).raise();
  };

  let activeId = null;
  const show = (event, d) => {
    if (d.id !== activeId) {
      tooltip.innerHTML = cardHtml(byMapId.get(d.id), d.properties.name);
      tooltip.hidden = false;
      activeId = d.id;
      setActive(d.id);
    }
    position(event);
  };
  const hide = () => {
    if (activeId === null) return;
    tooltip.hidden = true;
    activeId = null;
    setActive(null);
  };

  // One handler for the whole map: whatever is under the pointer decides. (Per-shape enter/leave
  // events get lost when the hovered shape is raised to the front.)
  const onPointer = (event) => {
    const d = d3.select(event.target).datum();
    if (d?.type === "Feature" && event.target.matches(".country, .marker")) show(event, d);
    else hide();
  };
  svg.on("pointermove", onPointer)
    .on("click", onPointer) // tap on touch screens
    .on("pointerleave", hide);

  // Zoom & pan: needed for Europe (England/Scotland) and small countries.
  const zoom = d3.zoom()
    .scaleExtent([1, 12])
    .translateExtent([[0, 0], [WIDTH, HEIGHT]])
    .on("zoom", ({ transform }) => {
      g.attr("transform", transform);
      // Dots only help at world scale; zoomed in, the real shapes are big enough to hover.
      markers.attr("r", MARKER_R / transform.k).attr("display", transform.k >= MARKER_HIDE_ZOOM ? "none" : null);
      hide();
    });
  svg.call(zoom);
  // Full screen: the whole map panel (toggle, legend, map, controls) fills the window, and the
  // browser's real full screen is requested on top where it's allowed (some embedded browsers refuse).
  const panel = document.querySelector(".map-panel");
  const fsButton = document.getElementById("fullscreen-btn");
  const setExpanded = (on) => {
    panel.classList.toggle("is-fullscreen", on);
    document.body.classList.toggle("map-fullscreen", on);
    fsButton.setAttribute("aria-label", on ? "Exit full screen" : "Full screen");
    fsButton.title = on ? "Exit full screen (Esc)" : "Full screen";
    hide();
  };
  fsButton.addEventListener("click", () => {
    const on = !panel.classList.contains("is-fullscreen");
    setExpanded(on);
    if (on) panel.requestFullscreen?.().catch(() => {});
    else if (document.fullscreenElement) document.exitFullscreen();
  });
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) setExpanded(false); // left via Esc or the browser
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("is-fullscreen")) setExpanded(false);
  });

  document.querySelectorAll("[data-zoom]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.zoom;
      const t = svg.transition().duration(300);
      if (action === "reset") zoom.transform(t, d3.zoomIdentity);
      else zoom.scaleBy(t, action === "in" ? 1.6 : 1 / 1.6);
    });
  });
});

function drawHeatLegend(scale) {
  const [min, max] = scale.domain();
  const [lo, hi] = [Math.log(min), Math.log(max)];
  const at = (v) => ((Math.log(v) - lo) / (hi - lo)) * 100; // % along the bar
  const stops = d3.range(0, 1.01, 0.1).map((t) => `${scale(Math.exp(lo + t * (hi - lo)))} ${t * 100}%`);
  document.querySelector(".heat-bar").style.background = `linear-gradient(to right, ${stops.join(", ")})`;
  // End labels align to the bar's edges so they don't spill past it.
  const ticks = [min, ...HEAT_TICKS.filter((v) => v > min * 2 && v < max * 0.6), max];
  document.querySelector(".heat-ticks").innerHTML = ticks.map((v, i) => {
    const shift = i === 0 ? "0" : i === ticks.length - 1 ? "-100%" : "-50%";
    return `<span style="left: ${at(v)}%; transform: translateX(${shift})">${+v.toFixed(1)}%</span>`;
  }).join("");
}

// "knockout" / "group" for World Cup teams; non-qualifiers are "league" if their leagues still had
// World Cup players (Italy), otherwise "none".
function mapStatus(c) {
  if (c?.worldCup) return c.worldCup.status;
  const l = c?.league;
  return l && l.players + l.otherLeaguePlayers > 0 ? "league" : "none";
}

function cardHtml(c, fallbackName) {
  if (!c) return `<div class="tt-head">${escapeHtml(fallbackName)}</div>`;

  const titles = c.titles ? `<span class="tt-titles">${c.titles}x Winner</span>` : "";
  const flag = c.flag ? `<img src="${FLAG_URL(c.flag)}" alt="">` : "";
  const status = mapStatus(c);
  const result = c.worldCup ? (RESULT_TEXT[c.worldCup.result] ?? c.worldCup.result) : "Did not qualify";
  // Non-qualifiers get no colour box: there's no tournament result for it to mark.
  const swatch = c.worldCup ? `<span class="swatch ${status}"></span>` : "";

  let league = "";
  if (c.league) {
    const other = c.league.otherLeaguePlayers
      ? `<div class="tt-note">+${c.league.otherLeaguePlayers} more from other leagues in ${escapeHtml(c.name)}</div>`
      : "";
    league = `
      <div class="tt-league">
        <div class="tt-label">League</div>
        <div class="tt-league-body">
          <div class="tt-league-name">${escapeHtml(c.league.name)}</div>
          <div>Rank: ${c.league.rank}</div>
          <div>Players in World Cup squads: ${c.league.players}
            <span class="tt-share" title="Share of all World Cup squad players">(${c.league.share.toFixed(1)}%)</span></div>
          ${other}
        </div>
      </div>`;
  }

  return `
    <div class="tt-head">${escapeHtml(c.name)} ${flag} ${titles}</div>
    <div class="tt-rank">FIFA Rank: ${c.fifaRank}</div>
    <div class="tt-result">${swatch}${escapeHtml(result)}</div>
    ${league}`;
}

// The card sits just below-right of the cursor and flips to the other side when it would run past
// the edge of the map or the window, so it never sits on top of the country being hovered.
function position(event) {
  if (tooltip.hidden) return;
  const map = document.querySelector(".map-wrap").getBoundingClientRect();
  const right = Math.min(map.right, window.innerWidth - 8);
  const bottom = Math.min(map.bottom, window.innerHeight - 8);
  const { width, height } = tooltip.getBoundingClientRect();
  const { clientX: cx, clientY: cy } = event;
  const x = cx + TOOLTIP_OFFSET + width > right ? cx - TOOLTIP_OFFSET - width : cx + TOOLTIP_OFFSET;
  const y = cy + TOOLTIP_OFFSET + height > bottom ? cy - TOOLTIP_OFFSET - height : cy + TOOLTIP_OFFSET;
  tooltip.style.left = `${Math.max(8, x)}px`;
  tooltip.style.top = `${Math.max(8, y)}px`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}
