const GENE_COLOR = {
  ASPN: "#8e1918",
  SFRP4: "#1c7170",
  COL11A1: "#1e4d8c",
  ADAM12: "#8a5a12",
  POSTN: "#2f6b3a",
  SPP1: "#6b3a6a",
};

const titleEl = document.getElementById("title");
const heroEl = document.getElementById("hero");
const countEl = document.getElementById("count");
const progressEl = document.getElementById("progress");
const prevNameEl = document.getElementById("prev-name");
const nextNameEl = document.getElementById("next-name");
const railEl = document.getElementById("rail");
const stageEl = document.getElementById("stage");
const errorEl = document.getElementById("error");
const slideEl = document.getElementById("slide");

let sensors = [];
let index = 0;
let selected = null;
let view = null;
let markTimer = null;

function formatEnergy(value) {
  const sign = value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(2)}`;
}

function showError(message) {
  errorEl.textContent = message || "";
}

function ensureView() {
  if (view) return view;
  const Forna = (window.fornac && window.fornac.FornaContainer) || window.FornaContainer;
  if (!Forna) throw new Error("FORNA library did not load.");
  const width = Math.max(320, stageEl.clientWidth || 640);
  const height = Math.max(360, stageEl.clientHeight || 540);
  view = new Forna("#stage", {
    applyForce: true,
    allowPanningAndZooming: true,
    initialSize: [width, height],
  });
  return view;
}

function colorMap(sensor) {
  const hexes = {};
  sensor.colors.forEach((hex, i) => {
    hexes[String(i + 1)] = hex;
  });
  return hexes;
}

function markCodon(sensor) {
  if (!sensor.codonStart || !sensor.codonEnd) return;
  for (let i = sensor.codonStart; i <= sensor.codonEnd; i += 1) {
    const node = stageEl.querySelector(`g.gnode[num="n${i}"]`);
    if (node) node.classList.add("uag-codon");
  }
  if (selected != null) {
    const picked = stageEl.querySelector(`g.gnode[num="n${selected + 1}"]`);
    if (picked) picked.classList.add("is-picked");
  }
}

function watchCodon(sensor) {
  window.clearInterval(markTimer);
  markCodon(sensor);
  let ticks = 0;
  markTimer = window.setInterval(() => {
    markCodon(sensor);
    ticks += 1;
    if (ticks > 16) window.clearInterval(markTimer);
  }, 250);
}

function fitNow(container) {
  const nodes = [...stageEl.querySelectorAll("g.gnode")];
  const xs = [];
  const ys = [];
  nodes.forEach((node) => {
    const match = /translate\(([-\d.]+),([-\d.]+)\)/.exec(node.getAttribute("transform") || "");
    if (!match) return;
    xs.push(Number(match[1]));
    ys.push(Number(match[2]));
  });
  const svg = stageEl.querySelector("svg");
  const zoom = nodes[0] && nodes[0].parentElement && nodes[0].parentElement.parentElement;
  if (!xs.length || !svg || !zoom) return;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const svgW = Math.max(320, stageEl.clientWidth);
  const svgH = Math.max(320, stageEl.clientHeight);
  svg.setAttribute("width", String(svgW));
  svg.setAttribute("height", String(svgH));
  if (container && container.options) {
    container.options.svgW = svgW;
    container.options.svgH = svgH;
  }
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const scale = 0.98 * Math.min(svgW / (width + 8), svgH / (height + 8));
  const translateX = -minX * scale + (svgW - width * scale) / 2;
  const translateY = -minY * scale + (svgH - height * scale) / 2;
  zoom.setAttribute("transform", `translate(${translateX},${translateY}) scale(${scale})`);
  if (container.zoomer) {
    container.zoomer.translate([translateX, translateY]);
    container.zoomer.scale(scale);
  }
}

function keepTitleVisible() {
  slideEl.scrollTop = 0;
  const root = document.scrollingElement;
  if (root) root.scrollTop = 0;
}

let swayTimer = null;

function stopSway() {
  window.clearInterval(swayTimer);
  swayTimer = null;
}

function driveForce(force) {
  if (force.__swayTick) return force.__swayTick;
  const step = force.tick.bind(force);
  force.tick = function stopAutomaticTimer() {
    return true;
  };
  force.__swayTick = step;
  return step;
}

function stepSway(force) {
  const step = driveForce(force);
  const nodes = typeof force.nodes === "function" ? force.nodes() : [];
  const held = nodes.some((node) => node.fixed);
  if (!held) {
    const t = performance.now() / 1000;
    nodes.forEach((node, i) => {
      if (node.nodeType !== "nucleotide") return;
      node.px += Math.sin(t * 1.7 + i * 0.9) * 1.6;
      node.py += Math.cos(t * 1.3 + i * 1.2) * 1.6;
    });
  }
  if (force.alpha && force.alpha() < 0.03) force.alpha(0.03);
  step();
  if (held || !force.__anchor) return;
  let x = 0;
  let y = 0;
  let count = 0;
  nodes.forEach((node) => {
    if (node.nodeType !== "nucleotide") return;
    x += node.x;
    y += node.y;
    count += 1;
  });
  if (!count) return;
  const dx = force.__anchor.x - x / count;
  const dy = force.__anchor.y - y / count;
  nodes.forEach((node) => {
    node.x += dx;
    node.y += dy;
    node.px += dx;
    node.py += dy;
  });
}

function settleAndFit(container) {
  const force = container.force;
  const step = force && typeof force.tick === "function" ? driveForce(force) : null;
  if (step) {
    try {
      for (let i = 0; i < 400; i += 1) {
        if (step()) break;
      }
    } catch (err) {
      // The drawing still uses the initial layout if a tick cannot run.
    }
  }
  if (force && force.alpha) force.alpha(0);
  if (force && force.stop) force.stop();
  fitNow(container);
  if (force && typeof force.nodes === "function") {
    let x = 0;
    let y = 0;
    let count = 0;
    force.nodes().forEach((node) => {
      if (node.nodeType !== "nucleotide") return;
      x += node.x;
      y += node.y;
      count += 1;
    });
    if (count) force.__anchor = { x: x / count, y: y / count };
  }
  stopSway();
  if (step) swayTimer = window.setInterval(() => stepSway(force), 40);
}

function drawStructure(sensor) {
  showError("");
  const container = ensureView();
  container.clearNodes();
  container.addRNA(sensor.structure, {
    sequence: sensor.sequence,
    name: "sensor",
    labelInterval: 10,
  });
  const hexes = colorMap(sensor);
  container.addCustomColors({
    domain: [0, 1],
    range: ["#0000ff", "#ff0000"],
    colorValues: { sensor: hexes, "": hexes },
  });
  container.changeColorScheme("custom");
  settleAndFit(container);
  watchCodon(sensor);
  window.setTimeout(() => {
    if (document.activeElement === stageEl) stageEl.blur();
  }, 0);
}

function selectNucleotide(i) {
  selected = i;
  stageEl.querySelectorAll("g.gnode.is-picked").forEach((node) => node.classList.remove("is-picked"));
  const picked = stageEl.querySelector(`g.gnode[num="n${i + 1}"]`);
  if (picked) picked.classList.add("is-picked");
}

function renderRail() {
  railEl.replaceChildren();
  let currentGene = "";
  let block = null;
  sensors.forEach((sensor, i) => {
    if (sensor.gene !== currentGene) {
      currentGene = sensor.gene;
      block = document.createElement("section");
      block.className = "gene-block";
      const heading = document.createElement("h2");
      heading.className = "gene-name";
      heading.textContent = sensor.gene;
      block.append(heading);
      railEl.append(block);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cand";
    button.dataset.index = String(i);
    if (i === index) button.setAttribute("aria-current", "true");
    const id = document.createElement("span");
    id.className = "cand-id";
    id.textContent = sensor.candidate;
    const mfe = document.createElement("span");
    mfe.className = "cand-mfe";
    mfe.textContent = formatEnergy(sensor.mfe);
    button.append(id, mfe);
    button.addEventListener("click", () => show(i));
    block.append(button);
  });
}

function show(nextIndex, options = {}) {
  const wrapped = (nextIndex + sensors.length) % sensors.length;
  index = wrapped;
  if (!options.keepSelection) selected = null;
  const sensor = sensors[index];
  const previous = sensors[(index - 1 + sensors.length) % sensors.length];
  const next = sensors[(index + 1) % sensors.length];

  document.documentElement.style.setProperty("--gene", GENE_COLOR[sensor.gene] || "#8e1918");
  titleEl.textContent = sensor.name;
  countEl.textContent = `${index + 1} / ${sensors.length}`;
  progressEl.style.width = `${((index + 1) / sensors.length) * 100}%`;
  prevNameEl.textContent = previous.name;
  nextNameEl.textContent = next.name;
  document.title = `${sensor.name} · RADAR sensor structures`;

  heroEl.classList.remove("rise");
  void heroEl.offsetWidth;
  heroEl.classList.add("rise");

  renderRail();
  const current = railEl.querySelector('[aria-current="true"]');
  if (current) {
    const top = current.offsetTop;
    const bottom = top + current.offsetHeight;
    if (top < railEl.scrollTop) railEl.scrollTop = top - 8;
    else if (bottom > railEl.scrollTop + railEl.clientHeight) {
      railEl.scrollTop = bottom - railEl.clientHeight + 8;
    }
  }

  if (location.hash !== `#${sensor.id}`) {
    history.replaceState(null, "", `#${sensor.id}`);
  }

  try {
    drawStructure(sensor);
  } catch (error) {
    showError(`FORNA could not draw this structure: ${error.message}`);
  }
  keepTitleVisible();
}

