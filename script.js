const zones = [
  {name:"Main Entrance", occupancy:42, visitors:21, capacity:50, condition:"Normal", wear:"No current flag", icon:"↗"},
  {name:"Temple Courtyard", occupancy:78, visitors:39, capacity:50, condition:"Moderate", wear:"Routine monitoring", icon:"⌂"},
  {name:"Ancient Pillars", occupancy:92, visitors:46, capacity:50, condition:"High", wear:"Possible surface wear", icon:"▥"},
  {name:"East Gallery", occupancy:35, visitors:11, capacity:32, condition:"Normal", wear:"No current flag", icon:"▤"},
  {name:"South Corridor", occupancy:66, visitors:11, capacity:18, condition:"Moderate", wear:"Routine monitoring", icon:"↔"}
];

const alerts = [
  {id:1,title:"High crowd density",description:"Visitor flow is approaching the zone's demo threshold.",zone:"Ancient Pillars",priority:"High",time:"2 min ago",status:"active",symbol:"♙"},
  {id:2,title:"Crowd building up",description:"Consider guiding visitors through an alternate route.",zone:"Temple Courtyard",priority:"Medium",time:"8 min ago",status:"active",symbol:"◉"},
  {id:3,title:"Surface wear flag",description:"Sample inspection record needs conservator review.",zone:"Western Wall",priority:"Medium",time:"24 min ago",status:"active",symbol:"⌕"}
];

const activity = [
  {title:"Crowd reading updated",detail:"New simulated occupancy values calculated",time:"Just now"},
  {title:"Wear flag recorded",detail:"Western Wall · sample inspection",time:"24 min ago"},
  {title:"Zone monitoring active",detail:"5 demo zones are available",time:"1 hour ago"}
];

const inspections = [
  {date:"13 Oct 2026",zone:"Western Wall",finding:"Possible surface wear",score:68,status:"Review needed"},
  {date:"12 Oct 2026",zone:"Ancient Pillars",finding:"Weathering indicator",score:54,status:"Review needed"},
  {date:"10 Oct 2026",zone:"East Gallery",finding:"No notable demo flag",score:18,status:"Recorded"}
];

let activeFilter = "all";
let selectedFile = null;
let lastAssessment = null;

let crowdModel = null;
let crowdImageFile = null;
let crowdImageElement = null;
let crowdDetections = [];
let crowdObjectUrl = null;
let detectionRunning = false;

const $ = (id) => document.getElementById(id);

const safeOn = (id, eventName, handler) => {
  const element = $(id);

  if (element) {
    element.addEventListener(eventName, handler);
  } else {
    console.warn(
      `HeritageGuard: optional UI element #${id} is missing; skipped ${eventName} handler.`
    );
  }
};

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, ch => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#39;"
  }[ch]));

const statusClass = (status) =>
  status === "High"
    ? "status-high"
    : status === "Moderate"
      ? "status-moderate"
      : "status-normal";

const priorityClass = (priority) =>
  priority === "High"
    ? "priority-high"
    : priority === "Medium"
      ? "priority-medium"
      : "priority-low";

const STORAGE_KEY = "heritageguard-final-v1";

function saveAppState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        zones,
        alerts,
        activity: activity.slice(0, 30),
        inspections: inspections.slice(0, 100)
      })
    );
  } catch (error) {
    console.warn("HeritageGuard: could not save state", error);
  }
}

function loadAppState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");

    if (!saved) return;

    if (Array.isArray(saved.zones) && saved.zones.length) {
      zones.splice(0, zones.length, ...saved.zones);
    }

    if (Array.isArray(saved.alerts)) {
      alerts.splice(0, alerts.length, ...saved.alerts);
    }

    if (Array.isArray(saved.activity)) {
      activity.splice(0, activity.length, ...saved.activity);
    }

    if (Array.isArray(saved.inspections)) {
      inspections.splice(0, inspections.length, ...saved.inspections);
    }
  } catch (error) {
    console.warn("HeritageGuard: saved state could not be read", error);
  }
}

function setTheme(dark) {
  document.body.classList.toggle("dark-mode", dark);

  const button = $("themeToggle");

  if (button) {
    button.textContent = dark ? "☀" : "☾";
    button.title = dark ? "Switch to light mode" : "Switch to dark mode";
    button.setAttribute("aria-label", button.title);
  }

  try {
    localStorage.setItem("heritageguard-theme", dark ? "dark" : "light");
  } catch (_) {}
}

loadAppState();

function showToast(message, type = "success") {
  const toast = document.createElement("div");

  toast.className = "toast" + (type === "error" ? " error" : "");
  toast.textContent = message;

  const container = $("toastContainer");

  if (!container) return;

  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3300);
}

function goToPage(page) {
  const titles = {
    dashboard: "Overview",
    crowd: "Crowd monitor",
    wear: "Wear analyzer",
    map: "Site map",
    reports: "Reports & alerts"
  };

  document.querySelectorAll(".page").forEach(el => {
    el.classList.toggle("active-page", el.id === `page-${page}`);
  });

  document.querySelectorAll(".nav-link").forEach(el => {
    el.classList.toggle("active", el.dataset.page === page);
  });

  $("breadcrumbTitle").textContent = titles[page] || "Overview";
  $("sidebar").classList.remove("open");

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderPriorityAlerts() {
  const active = alerts.filter(a => a.status === "active");

  $("priorityAlerts").innerHTML = active.slice(0, 3).map(a => `
    <div class="alert-item">
      <div class="alert-symbol ${a.priority.toLowerCase()}">${a.symbol}</div>
      <div class="alert-copy">
        <strong>${escapeHtml(a.title)}</strong>
        <p>${escapeHtml(a.zone)} · ${escapeHtml(a.description)}</p>
      </div>
      <span class="alert-time">${escapeHtml(a.time)}</span>
    </div>
  `).join("") || '<p class="subheading">No active alerts. Nice work!</p>';

  $("alertCount").textContent = `${active.length} active`;
  $("crowdNavCount").textContent =
    zones.filter(z => z.occupancy >= 70).length;
}

function renderZoneTable() {
  $("zoneTable").innerHTML = zones.map(z => `
    <tr>
      <td>${escapeHtml(z.name)}</td>
      <td>${z.occupancy}%</td>
      <td>${escapeHtml(z.wear)}</td>
      <td>
        <span class="status-tag ${statusClass(z.condition)}">
          ${escapeHtml(z.condition)}
        </span>
      </td>
    </tr>
  `).join("");
}

function renderActivity() {
  $("activityList").innerHTML = activity.slice(0, 4).map(a => `
    <div class="activity-item">
      <span class="activity-dot"></span>
      <div>
        <strong>${escapeHtml(a.title)}</strong>
        <p>${escapeHtml(a.detail)} · ${escapeHtml(a.time)}</p>
      </div>
    </div>
  `).join("");
}

function updateMetrics() {
  saveAppState();

  const total = zones.reduce((sum, z) => sum + z.visitors, 0);
  const capacity = 200;
  const occupancy = Math.min(100, Math.round(total / capacity * 100));
  const crowded = zones.filter(z => z.occupancy >= 70).length;

  const risk = Math.min(
    98,
    Math.round(
      zones.reduce((sum, z) => sum + z.occupancy, 0) /
      zones.length * 0.7 + crowded * 8
    )
  );

  $("visitorTotal").textContent = total;
  $("occupancyValue").textContent = occupancy;
  $("occupancyBar").style.width = occupancy + "%";
  $("occupancyDetail").textContent = total;

  $("riskValue").textContent = risk;
  $("riskBar").style.width = risk + "%";
  $("riskBadge").textContent =
    risk >= 75 ? "High" :
    risk >= 55 ? "Elevated" :
    "Moderate";

  $("wearFlagCount").textContent =
    inspections.filter(i => i.status !== "Recorded").length;

  $("crowdVisitorTotal").textContent = total;
  $("crowdedZones").textContent = crowded;
  $("crowdNavCount").textContent = crowded;

  renderDensityChart();
  renderPriorityAlerts();
  renderZoneTable();
  renderCrowdPage();
  renderMapLabels();
}

function renderDensityChart() {
  const groups = document.querySelectorAll("#densityChart .bar-group");

  groups.forEach((group, i) => {
    const z = zones[i];

    if (!z) return;

    const bar = group.querySelector(".bar");

    bar.style.height = z.occupancy + "%";

    bar.className = "bar " + (
      z.occupancy >= 85
        ? "high-bar"
        : z.occupancy >= 65
          ? "medium-bar"
          : "low-bar"
    );

    bar.querySelector("span").textContent = z.occupancy + "%";
  });
}

function renderCrowdPage() {
  $("crowdZoneCards").innerHTML = zones.map(z => `
    <div class="zone-card">
      <div class="zone-card-head">
        <h3>${escapeHtml(z.name)}</h3>
        <span class="status-tag ${statusClass(z.condition)}">
          ${escapeHtml(z.condition)}
        </span>
      </div>
      <p>${z.visitors} estimated visitors · capacity ${z.capacity}</p>
      <div class="progress-track">
        <span style="width:${z.occupancy}%;background:${
          z.occupancy >= 85 ? "#cf665a" :
          z.occupancy >= 65 ? "#d5a64c" :
          "#5da17b"
        }"></span>
      </div>
      <div class="zone-card-foot">
        <span>Occupancy</span>
        <strong>${z.occupancy}%</strong>
      </div>
    </div>
  `).join("");

  const crowded = zones.filter(z => z.occupancy >= 70);

  const recs = crowded.length
    ? crowded.map(z => ({
        icon: "↗",
        title: `Review ${z.name}`,
        text: z.occupancy >= 85
          ? "High demo occupancy. Consider pausing entry briefly and redirecting foot traffic."
          : "Moderate-to-high occupancy. Monitor visitor flow and consider an alternate route."
      }))
    : [{
        icon: "✓",
        title: "No crowded zones",
        text: "All demo zones are below the high-density threshold. Continue routine monitoring."
      }];

  recs.push({
    icon: "♧",
    title: "Protect sensitive surfaces",
    text: "Use visitor guidance and barriers around fragile features where appropriate."
  });

  recs.push({
    icon: "▤",
    title: "Record periodic counts",
    text: "Compare readings over time before making operational decisions."
  });

  $("crowdRecommendations").innerHTML = recs.slice(0, 3).map(r => `
    <div class="recommendation">
      <span class="rec-icon">${r.icon}</span>
      <strong>${escapeHtml(r.title)}</strong>
      <p>${escapeHtml(r.text)}</p>
    </div>
  `).join("");
}

function renderMapLabels() {
  document.querySelectorAll(".map-zone").forEach(btn => {
    const z = zones.find(item => item.name === btn.dataset.zone);

    if (!z) return;

    btn.querySelector("small").textContent = z.occupancy + "% occupied";

    btn.classList.toggle(
      "selected",
      btn.dataset.zone === ($("mapDetail").dataset.selected || "")
    );

    btn.style.borderColor =
      z.occupancy >= 85 ? "#e2a29c" :
      z.occupancy >= 65 ? "#e4ce9b" :
      "";
  });
}

function renderAlertsTable() {
  saveAppState();

  const query = $("alertSearch").value.trim().toLowerCase();

  const filtered = alerts.filter(a =>
    (activeFilter === "all" || a.status === activeFilter) &&
    [a.title, a.description, a.zone, a.priority, a.status]
      .join(" ")
      .toLowerCase()
      .includes(query)
  );

  $("alertsTable").innerHTML = filtered.map(a => `
    <tr>
      <td><strong>${escapeHtml(a.title)}</strong></td>
      <td>${escapeHtml(a.zone)}</td>
      <td>
        <span class="priority-label ${priorityClass(a.priority)}">
          ${escapeHtml(a.priority)}
        </span>
      </td>
      <td>${escapeHtml(a.time)}</td>
      <td>
        <span class="status-tag ${
          a.status === "resolved" ? "status-resolved" : "status-review"
        }">
          ${a.status === "resolved" ? "Resolved" : "Active"}
        </span>
      </td>
      <td>
        <button class="action-button"
          data-resolve="${a.id}"
          ${a.status === "resolved" ? "disabled" : ""}>
          ${a.status === "resolved" ? "Resolved" : "Mark resolved"}
        </button>
      </td>
    </tr>
  `).join("");

  $("emptyAlerts").classList.toggle("hidden", filtered.length !== 0);
  $("allAlertCount").textContent = alerts.length;
  $("activeAlertCount").textContent =
    alerts.filter(a => a.status === "active").length;
  $("resolvedAlertCount").textContent =
    alerts.filter(a => a.status === "resolved").length;
  $("alertCount").textContent =
    alerts.filter(a => a.status === "active").length + " active";
}

function renderInspectionHistory() {
  saveAppState();

  $("inspectionHistory").innerHTML = inspections.map(i => `
    <tr>
      <td>${escapeHtml(i.date)}</td>
      <td>${escapeHtml(i.zone)}</td>
      <td>${escapeHtml(i.finding)}</td>
      <td>${i.score}/100</td>
      <td>
        <span class="status-tag ${
          i.status === "Recorded" ? "status-normal" : "status-review"
        }">
          ${escapeHtml(i.status)}
        </span>
      </td>
    </tr>
  `).join("");
}

function selectMapZone(name) {
  const z = zones.find(item => item.name === name);

  if (!z) return;

  $("mapDetail").dataset.selected = name;

  $("mapDetail").innerHTML = `
    <div class="detail-icon">${z.icon}</div>
    <h3>${escapeHtml(z.name)}</h3>
    <p>Illustrative monitoring details for this zone.</p>

    <div class="detail-stats">
      <div class="detail-stat">
        <small>Occupancy</small>
        <strong>${z.occupancy}%</strong>
      </div>
      <div class="detail-stat">
        <small>Visitors</small>
        <strong>${z.visitors}</strong>
      </div>
      <div class="detail-stat">
        <small>Zone capacity</small>
        <strong>${z.capacity}</strong>
      </div>
      <div class="detail-stat">
        <small>Condition</small>
        <strong style="font-size:12px">${escapeHtml(z.condition)}</strong>
      </div>
    </div>

    <p><strong>Wear note</strong><br>${escapeHtml(z.wear)}</p>

    <button class="button button-primary button-wide detail-action"
      id="zoneCrowdAction">
      Open crowd monitor →
    </button>
  `;

  $("zoneCrowdAction").addEventListener("click", () => goToPage("crowd"));

  renderMapLabels();
}

/* -----------------------------------------
   MANUAL AND AUTOMATIC CROWD SIMULATION
   ----------------------------------------- */

function simulateCrowd(options = {}) {
  zones.forEach(z => {
    z.occupancy = Math.max(
      15,
      Math.min(99, z.occupancy + Math.round((Math.random() - 0.48) * 17))
    );

    z.visitors = Math.round(z.capacity * z.occupancy / 100);

    z.condition =
      z.occupancy >= 85 ? "High" :
      z.occupancy >= 65 ? "Moderate" :
      "Normal";
  });

  const high = zones.find(z => z.occupancy >= 85);

  if (
    high &&
    !alerts.some(a =>
      a.status === "active" &&
      a.zone === high.name &&
      a.title === "High crowd density"
    )
  ) {
    alerts.unshift({
      id: Date.now(),
      title: "High crowd density",
      description: "A new simulated reading crossed the demo threshold.",
      zone: high.name,
      priority: "High",
      time: "Just now",
      status: "active",
      symbol: "♙"
    });

    activity.unshift({
      title: "Crowd alert generated",
      detail: `${high.name} crossed the demo threshold`,
      time: "Just now"
    });
  }

  updateMetrics();
  renderAlertsTable();
  renderPriorityAlerts();
  renderActivity();
  saveAppState();

  // Avoid showing a popup every time automatic simulation runs.
  if (!options.silent) {
    showToast("New simulated crowd readings generated.");
  }
}

/* -----------------------------------------
   WEAR ANALYZER IMAGE PROCESSING
   ----------------------------------------- */

function setSelectedImage(file) {
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showToast("Please select a valid image file.", "error");
    return;
  }

  if (file.size > 12 * 1024 * 1024) {
    showToast("Please choose an image smaller than 12 MB.", "error");
    return;
  }

  selectedFile = file;

  const reader = new FileReader();

  reader.onload = event => {
    $("previewImage").src = event.target.result;
    $("previewName").textContent = file.name;
    $("previewSize").textContent =
      (file.size / 1024).toFixed(0) + " KB · Local preview";

    $("imagePreview").classList.remove("hidden");
    $("uploadDrop").classList.add("hidden");
    $("analysisEmpty").classList.remove("hidden");
    $("analysisResult").classList.add("hidden");
    $("analysisStatus").textContent = "Awaiting assessment";
  };

  reader.readAsDataURL(file);
}