function indexFromHash() {
  const id = location.hash.replace("#", "");
  const found = sensors.findIndex((sensor) => sensor.id === id);
  return found >= 0 ? found : 0;
}

function handOver() {
  if (document.activeElement === stageEl) stageEl.blur();
}

stageEl.addEventListener("pointerdown", handOver);
stageEl.addEventListener("wheel", handOver, { passive: true });

stageEl.addEventListener("click", (event) => {
  const node = event.target.closest("g.gnode");
  if (!node) return;
  const num = node.getAttribute("num") || "";
  const nucleotide = Number(num.replace(/^n/, ""));
  if (!nucleotide) return;
  selectNucleotide(nucleotide - 1);
});

stageEl.addEventListener("wheel", (event) => {
  event.preventDefault();
}, { passive: false });

document.getElementById("prev").addEventListener("click", () => show(index - 1));
document.getElementById("next").addEventListener("click", () => show(index + 1));
document.getElementById("reset").addEventListener("click", () => {
  selected = null;
  show(index);
});

window.addEventListener("hashchange", () => {
  const next = indexFromHash();
  if (next !== index) show(next);
});

document.addEventListener("keydown", (event) => {
  const typing = event.target.closest("input, textarea");
  if (typing) return;
  if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
    event.preventDefault();
    show(index + 1);
  } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
    event.preventDefault();
    show(index - 1);
  } else if (event.key === "Home") {
    event.preventDefault();
    show(0);
  } else if (event.key === "End") {
    event.preventDefault();
    show(sensors.length - 1);
  }
});

let resizeTimer = null;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (view) fitNow(view);
  }, 150);
});

let touchX = null;
slideEl.addEventListener("touchstart", (event) => {
  if (event.target.closest("#stage")) return;
  touchX = event.changedTouches[0].clientX;
}, { passive: true });
slideEl.addEventListener("touchend", (event) => {
  if (touchX == null || event.target.closest("#stage")) {
    touchX = null;
    return;
  }
  const delta = event.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(delta) < 50) return;
  show(delta < 0 ? index + 1 : index - 1);
}, { passive: true });

function start(payload) {
  sensors = payload.sensors || [];
  if (!sensors.length) {
    titleEl.textContent = "Sensors unavailable";
    showError("No sensor structures were loaded.");
    return;
  }
  show(indexFromHash());
}

if (window.SENSOR_DATA) {
  start(window.SENSOR_DATA);
} else {
  fetch("data/sensors.json")
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load sensor data (${response.status}).`);
      return response.json();
    })
    .then(start)
    .catch((error) => {
      titleEl.textContent = "Sensors unavailable";
      showError(error.message);
    });
}