function runDemoAssessment() {
  if (!selectedFile || !$("previewImage").src) {
    showToast("Upload an inspection image first.", "error");
    return;
  }

  const image = $("previewImage");

  if (!image.complete || !image.naturalWidth) {
    showToast("The image is still loading. Please try again.", "error");
    return;
  }

  const button = $("analyzeWearBtn");

  button.disabled = true;
  button.dataset.originalText = button.textContent;
  button.textContent = "Analyzing image…";

  try {
    // Downsample before analysis so very large photos do not freeze the browser.
    const maxSide = 280;

    const scale = Math.min(
      1,
      maxSide / Math.max(image.naturalWidth, image.naturalHeight)
    );

    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    if (!ctx) {
      throw new Error("Canvas is unavailable in this browser.");
    }

    ctx.drawImage(image, 0, 0, width, height);

    const pixels = ctx.getImageData(0, 0, width, height).data;
    const gray = new Uint8Array(width * height);

    let sum = 0;
    let sumSquares = 0;

    for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
      const y =
        0.2126 * pixels[i] +
        0.7152 * pixels[i + 1] +
        0.0722 * pixels[i + 2];

      gray[p] = y;
      sum += y;
      sumSquares += y * y;
    }

    let edgeCount = 0;
    let edgeStrength = 0;
    let samples = 0;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;

        const gx = Math.abs(gray[i + 1] - gray[i - 1]);
        const gy = Math.abs(gray[i + width] - gray[i - width]);
        const gradient = (gx + gy) / 2;

        if (gradient > 24) edgeCount++;

        edgeStrength += Math.min(gradient, 100);
        samples++;
      }
    }

    const edgeRatio = samples ? edgeCount / samples : 0;
    const mean = sum / Math.max(1, width * height);

    const variance = Math.max(
      0,
      sumSquares / Math.max(1, width * height) - mean * mean
    );

    const contrast = Math.sqrt(variance);

    // This is a visual-texture heuristic only, not a calibrated measure of damage.
    const score = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          edgeRatio * 180 +
          Math.min(contrast, 70) * 0.34 +
          (samples ? edgeStrength / samples : 0) * 0.16
        )
      )
    );

    const level =
      score >= 55 ? "Elevated texture" :
      score >= 25 ? "Moderate texture" :
      "Lower texture";

    const status =
      score >= 55 ? "Review needed" :
      score >= 25 ? "Monitor" :
      "Recorded";

    const recommendation = score >= 55
      ? "Review the area in person and compare repeat photographs under consistent lighting. Do not infer structural damage from this score alone."
      : score >= 25
        ? "Record the image as a baseline and arrange a closer visual check if cracks, flaking, moisture, or material loss are visible."
        : "Keep this image as a baseline and continue routine inspections. Low texture does not guarantee that the surface is sound.";

    const zone = $("inspectionZone").value;

    const date = new Date().toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });

    lastAssessment = {
      date,
      zone,
      finding: level,
      score,
      status,
      imageName: selectedFile.name,
      notes: $("inspectionNotes").value.trim(),
      method: "Image texture heuristic"
    };

    inspections.unshift(lastAssessment);
    inspections.splice(100);

    $("wearScore").textContent = score;
    $("wearFinding").textContent = level;

    $("wearDescription").textContent =
      `A lightweight pixel-gradient scan found ${(edgeRatio * 100).toFixed(1)}% high-gradient sample areas in this image (${width} × ${height} analysis pixels). This can reflect texture, lighting, joints, or many other features—not damage specifically.`;

    $("wearRecommendation").textContent = recommendation;
    $("resultZone").textContent = zone;

    $("scoreRing").style.borderColor =
      score >= 55 ? "#d98c83" :
      score >= 25 ? "#efcf8b" :
      "#8ec2a0";

    $("analysisStatus").textContent = status;

    $("analysisStatus").className =
      "status-tag " +
      (score >= 55 ? "status-review" :
       score >= 25 ? "status-moderate" :
       "status-normal");

    $("analysisEmpty").classList.add("hidden");
    $("analysisResult").classList.remove("hidden");

    renderInspectionHistory();

    $("wearFlagCount").textContent =
      inspections.filter(i => i.status !== "Recorded").length;

    if (
      score >= 55 &&
      !alerts.some(a =>
        a.status === "active" &&
        a.zone === zone &&
        a.title === "Surface texture review"
      )
    ) {
      alerts.unshift({
        id: Date.now(),
        title: "Surface texture review",
        description: "Image texture heuristic suggests this area should be visually verified by a conservator.",
        zone,
        priority: "High",
        time: "Just now",
        status: "active",
        symbol: "⌕"
      });

      activity.unshift({
        title: "Surface screening completed",
        detail: `${zone} · review recommended`,
        time: "Just now"
      });

      renderAlertsTable();
      renderPriorityAlerts();
      renderActivity();
    }

    saveAppState();
    showToast("Image screening complete. Verify any concern in person.");
  } catch (error) {
    console.error(error);
    showToast("Could not analyze this image. Try a smaller JPG or PNG.", "error");
  } finally {
    button.disabled = false;
    button.innerHTML = 'Analyze image <span>→</span>';
  }
}

/* -----------------------------------------
   REPORT EXPORT
   ----------------------------------------- */

function exportAlertsCsv() {
  const headers = [
    "ID",
    "Alert",
    "Zone",
    "Priority",
    "Time",
    "Status",
    "Description"
  ];

  const rows = alerts.map(a => [
    a.id,
    a.title,
    a.zone,
    a.priority,
    a.time,
    a.status,
    a.description
  ]);

  const csv = [headers, ...rows]
    .map(row =>
      row.map(value =>
        `"${String(value).replace(/"/g, '""')}"`
      ).join(",")
    )
    .join("\r\n");

  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "heritageguard-demo-alerts.csv";
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);

  showToast("Demo alerts exported as CSV.");
}

function generateReport() {
  goToPage("reports");
  showToast("Report view opened. Use Export CSV to download the sample alert records.");
}

/* -----------------------------------------
   AUTOMATIC SIMULATION CONTROLS
   ----------------------------------------- */

// These controls are inserted into the Crowd Monitor page.
// The existing HTML and CSS files do not need to be replaced.

function ensureAutoSimulationUI() {
  if ($("hgAutoSimulationPanel")) return;

  const crowdPage = $("page-crowd");
  const heading = crowdPage && crowdPage.querySelector(".page-heading");

  if (!heading) {
    console.error("HeritageGuard: could not find the Crowd Monitor heading.");
    return;
  }

  const panel = document.createElement("article");

  panel.id = "hgAutoSimulationPanel";
  panel.className = "panel auto-sim-panel";

  panel.style.cssText =
    "display:block;box-sizing:border-box;width:100%;margin:0 0 22px;padding:18px;border:1px solid var(--line,#d9e4dd);border-radius:14px;background:var(--white,#fff);color:inherit;";

  panel.innerHTML = `
    <div style="margin-bottom:14px">
      <h2 style="font-size:18px;margin:0 0 6px">Automatic simulation</h2>
      <p style="font-size:13px;opacity:.75;margin:0">
        Automatically refresh the demo crowd readings while this website remains open. Image detection is unaffected.
      </p>
    </div>

    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <label for="hgSimulationInterval">Update interval</label>

      <select id="hgSimulationInterval"
        style="padding:10px;border:1px solid var(--line,#cbd8cf);border-radius:8px;background:var(--white,#fff);color:inherit;font:inherit">
        <option value="1">Every 1 minute</option>
        <option value="5">Every 5 minutes</option>
        <option value="10">Every 10 minutes</option>
        <option value="30">Every 30 minutes</option>
      </select>

      <button type="button" id="hgSimulationToggle"
        style="padding:10px 16px;background:#176747;color:white;border:0;border-radius:8px;font-weight:600;cursor:pointer">
        Start automatic updates
      </button>
    </div>

    <div id="hgSimulationStatus" role="status" aria-live="polite"
      style="margin-top:14px;font-size:13px">
      Status: Automatic updates are off
    </div>

    <p id="hgSimulationCountdown"
      style="font-size:13px;opacity:.75;margin:8px 0 0">
      Choose an interval and start automatic updates. Manual updates will still work.
    </p>
  `;

  heading.insertAdjacentElement("afterend", panel);

  const intervalSelect = $("hgSimulationInterval");
  const toggle = $("hgSimulationToggle");
  const status = $("hgSimulationStatus");
  const countdown = $("hgSimulationCountdown");

  let timer = null;
  let countdownTimer = null;
  let nextRun = null;
  let isRunning = false;

  // Remember the selected interval, but don't automatically start after reload.
  try {
    const savedInterval = localStorage.getItem("hg-simulation-interval");

    if (["1", "5", "10", "30"].includes(savedInterval)) {
      intervalSelect.value = savedInterval;
    } else {
      intervalSelect.value = "5";
    }
  } catch (_) {
    intervalSelect.value = "5";
  }

  function renderStatus() {
    if (!isRunning || nextRun === null) {
      status.textContent = "Status: Automatic updates are off";
      countdown.textContent =
        "Choose an interval and start automatic updates. Manual updates will still work.";

      toggle.textContent = "Start automatic updates";
      toggle.setAttribute("aria-pressed", "false");

      return;
    }

    const seconds = Math.max(
      0,
      Math.ceil((nextRun - Date.now()) / 1000)
    );

    const minutes = Math.floor(seconds / 60);
    const remainder = String(seconds % 60).padStart(2, "0");

    status.textContent =
      `Status: Running · every ${intervalSelect.value} minute${intervalSelect.value === "1" ? "" : "s"}`;

    countdown.textContent =
      `Next automatic simulation in ${minutes}:${remainder}`;

    toggle.textContent = "Stop automatic updates";
    toggle.setAttribute("aria-pressed", "true");
  }

  function clearTimers() {
    if (timer !== null) clearTimeout(timer);
    if (countdownTimer !== null) clearInterval(countdownTimer);

    timer = null;
    countdownTimer = null;
    nextRun = null;
  }

  function stopAutomaticUpdates() {
    isRunning = false;
    clearTimers();
    renderStatus();
  }

  function scheduleNextRun() {
    if (!isRunning) return;

    if (timer !== null) {
      clearTimeout(timer);
    }

    const intervalMs = Number(intervalSelect.value) * 60 * 1000;

    nextRun = Date.now() + intervalMs;

    timer = setTimeout(() => {
      timer = null;

      if (!isRunning) return;

      // Reuse the existing simulation logic.
      // This does not alter the uploaded image or its detection results.
      simulateCrowd({ silent: true });

      activity.unshift({
        title: "Automatic crowd simulation",
        detail: `Demo readings refreshed · every ${intervalSelect.value} minute${intervalSelect.value === "1" ? "" : "s"}`,
        time: "Just now"
      });

      activity.splice(30);

      renderActivity();
      saveAppState();

      // Schedule the next update using the currently selected interval.
      scheduleNextRun();
      renderStatus();
    }, intervalMs);

    renderStatus();
  }

  toggle.addEventListener("click", () => {
    if (isRunning) {
      stopAutomaticUpdates();
      showToast("Automatic crowd updates stopped.");
      return;
    }

    isRunning = true;

    scheduleNextRun();

    if (countdownTimer !== null) {
      clearInterval(countdownTimer);
    }

    countdownTimer = setInterval(renderStatus, 1000);

    showToast(
      `Automatic crowd updates started: every ${intervalSelect.value} minute${intervalSelect.value === "1" ? "" : "s"}.`
    );
  });

  intervalSelect.addEventListener("change", () => {
    try {
      localStorage.setItem("hg-simulation-interval", intervalSelect.value);
    } catch (_) {}

    if (isRunning) {
      clearTimers();

      scheduleNextRun();

      countdownTimer = setInterval(renderStatus, 1000);

      showToast(
        `Update interval changed to every ${intervalSelect.value} minute${intervalSelect.value === "1" ? "" : "s"}.`
      );
    } else {
      renderStatus();
    }
  });

  window.addEventListener("pagehide", () => {
    // Automatic updates run only while this page remains open.
    clearTimers();
    isRunning = false;
  });
}

ensureAutoSimulationUI();

/* -----------------------------------------
   NAVIGATION AND EVENT LISTENERS
   ----------------------------------------- */

document.addEventListener("click", event => {
  const nav = event.target.closest("[data-page]");

  if (nav) {
    event.preventDefault();
    goToPage(nav.dataset.page);
  }

  const resolve = event.target.closest("[data-resolve]");

  if (resolve) {
    const alert = alerts.find(
      a => a.id === Number(resolve.dataset.resolve)
    );

    if (alert && alert.status !== "resolved") {
      alert.status = "resolved";

      activity.unshift({
        title: "Alert marked resolved",
        detail: `${alert.title} · ${alert.zone}`,
        time: "Just now"
      });

      renderAlertsTable();
      renderPriorityAlerts();
      renderActivity();
      saveAppState();

      showToast("Alert marked as resolved.");
    }
  }

  const mapZone = event.target.closest(".map-zone");

  if (mapZone) {
    selectMapZone(mapZone.dataset.zone);
  }
});

safeOn("mobileMenu", "click", () =>
  $("sidebar").classList.toggle("open")
);

safeOn("refreshBtn", "click", simulateCrowd);
safeOn("simulateCrowdBtn", "click", simulateCrowd);
safeOn("generateReportBtn", "click", generateReport);
safeOn("exportCsvBtn", "click", exportAlertsCsv);
safeOn("alertSearch", "input", renderAlertsTable);

safeOn("alertFilters", "click", event => {
  const button = event.target.closest("[data-filter]");

  if (!button) return;

  activeFilter = button.dataset.filter;

  document.querySelectorAll(".filter-tab").forEach(tab => {
    tab.classList.toggle("active", tab === button);
  });

  renderAlertsTable();
});

safeOn("wearImageInput", "change", event =>
  setSelectedImage(event.target.files[0])
);

safeOn("uploadDrop", "dragover", event => {
  event.preventDefault();
  $("uploadDrop").classList.add("drag-over");
});

safeOn("uploadDrop", "dragleave", () =>
  $("uploadDrop").classList.remove("drag-over")
);

safeOn("uploadDrop", "drop", event => {
  event.preventDefault();
  $("uploadDrop").classList.remove("drag-over");
  setSelectedImage(event.dataTransfer.files[0]);
});

safeOn("removeImage", "click", () => {
  selectedFile = null;

  $("wearImageInput").value = "";
  $("imagePreview").classList.add("hidden");
  $("uploadDrop").classList.remove("hidden");
  $("analysisResult").classList.add("hidden");
  $("analysisEmpty").classList.remove("hidden");
  $("analysisStatus").textContent = "Awaiting assessment";
});

safeOn("analyzeWearBtn", "click", runDemoAssessment);

safeOn("dismissNotice", "click", () =>
  $("dismissNotice").closest(".notice-banner").remove()
);

safeOn("densityPeriod", "click", () =>
  showToast("Live demo displays the latest simulated sample values.")
);

safeOn("siteMap", "click", event => {
  const zone = event.target.closest(".map-zone");

  if (zone) selectMapZone(zone.dataset.zone);
});

const today = new Date();
const todayLabel = $("todayLabel");

if (todayLabel) {
  todayLabel.textContent =
    today.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric"
    }).toUpperCase() + " · SITE INTELLIGENCE";
}

try {
  setTheme(localStorage.getItem("heritageguard-theme") === "dark");
} catch (_) {
  setTheme(false);
}

safeOn("themeToggle", "click", () =>
  setTheme(!document.body.classList.contains("dark-mode"))
);

/* -----------------------------------------
   AI CROWD DETECTION — IMAGE PROCESSING
   ----------------------------------------- */

function populateDetectionZones() {
  const select = $("detectionZoneSelect");

  if (!select) return;

  select.innerHTML = zones.map(z =>
    `<option value="${escapeHtml(z.name)}">${escapeHtml(z.name)}</option>`
  ).join("");

  select.value =
    zones.find(z => z.name === "Ancient Pillars")?.name ||
    zones[0]?.name ||
    "";
}

function setDetectionMessage(message, isError = false) {
  const el = $("detectionMessage");

  if (el) {
    el.textContent = message;
    el.style.color = isError ? "#c9574b" : "";
  }
}

async function loadCrowdModel() {
  const status = $("modelStatus");
  const button = $("runDetectionBtn");

  if (status) status.textContent = "Loading AI model…";

  setDetectionMessage(
    "Loading the person-detection model. An internet connection is required on first load."
  );

  if (!window.tf || !window.cocoSsd) {
    if (status) status.textContent = "Model unavailable";

    setDetectionMessage(
      "The AI libraries did not load. Check your internet connection, then reload the page.",
      true
    );

    return;
  }

  try {
    await window.tf.ready();

    crowdModel = await window.cocoSsd.load({
      base: "lite_mobilenet_v2"
    });

    if (status) {
      status.textContent = "AI model ready";
      status.classList.remove("status-review");
      status.classList.add("status-normal");
    }

    if (button) {
      button.disabled = !crowdImageElement;
    }

    setDetectionMessage(
      "Model ready. Upload a clear image containing people, then select Detect people."
    );
  } catch (error) {
    console.error("Crowd model failed to load:", error);

    if (status) status.textContent = "Model unavailable";

    setDetectionMessage(
      "Could not load the AI model. Use a working internet connection and reload the page.",
      true
    );
  }
}

function clearCrowdDetection() {
  crowdImageFile = null;
  crowdImageElement = null;
  crowdDetections = [];

  if (crowdObjectUrl) {
    URL.revokeObjectURL(crowdObjectUrl);
    crowdObjectUrl = null;
  }

  $("crowdImageInput").value = "";
  $("crowdUploadDrop").classList.remove("hidden");
  $("detectionPlaceholder").classList.remove("hidden");

  const canvas = $("detectionCanvas");
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  canvas.width = 0;
  canvas.height = 0;

  $("detectedCount").textContent = "—";
  $("detectionDimensions").textContent = "—";
  $("detectionDetails").textContent = "Not started";

  $("runDetectionBtn").disabled = !crowdModel;
  $("applyDetectionBtn").disabled = true;

  setDetectionMessage(
    crowdModel
      ? "Upload an image to begin detection."
      : "Waiting for the model to load."
  );
}

function handleCrowdImage(file) {
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showToast("Please choose an image file.", "error");
    return;
  }

  if (file.size > 15 * 1024 * 1024) {
    showToast("Choose an image smaller than 15 MB.", "error");
    return;
  }

  if (crowdObjectUrl) {
    URL.revokeObjectURL(crowdObjectUrl);
  }

  crowdImageFile = file;
  crowdDetections = [];
  crowdImageElement = new Image();
  crowdObjectUrl = URL.createObjectURL(file);

  crowdImageElement.onload = () => {
    $("crowdUploadDrop").classList.add("hidden");
    $("detectionPlaceholder").classList.add("hidden");

    const canvas = $("detectionCanvas");

    canvas.width = crowdImageElement.naturalWidth;
    canvas.height = crowdImageElement.naturalHeight;

    canvas.getContext("2d").drawImage(crowdImageElement, 0, 0);

    $("detectionDimensions").textContent =
      `${canvas.width} × ${canvas.height}`;

    $("detectedCount").textContent = "—";
    $("detectionDetails").textContent = "Ready to scan";

    $("runDetectionBtn").disabled = !crowdModel;
    $("applyDetectionBtn").disabled = true;

    setDetectionMessage(
      crowdModel
        ? `Image ready: ${file.name}. Select Detect people.`
        : "Image ready; waiting for the AI model to load."
    );
  };

  crowdImageElement.onerror = () => {
    showToast("This image could not be opened.", "error");
    clearCrowdDetection();
  };

  crowdImageElement.src = crowdObjectUrl;
}

async function runCrowdDetection() {
  if (!crowdModel) {
    showToast("The AI model is not ready yet.", "error");
    return;
  }

  if (!crowdImageElement || !crowdImageElement.complete) {
    showToast("Upload a crowd image first.", "error");
    return;
  }

  if (detectionRunning) return;

  detectionRunning = true;

  const button = $("runDetectionBtn");

  button.disabled = true;
  button.textContent = "Detecting…";

  $("detectionDetails").textContent = "Analyzing image";

  setDetectionMessage("Detecting people in the uploaded image…");

  try {
    const predictions = await crowdModel.detect(
      crowdImageElement,
      30,
      0.35
    );

    crowdDetections = predictions.filter(
      p => p.class === "person"
    );

    const canvas = $("detectionCanvas");
    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.drawImage(
      crowdImageElement,
      0,
      0,
      canvas.width,
      canvas.height
    );

    const scale = Math.max(1, canvas.width / 700);

    ctx.lineWidth = 2.5 * scale;
    ctx.font = `${Math.max(12, 13 * scale)}px sans-serif`;

    crowdDetections.forEach((person, index) => {
      const [x, y, width, height] = person.bbox;

      ctx.strokeStyle = "#25d366";
      ctx.fillStyle = "rgba(37,211,102,0.13)";

      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x, y, width, height);

      const label =
        `Person ${index + 1} · ${Math.round(person.score * 100)}%`;

      const labelHeight = Math.max(19, 20 * scale);

      ctx.fillStyle = "#168447";

      ctx.fillRect(
        x,
        Math.max(0, y - labelHeight),
        ctx.measureText(label).width + 12,
        labelHeight
      );

      ctx.fillStyle = "#ffffff";

      ctx.fillText(
        label,
        x + 6,
        Math.max(13, y - 6 * scale)
      );
    });

    $("detectedCount").textContent = String(crowdDetections.length);
    $("detectionDetails").textContent = "Detection complete";
    $("applyDetectionBtn").disabled = false;

    setDetectionMessage(
      `Detected ${crowdDetections.length} person${crowdDetections.length === 1 ? "" : "s"}. Green boxes show model predictions; check the image for missed or duplicate people.`
    );

    showToast(`Detection complete: ${crowdDetections.length} people found.`);
  } catch (error) {
    console.error("Person detection failed:", error);

    $("detectionDetails").textContent = "Detection failed";

    setDetectionMessage(
      "Detection failed. Try a smaller JPG or PNG image and reload if the problem continues.",
      true
    );
  } finally {
    detectionRunning = false;
    button.textContent = "Detect people →";
    button.disabled = !crowdImageElement || !crowdModel;
  }
}

function applyDetectedCount() {
  if (!crowdDetections.length) {
    showToast("No people were detected to apply. Run detection first.", "error");
    return;
  }

  const zone = zones.find(
    z => z.name === $("detectionZoneSelect").value
  );

  if (!zone) return;

  zone.visitors = crowdDetections.length;

  zone.occupancy = Math.min(
    100,
    Math.round(zone.visitors / zone.capacity * 100)
  );

  zone.condition =
    zone.occupancy >= 85 ? "High" :
    zone.occupancy >= 65 ? "Moderate" :
    "Normal";

  if (
    zone.occupancy >= 85 &&
    !alerts.some(a =>
      a.status === "active" &&
      a.zone === zone.name &&
      a.title === "High crowd density"
    )
  ) {
    alerts.unshift({
      id: Date.now(),
      title: "High crowd density",
      description: `Image-based detector counted ${zone.visitors} people for a zone capacity of ${zone.capacity}. Verify the count on site.`,
      zone: zone.name,
      priority: "High",
      time: "Just now",
      status: "active",
      symbol: "♙"
    });

    activity.unshift({
      title: "Crowd detection alert",
      detail: `${zone.name} · ${zone.visitors} people detected`,
      time: "Just now"
    });
  }

  updateMetrics();
  renderAlertsTable();
  renderPriorityAlerts();
  renderActivity();
  renderMapLabels();
  saveAppState();

  showToast(`Applied ${zone.visitors} detected people to ${zone.name}.`);
}

safeOn("crowdImageInput", "change", event =>
  handleCrowdImage(event.target.files[0])
);

safeOn("crowdUploadDrop", "dragover", event => {
  event.preventDefault();
  $("crowdUploadDrop").classList.add("drag-over");
});

safeOn("crowdUploadDrop", "dragleave", () =>
  $("crowdUploadDrop").classList.remove("drag-over")
);

safeOn("crowdUploadDrop", "drop", event => {
  event.preventDefault();
  $("crowdUploadDrop").classList.remove("drag-over");
  handleCrowdImage(event.dataTransfer.files[0]);
});

safeOn("runDetectionBtn", "click", runCrowdDetection);
safeOn("applyDetectionBtn", "click", applyDetectedCount);
safeOn("clearDetectionBtn", "click", clearCrowdDetection);

/* -----------------------------------------
   INITIALIZE APPLICATION
   ----------------------------------------- */

populateDetectionZones();
updateMetrics();
renderActivity();
renderAlertsTable();
renderInspectionHistory();
renderPriorityAlerts();
renderAlertsTable();
renderInspectionHistory();
selectMapZone("Ancient Pillars");
loadCrowdModel();

/* =====================================================
   HERITAGEGUARD AI — PROFESSIONAL OCCUPANCY ALERTS
   Paste this block at the VERY END of script.js
   ===================================================== */

(function installOccupancyAlerts() {
  if (document.getElementById("hgOccupancyAlertStyles")) return;

  // Professional styling that does not require editing style.css.
  const styles = document.createElement("style");
  styles.id = "hgOccupancyAlertStyles";

  styles.textContent = `
    #hgOccupancyOverlay {
      position: fixed;
      inset: 0;
      z-index: 99999;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: rgba(13, 26, 21, 0.58);
      backdrop-filter: blur(5px);
    }

    #hgOccupancyOverlay.hg-visible {
      display: flex;
      animation: hgFadeIn .2s ease-out;
    }

    #hgOccupancyDialog {
      width: min(100%, 440px);
      overflow: hidden;
      border: 1px solid rgba(220, 105, 82, .24);
      border-radius: 20px;
      background: var(--white, #fff);
      color: var(--text, #24362e);
      box-shadow: 0 24px 80px rgba(0, 0, 0, .24);
      animation: hgSlideUp .24s ease-out;
    }

    #hgOccupancyDialog .hg-alert-top {
      padding: 23px 24px 18px;
      border-bottom: 1px solid var(--line, #e5eae6);
    }

    #hgOccupancyDialog .hg-alert-icon {
      display: grid;
      place-items: center;
      width: 46px;
      height: 46px;
      margin-bottom: 15px;
      border-radius: 14px;
      background: #fff0ed;
      color: #c64e40;
      font-size: 24px;
      font-weight: 800;
    }

    #hgOccupancyDialog .hg-alert-eyebrow {
      margin: 0 0 6px;
      color: #c64e40;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 1.2px;
      text-transform: uppercase;
    }

    #hgOccupancyDialog h2 {
      margin: 0;
      font-size: 23px;
      line-height: 1.3;
      letter-spacing: -.5px;
    }

    #hgOccupancyDialog .hg-alert-description {
      margin: 9px 0 0;
      color: var(--muted, #758078);
      font-size: 13px;
      line-height: 1.6;
    }

    #hgOccupancyDialog .hg-alert-body {
      padding: 20px 24px;
    }

    #hgOccupancyDialog .hg-alert-zone {
      margin-bottom: 15px;
      font-size: 15px;
      font-weight: 750;
    }

    #hgOccupancyDialog .hg-alert-metrics {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    #hgOccupancyDialog .hg-alert-metric {
      padding: 14px;
      border: 1px solid var(--line, #e5eae6);
      border-radius: 12px;
      background: var(--bg, #f7f9f7);
    }

    #hgOccupancyDialog .hg-alert-metric span {
      display: block;
      margin-bottom: 7px;
      color: var(--muted, #758078);
      font-size: 12px;
    }

    #hgOccupancyDialog .hg-alert-metric strong {
      font-size: 24px;
      font-weight: 800;
    }

    #hgOccupancyDialog .hg-alert-progress {
      height: 7px;
      margin-top: 15px;
      overflow: hidden;
      border-radius: 20px;
      background: #eee6e4;
    }

    #hgOccupancyDialog .hg-alert-progress span {
      display: block;
      height: 100%;
      max-width: 100%;
      border-radius: inherit;
      background: #d35d4e;
      transition: width .3s ease;
    }

    #hgOccupancyDialog .hg-alert-advice {
      margin: 16px 0 0;
      padding: 12px 13px;
      border-left: 3px solid #d35d4e;
      border-radius: 5px;
      background: #fff4f1;
      color: #773e36;
      font-size: 12px;
      line-height: 1.6;
    }

    #hgOccupancyDialog .hg-alert-actions {
      display: flex;
      gap: 10px;
      padding: 0 24px 23px;
    }

    #hgOccupancyDialog .hg-alert-button {
      min-height: 43px;
      padding: 11px 15px;
      border: 1px solid transparent;
      border-radius: 9px;
      font: inherit;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: transform .15s ease, opacity .15s ease;
    }

    #hgOccupancyDialog .hg-alert-button:hover {
      transform: translateY(-1px);
    }

    #hgOccupancyDialog .hg-alert-primary {
      flex: 1;
      background: #176747;
      color: #fff;
    }

    #hgOccupancyDialog .hg-alert-secondary {
      background: transparent;
      border-color: var(--line, #dce4de);
      color: inherit;
    }

    #hgOccupancyDialog .hg-alert-button:focus-visible {
      outline: 3px solid #7bb9a0;
      outline-offset: 3px;
    }

    @keyframes hgFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes hgSlideUp {
      from { opacity: 0; transform: translateY(12px) scale(.985); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    @media (max-width: 420px) {
      #hgOccupancyDialog .hg-alert-top {
        padding: 20px 18px 15px;
      }

      #hgOccupancyDialog .hg-alert-body {
        padding: 17px 18px;
      }

      #hgOccupancyDialog .hg-alert-actions {
        padding: 0 18px 19px;
      }

      #hgOccupancyDialog h2 {
        font-size: 20px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      #hgOccupancyOverlay,
      #hgOccupancyDialog {
        animation: none;
      }
    }
  `;

  document.head.appendChild(styles);

  // Create the popup without changing the existing page layout.
  const overlay = document.createElement("div");
  overlay.id = "hgOccupancyOverlay";
  overlay.setAttribute("aria-hidden", "true");

  overlay.innerHTML = `
    <section id="hgOccupancyDialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="hgOccupancyTitle"
      aria-describedby="hgOccupancyDescription">

      <div class="hg-alert-top">
        <div class="hg-alert-icon" aria-hidden="true">!</div>
        <p class="hg-alert-eyebrow">Occupancy threshold exceeded</p>
        <h2 id="hgOccupancyTitle">Crowd alert detected</h2>
        <p id="hgOccupancyDescription" class="hg-alert-description">
          A monitored area needs attention.
        </p>
      </div>

      <div class="hg-alert-body">
        <div class="hg-alert-zone" id="hgOccupancyZone">Monitoring zone</div>

        <div class="hg-alert-metrics">
          <div class="hg-alert-metric">
            <span>Estimated visitors</span>
            <strong id="hgOccupancyVisitors">—</strong>
          </div>
          <div class="hg-alert-metric">
            <span>Occupancy</span>
            <strong id="hgOccupancyPercent">—</strong>
          </div>
        </div>

        <div class="hg-alert-progress" aria-hidden="true">
          <span id="hgOccupancyProgress"></span>
        </div>

        <p class="hg-alert-advice" id="hgOccupancyAdvice">
          Review visitor flow in this area.
        </p>
      </div>

      <div class="hg-alert-actions">
        <button type="button"
          class="hg-alert-button hg-alert-secondary"
          id="hgOccupancyDismiss">
          Dismiss
        </button>
        <button type="button"
          class="hg-alert-button hg-alert-primary"
          id="hgOccupancyReview">
          Review Crowd Monitor →
        </button>
      </div>
    </section>
  `;

  document.body.appendChild(overlay);

  const zoneStates = new Map();
  let popupQueue = [];
  let popupOpen = false;
  let previousFocus = null;

  function closePopup() {
    overlay.classList.remove("hg-visible");
    overlay.setAttribute("aria-hidden", "true");
    popupOpen = false;

    if (previousFocus && document.contains(previousFocus)) {
      previousFocus.focus();
    }

    previousFocus = null;

    // Show the next queued alert only after the current one is dismissed.
    if (popupQueue.length) {
      setTimeout(() => showNextPopup(), 180);
    }
  }

  function showNextPopup() {
    if (popupOpen || !popupQueue.length) return;

    const zone = popupQueue.shift();
    if (!zone) return;

    popupOpen = true;
    previousFocus = document.activeElement;

    const percentage = Math.round(zone.occupancy);
    const overflow = zone.visitors > zone.capacity;

    $("hgOccupancyTitle").textContent = overflow
      ? "Zone capacity exceeded"
      : "High crowd density";

    $("hgOccupancyDescription").textContent = overflow
      ? "The estimated visitor count is above this zone's stated capacity."
      : "This zone has reached the configured high-occupancy threshold.";

    $("hgOccupancyZone").textContent = zone.name;
    $("hgOccupancyVisitors").textContent = zone.visitors;
    $("hgOccupancyPercent").textContent = percentage + "%";

    $("hgOccupancyProgress").style.width =
      Math.min(100, percentage) + "%";

    $("hgOccupancyAdvice").textContent = overflow
      ? "Recommended action: verify the count and consider directing visitors to an alternate route."
      : "Recommended action: monitor visitor flow and consider guiding visitors toward a less crowded area.";

    overlay.classList.add("hg-visible");
    overlay.setAttribute("aria-hidden", "false");

    $("hgOccupancyDismiss").focus();
  }

  function queuePopup(zone) {
    // Avoid queuing duplicate alerts for the same zone.
    if (popupQueue.some(item => item.name === zone.name)) return;

    if (popupOpen && $("hgOccupancyZone").textContent === zone.name) return;

    popupQueue.push({ ...zone });
    showNextPopup();
  }

  $("hgOccupancyDismiss").addEventListener("click", closePopup);

  $("hgOccupancyReview").addEventListener("click", () => {
    closePopup();

    if (typeof goToPage === "function") {
      goToPage("crowd");
    }
  });

  overlay.addEventListener("click", event => {
    if (event.target === overlay) closePopup();
  });

  document.addEventListener("keydown", event => {
    if (!popupOpen) return;

    if (event.key === "Escape") {
      closePopup();
      return;
    }

    if (event.key === "Tab") {
      const buttons = [
        $("hgOccupancyDismiss"),
        $("hgOccupancyReview")
      ];

      const first = buttons[0];
      const last = buttons[buttons.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  /*
   * Monitor readings after normal updates.
   * A zone triggers once when it enters the high state.
   * It can trigger again after returning below the threshold
   * and subsequently becoming crowded again.
   */
  function inspectOccupancy() {
    if (!Array.isArray(zones)) return;

    zones.forEach(zone => {
      const high =
        Number(zone.occupancy) >= 85 ||
        Number(zone.visitors) > Number(zone.capacity);

      const wasHigh = zoneStates.get(zone.name) === true;

      if (high && !wasHigh) {
        queuePopup(zone);
      }

      zoneStates.set(zone.name, high);
    });
  }

  /*
   * Wrap the existing updateMetrics function rather than
   * replacing it. Existing dashboard refreshes and counters
   * continue to work normally.
   */
  if (typeof updateMetrics === "function") {
    const originalUpdateMetrics = updateMetrics;

    updateMetrics = function (...args) {
      const result = originalUpdateMetrics.apply(this, args);

      try {
        inspectOccupancy();
      } catch (error) {
        console.error("Occupancy alert check failed:", error);
      }

      return result;
    };
  }

  console.info("HeritageGuard: professional occupancy alerts enabled.");
})();
