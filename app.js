"use strict";

const REFRESH_INTERVAL_MS = 2500;
const SVG_NS = "http://www.w3.org/2000/svg";
const STATUS_COLORS = {
  ok: "var(--blue)",
  running: "var(--phosphor)",
  buggy: "var(--red)",
  retryable: "var(--amber)",
  unknown: "var(--ink-faint)",
  root: "var(--ink-soft)",
};
const DEVICE_COLORS = {
  cpu: "var(--cyan)",
  cuda: "var(--violet)",
};
const EVENT_DETAIL_KEYS = [
  "ticket_id",
  "node_id",
  "lineage_id",
  "layer_id",
  "cluster_id",
  "execution_status",
  "mechanism_result",
  "anchor_eligibility",
  "role",
  "kind",
  "actor",
  "action",
  "reason",
  "status",
  "mechanism",
];
const { rankNodes } = window.HacoNodeSearch;
// A static export (dashboard/export_site.py) defines window.HACO_STATIC and the
// page then reads pre-rendered JSON instead of the live server; with `inline`
// the same data arrives as window.HACO_STATIC_DATA so file:// works too.
const STATIC_SITE = window.HACO_STATIC || null;

const state = {
  snapshot: null,
  selectedNodeId: null,
  detailNodeId: null,
  collapsed: new Set(),
  refreshTimer: null,
  requestInFlight: false,
  transform: { x: 60, y: 40, scale: 1 },
  drag: null,
  layoutBounds: null,
  searchResults: [],
  activeSearchIndex: 0,
  searchOpen: false,
};

const elements = {
  runSelect: document.getElementById("run-select"),
  refreshButton: document.getElementById("refresh-button"),
  liveToggle: document.getElementById("live-toggle"),
  connectionDot: document.getElementById("connection-dot"),
  connectionLabel: document.getElementById("connection-label"),
  updatedAt: document.getElementById("updated-at"),
  metricBest: document.getElementById("metric-best"),
  metricBestNode: document.getElementById("metric-best-node"),
  metricNodes: document.getElementById("metric-nodes"),
  metricRunning: document.getElementById("metric-running"),
  metricLeases: document.getElementById("metric-leases"),
  metricCapacity: document.getElementById("metric-capacity"),
  metricIssues: document.getElementById("metric-issues"),
  metricIssueLevel: document.getElementById("metric-issue-level"),
  metricAlert: document.querySelector(".metric-alert"),
  treeStage: document.getElementById("tree-stage"),
  tree: document.getElementById("research-tree"),
  viewport: document.getElementById("tree-viewport"),
  links: document.getElementById("tree-links"),
  nodes: document.getElementById("tree-nodes"),
  treeEmpty: document.getElementById("tree-empty"),
  tooltip: document.getElementById("tree-tooltip"),
  fitButton: document.getElementById("fit-button"),
  expandButton: document.getElementById("expand-button"),
  nodeSearch: document.querySelector(".node-search"),
  nodeSearchInput: document.getElementById("node-search-input"),
  nodeSearchClear: document.getElementById("node-search-clear"),
  nodeSearchResults: document.getElementById("node-search-results"),
  nodeSearchStatus: document.getElementById("node-search-status"),
  inspectorEmpty: document.getElementById("inspector-empty"),
  inspectorContent: document.getElementById("inspector-content"),
  inspectorStatus: document.getElementById("inspector-status"),
  candidateOperator: document.getElementById("candidate-operator"),
  candidateId: document.getElementById("candidate-id"),
  candidateScore: document.getElementById("candidate-score"),
  candidateDevice: document.getElementById("candidate-device"),
  candidateParent: document.getElementById("candidate-parent"),
  candidateBranch: document.getElementById("candidate-branch"),
  candidateArtifact: document.getElementById("candidate-artifact"),
  candidateTrust: document.getElementById("candidate-trust"),
  candidateMethod: document.getElementById("candidate-method"),
  candidatePair: document.getElementById("candidate-pair"),
  candidateReferences: document.getElementById("candidate-references"),
  candidateApproach: document.getElementById("candidate-approach"),
  candidateHypothesis: document.getElementById("candidate-hypothesis"),
  candidateHypothesisWrap: document.getElementById("candidate-hypothesis-wrap"),
  candidateFinding: document.getElementById("candidate-finding"),
  candidateFindingHeadline: document.getElementById("candidate-finding-headline"),
  candidateReceiptWrap: document.getElementById("candidate-receipt-wrap"),
  candidateReceipt: document.getElementById("candidate-receipt"),
  molecularHeadline: document.getElementById("candidate-molecular-headline"),
  molecularChips: document.getElementById("candidate-molecular-chips"),
  molecularCharacter: document.getElementById("candidate-molecular-character"),
  molecularGaps: document.getElementById("candidate-molecular-gaps"),
  molecularTasksWrap: document.getElementById("candidate-molecular-tasks-wrap"),
  molecularTasks: document.getElementById("candidate-molecular-tasks"),
  taskTableBody: document.getElementById("task-table-body"),
  taskTableNote: document.getElementById("task-table-note"),
  candidateChecks: document.getElementById("candidate-checks"),
  candidateLog: document.getElementById("candidate-log"),
  resourcePools: document.getElementById("resource-pools"),
  slotGrid: document.getElementById("slot-grid"),
  findingsList: document.getElementById("findings-list"),
  findingCount: document.getElementById("finding-count"),
  eventsList: document.getElementById("events-list"),
  repoPath: document.getElementById("repo-path"),
};

function createSvg(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => {
    node.setAttribute(key, String(value));
  });
  return node;
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character],
  );
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatScore(value, digits = 4) {
  const number = finiteNumber(value);
  return number === null ? "—" : number.toFixed(digits);
}

function compactId(value) {
  if (!value || value === "root") return value || "—";
  return String(value).slice(0, 10);
}

function labelledBlocks(target, pairs) {
  pairs.forEach(([label, text]) => {
    if (!text) return;
    const block = document.createElement("p");
    const lead = document.createElement("strong");
    lead.textContent = `${label}. `;
    block.append(lead, document.createTextNode(String(text)));
    target.append(block);
  });
}

//: The plan, before the run: the method this node builds on, and what it does
//: that is new. The pre-registered mechanism is the protocol's own wording and
//: stays folded away, because it is a contract, not an explanation.
function renderApproach(node) {
  elements.candidateApproach.replaceChildren();
  const approach = node.approach;

  if (approach) {
    // A root builds on a published method; every later node builds on its Parent.
    // Naming the reference is the whole point of the field, so the label says which.
    const reference = node.parent ? "Parent method" : "Method referenced";
    labelledBlocks(elements.candidateApproach, [
      [reference, approach.method_basis],
      ["What is new", approach.novelty],
    ]);
  } else {
    const note = document.createElement("p");
    note.className = node.hypothesis ? "inspector-note" : "";
    note.textContent = node.hypothesis
      ? "This node was pre-registered before the approach existed. Only its mechanism was recorded."
      : "No approach recorded.";
    elements.candidateApproach.append(note);
  }

  const mechanism = String(node.hypothesis || "");
  elements.candidateHypothesisWrap.hidden = !mechanism;
  elements.candidateHypothesis.textContent = mechanism;
}

//: The result, after the run. The implementation receipt is the audit trail
//: behind it and stays folded away, because it is provenance, not a finding.
function renderFinding(node) {
  const summary = node.finding_summary;
  elements.candidateFindingHeadline.textContent =
    summary?.headline || "No analysis finding yet.";
  elements.candidateFinding.replaceChildren();

  if (summary) {
    labelledBlocks(elements.candidateFinding, [
      ["Results", summary.results],
      ["Insights", summary.insights],
    ]);
  } else if (node.implementation_receipt) {
    const note = document.createElement("p");
    note.className = "inspector-note";
    note.textContent =
      "This node was analysed before the readable finding existed. Only its implementation receipt was recorded.";
    elements.candidateFinding.append(note);
  }

  const receipt = String(node.implementation_receipt || "");
  elements.candidateReceiptWrap.hidden = !receipt;
  elements.candidateReceipt.textContent = receipt;
}

const CHEM_CHIPS = [
  ["ring_systems", "rings"],
  ["aromaticity", "aromatic"],
  ["synthetic_plausibility", "synthesis"],
  ["drug_likeness", "drug-like"],
  ["structural_diversity", "diversity"],
];

//: What the algorithm actually generated, in words. The transferable gaps are
//: the part a later Research Intent may act on, so they lead.
function renderMolecular(molecular) {
  elements.molecularChips.replaceChildren();
  elements.molecularGaps.replaceChildren();
  elements.molecularTasks.replaceChildren();

  if (!molecular) {
    elements.molecularHeadline.textContent =
      "No molecular assessment for this node.";
    elements.molecularCharacter.textContent = "";
    elements.molecularTasksWrap.hidden = true;
    return;
  }

  elements.molecularHeadline.textContent = molecular.headline || "—";
  elements.molecularCharacter.textContent = molecular.overall_character || "";

  const quality = molecular.chemistry_quality || {};
  CHEM_CHIPS.forEach(([key, label]) => {
    const value = quality[key];
    if (!value) return;
    const chip = document.createElement("span");
    chip.className = `chem-chip chem-${String(value).replace(/_/g, "-")}`;
    chip.textContent = `${label}: ${value}`;
    elements.molecularChips.append(chip);
  });

  (molecular.transferable_gaps || []).forEach((gap) => {
    const item = document.createElement("div");
    item.className = "gap-item";
    const title = document.createElement("strong");
    title.textContent = gap.gap || "";
    item.append(title);
    [gap.evidence, gap.generator_implication].forEach((text) => {
      if (!text) return;
      const line = document.createElement("p");
      line.textContent = String(text);
      item.append(line);
    });
    elements.molecularGaps.append(item);
  });

  const tasks = molecular.per_task || [];
  elements.molecularTasksWrap.hidden = !tasks.length;
  tasks.forEach((task) => {
    const block = document.createElement("div");
    block.className = "molecular-task";

    const name = document.createElement("h5");
    name.textContent = task.task || "";
    block.append(name);

    [task.generated_character, task.score_gradient_reading].forEach((text) => {
      if (!text) return;
      const line = document.createElement("p");
      line.textContent = String(text);
      block.append(line);
    });

    [
      ["Missing", task.missing_features],
      ["Liabilities", task.liabilities],
    ].forEach(([label, values]) => {
      if (!Array.isArray(values) || !values.length) return;
      const heading = document.createElement("p");
      heading.className = "inspector-note";
      heading.textContent = label;
      block.append(heading);
      const list = document.createElement("ul");
      list.className = "gap-bullets";
      values.forEach((value) => {
        const entry = document.createElement("li");
        entry.textContent = String(value);
        list.append(entry);
      });
      block.append(list);
    });

    if (Array.isArray(task.cited_smiles) && task.cited_smiles.length) {
      const smiles = document.createElement("pre");
      smiles.className = "smiles-list";
      smiles.textContent = task.cited_smiles.join("\n");
      block.append(smiles);
    }
    elements.molecularTasks.append(block);
  });
}

function renderMethodReferences(references) {
  elements.candidateReferences.replaceChildren();
  if (!Array.isArray(references) || !references.length) {
    const item = document.createElement("li");
    item.className = "reference-empty";
    item.textContent = "The Idea role recorded no reference for this Method Lineage.";
    elements.candidateReferences.append(item);
    return;
  }

  references.forEach((reference) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    const url = String(reference?.url || "");
    link.textContent =
      reference?.title || reference?.citation || url || "Untitled reference";
    if (/^https?:\/\//i.test(url)) {
      link.href = url;
      link.target = "_blank";
      link.rel = "noreferrer";
    }
    item.append(link);

    const context = document.createElement("span");
    const kind = reference?.kind || "reference";
    const supports = reference?.supports || "method pair";
    context.textContent = `${kind} · supports ${supports}`;
    item.append(context);
    elements.candidateReferences.append(item);
  });
}

function setConnection(status, message) {
  elements.connectionDot.className = `connection-dot ${status}`;
  elements.connectionLabel.textContent = message;
}

function updateRunOptions(runTags, selected) {
  const currentOptions = [...elements.runSelect.options].map((option) => option.value);
  if (
    currentOptions.length === runTags.length &&
    currentOptions.every((value, index) => value === runTags[index])
  ) {
    elements.runSelect.value = selected || "";
    return;
  }
  elements.runSelect.replaceChildren();
  if (!runTags.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No campaign";
    elements.runSelect.append(option);
  } else {
    runTags.forEach((runTag) => {
      const option = document.createElement("option");
      option.value = runTag;
      option.textContent = runTag;
      elements.runSelect.append(option);
    });
  }
  elements.runSelect.value = selected || "";
}

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function staticDataRoot() {
  return (STATIC_SITE?.data_root || "data").replace(/\/+$/, "");
}

async function loadSnapshot(runTag) {
  if (!STATIC_SITE) {
    const query = runTag ? `?run_tag=${encodeURIComponent(runTag)}` : "";
    return loadJson(`/api/state${query}`);
  }
  const tag = runTag || STATIC_SITE.default_run || STATIC_SITE.run_tags?.[0] || "";
  // A cached site-config.js can still claim inline after an export switched to
  // files, leaving HACO_STATIC_DATA undefined; fall back instead of failing.
  if (STATIC_SITE.inline) {
    const run = window.HACO_STATIC_DATA?.runs?.[tag];
    if (run) return run.state;
  }
  return loadJson(`${staticDataRoot()}/${encodeURIComponent(tag)}/state.json`);
}

async function loadNodeDetail(runTag, nodeId) {
  if (!STATIC_SITE) {
    return loadJson(
      `/api/node?run_tag=${encodeURIComponent(runTag)}&node_id=${encodeURIComponent(nodeId)}`,
    );
  }
  if (STATIC_SITE.inline) {
    const detail = window.HACO_STATIC_DATA?.runs?.[runTag]?.nodes?.[nodeId];
    if (detail) return detail;
  }
  return loadJson(
    `${staticDataRoot()}/${encodeURIComponent(runTag)}/nodes/${encodeURIComponent(nodeId)}.json`,
  );
}

async function fetchSnapshot({ preserveSelection = true } = {}) {
  if (state.requestInFlight) return;
  state.requestInFlight = true;
  setConnection("", STATIC_SITE ? "Loading" : "Syncing");
  try {
    const snapshot = await loadSnapshot(elements.runSelect.value);
    state.snapshot = snapshot;
    updateRunOptions(snapshot.run_tags || [], snapshot.run_tag);
    if (
      !preserveSelection ||
      !snapshot.nodes.some((node) => node.id === state.selectedNodeId)
    ) {
      state.selectedNodeId =
        snapshot.best_node_id ||
        snapshot.nodes.find((node) => node.status === "running")?.id ||
        snapshot.nodes[0]?.id ||
        null;
    }
    renderAll();
    if (STATIC_SITE) {
      setConnection("connected", "Archived campaign");
      elements.updatedAt.textContent = `Exported ${new Date(
        snapshot.generated_at,
      ).toLocaleString()}`;
    } else {
      setConnection("connected", snapshot.run_tag ? "Live snapshot" : "Waiting");
      elements.updatedAt.textContent = `Updated ${new Date(
        snapshot.generated_at,
      ).toLocaleTimeString()}`;
    }
  } catch (error) {
    setConnection("failed", `Disconnected: ${error.message}`);
  } finally {
    state.requestInFlight = false;
  }
}

function scheduleRefresh() {
  clearInterval(state.refreshTimer);
  state.refreshTimer = null;
  if (STATIC_SITE) return;
  if (elements.liveToggle.checked) {
    state.refreshTimer = window.setInterval(() => fetchSnapshot(), REFRESH_INTERVAL_MS);
  }
}

function renderAll() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  renderMetrics(snapshot);
  renderTree(snapshot.nodes || []);
  renderSlots(snapshot);
  renderFindings(snapshot.issues || []);
  renderEvents(snapshot.events || []);
  renderInspector();
  renderNodeSearch();
  elements.repoPath.textContent = STATIC_SITE
    ? `Campaign ${snapshot.run_tag || "—"}`
    : snapshot.repo || "Repository unavailable";
}

function closeNodeSearch() {
  state.searchOpen = false;
  elements.nodeSearchResults.hidden = true;
  elements.nodeSearchInput.setAttribute("aria-expanded", "false");
}

function renderNodeSearch() {
  const query = elements.nodeSearchInput.value.trim();
  elements.nodeSearch.classList.toggle("has-query", Boolean(query));
  elements.nodeSearchClear.hidden = !query;
  state.searchResults = rankNodes(state.snapshot?.nodes || [], query, 8);
  state.activeSearchIndex = Math.min(
    state.activeSearchIndex,
    Math.max(0, state.searchResults.length - 1),
  );
  elements.nodeSearchResults.replaceChildren();

  if (!query) {
    elements.nodeSearchStatus.textContent = "";
    closeNodeSearch();
    return;
  }

  if (!state.searchResults.length) {
    const empty = document.createElement("div");
    empty.className = "node-search-empty";
    empty.textContent = `No node matches “${query}”.`;
    elements.nodeSearchResults.append(empty);
    elements.nodeSearchStatus.textContent = "No matching research node.";
  } else {
    state.searchResults.forEach((result, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `node-search-result ${
        index === state.activeSearchIndex ? "active" : ""
      }`;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(index === state.activeSearchIndex));
      const label = document.createElement("span");
      label.className = "node-search-result-id";
      label.textContent = `${result.node.short_id || compactId(result.node.id)} · ${
        result.node.operator || "unknown"
      }`;
      const score = document.createElement("span");
      score.className = "node-search-result-score";
      score.textContent = formatScore(result.node.score);
      const match = document.createElement("span");
      match.className = "node-search-result-match";
      match.textContent = `${result.matchedField} / ${result.matchedValue}`;
      button.append(label, score, match);
      button.addEventListener("pointerenter", () => {
        if (state.activeSearchIndex !== index) {
          state.activeSearchIndex = index;
          renderNodeSearch();
        }
      });
      button.addEventListener("click", () => locateNode(result.node.id));
      elements.nodeSearchResults.append(button);
    });
    elements.nodeSearchStatus.textContent = `${state.searchResults.length} matching research nodes.`;
  }
  elements.nodeSearchResults.hidden = !state.searchOpen;
  elements.nodeSearchInput.setAttribute("aria-expanded", String(state.searchOpen));
}

function centerNodeInTree(nodeId) {
  const group = [...elements.nodes.querySelectorAll(".tree-node")].find(
    (candidate) => candidate.dataset.nodeId === nodeId,
  );
  const transform = group?.getAttribute("transform") || "";
  const match = /translate\(([-\d.]+),([-\d.]+)\)/.exec(transform);
  if (!group || !match) return;
  const stageBounds = elements.treeStage.getBoundingClientRect();
  const scale = Math.max(0.72, state.transform.scale);
  state.transform = {
    x: stageBounds.width / 2 - Number(match[1]) * scale,
    y: stageBounds.height / 2 - Number(match[2]) * scale,
    scale,
  };
  applyTransform();
  group.classList.add("located");
  window.setTimeout(() => group.classList.remove("located"), 1500);
}

function locateNode(nodeId) {
  const nodes = state.snapshot?.nodes || [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let current = byId.get(nodeId);
  while (current?.parent && current.parent !== "root") {
    state.collapsed.delete(current.parent);
    current = byId.get(current.parent);
  }
  selectNode(nodeId);
  closeNodeSearch();
  window.requestAnimationFrame(() => centerNodeInTree(nodeId));
}

function renderMetrics(snapshot) {
  const overview = snapshot.overview || {};
  elements.metricBest.textContent = formatScore(overview.best_score);
  const bestNode = snapshot.nodes.find((node) => node.id === snapshot.best_node_id);
  elements.metricBestNode.textContent = bestNode
    ? `${compactId(bestNode.id)} · ${bestNode.operator}`
    : "No scored node";
  elements.metricNodes.textContent = overview.nodes ?? 0;
  elements.metricRunning.textContent = `${overview.running_nodes ?? 0} currently running`;
  elements.metricLeases.textContent = overview.active_leases ?? 0;
  const resources = Object.values(snapshot.resources || {});
  const capacity = resources.reduce(
    (total, resource) => total + Number(resource.capacity || 0),
    0,
  );
  elements.metricCapacity.textContent = `${capacity} total capacity`;
  elements.metricIssues.textContent = overview.issues ?? 0;
  const errors = (snapshot.issues || []).filter(
    (issue) => issue.severity === "error",
  ).length;
  elements.metricIssueLevel.textContent = errors
    ? `${errors} require attention`
    : overview.issues
      ? "Warnings or information"
      : "No inconsistencies";
  elements.metricAlert.classList.toggle("has-issues", Boolean(overview.issues));
}

function buildVisibleTree(nodes) {
  const root = {
    id: "root",
    short_id: "root",
    parent: null,
    operator: "campaign",
    status: "root",
    score: null,
    children: [],
  };
  const byId = new Map([["root", root]]);
  nodes.forEach((node) => byId.set(node.id, { ...node, children: [] }));
  nodes.forEach((node) => {
    const copy = byId.get(node.id);
    const parent = byId.get(node.parent) || root;
    if (copy !== parent) parent.children.push(copy);
  });

  function sortChildren(node) {
    node.children.sort((left, right) => {
      const scoreDelta = (finiteNumber(right.score) ?? -1) - (finiteNumber(left.score) ?? -1);
      return scoreDelta || left.short_id.localeCompare(right.short_id);
    });
    node.children.forEach(sortChildren);
  }
  sortChildren(root);

  const visible = [];
  let row = 0;
  function visit(node, depth) {
    const isCollapsed = state.collapsed.has(node.id);
    const children = isCollapsed ? [] : node.children;
    const startRow = row;
    children.forEach((child) => visit(child, depth + 1));
    if (!children.length) row += 1;
    const endRow = row;
    node.depth = depth;
    node.x = depth * 215;
    node.y = ((startRow + endRow - 1) / 2) * 62;
    node.hiddenChildren = isCollapsed ? node.children.length : 0;
    visible.push(node);
  }
  visit(root, 0);
  return visible;
}

function renderTree(nodes) {
  elements.links.replaceChildren();
  elements.nodes.replaceChildren();
  elements.treeEmpty.hidden = nodes.length > 0;
  if (!nodes.length) {
    state.layoutBounds = null;
    return;
  }

  const visible = buildVisibleTree(nodes);
  const visibleById = new Map(visible.map((node) => [node.id, node]));
  visible
    .filter((node) => node.parent && visibleById.has(node.parent))
    .forEach((node) => {
      const parent = visibleById.get(node.parent);
      const path = createSvg("path", {
        class: `tree-link ${node.on_best_path && parent.on_best_path ? "best" : ""}`,
        d: horizontalCurve(parent.x, parent.y, node.x, node.y),
      });
      elements.links.append(path);
    });

  visible.forEach((node) => {
    const score = finiteNumber(node.score);
    const radius = node.id === "root" ? 11 : 7 + (score ?? 0.15) * 9;
    const group = createSvg("g", {
      class: `tree-node ${node.id === state.selectedNodeId ? "selected" : ""}`,
      transform: `translate(${node.x},${node.y})`,
      "data-node-id": node.id,
      role: "button",
      tabindex: "0",
      "aria-label":
        node.id === "root"
          ? `Campaign root with ${nodes.length} candidates`
          : `${node.operator} candidate ${compactId(node.id)}, status ${node.status}, score ${formatScore(node.score)}`,
    });
    const selectRing = createSvg("circle", {
      class: "node-select-ring",
      r: radius + 7,
    });
    const circle = createSvg("circle", {
      class: "node-core",
      r: radius,
      fill: STATUS_COLORS[node.status_key || node.status] || STATUS_COLORS.unknown,
      stroke: DEVICE_COLORS[node.device] || "var(--rule-bright)",
    });
    group.append(selectRing, circle);

    const label = createSvg("text", {
      class: "node-label",
      x: radius + 9,
      y: -2,
    });
    label.textContent =
      node.id === "root" ? "campaign root" : `${node.operator} · ${compactId(node.id)}`;
    const scoreLabel = createSvg("text", {
      class: "node-score",
      x: radius + 9,
      y: 11,
    });
    scoreLabel.textContent =
      node.id === "root"
        ? `${nodes.length} candidates`
        : `${node.status} / ${formatScore(node.score)}`;
    group.append(label, scoreLabel);

    if (node.children.length) {
      const marker = createSvg("circle", {
        class: "fold-marker",
        cx: -radius - 7,
        cy: 0,
        r: 7,
      });
      const count = createSvg("text", {
        class: "fold-count",
        x: -radius - 7,
        y: 0,
      });
      count.textContent = node.hiddenChildren ? `+${node.hiddenChildren}` : "−";
      group.append(marker, count);
    }

    group.addEventListener("click", (event) => {
      event.stopPropagation();
      if (node.id !== "root") selectNode(node.id);
    });
    group.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!node.children.length) return;
      if (state.collapsed.has(node.id)) state.collapsed.delete(node.id);
      else state.collapsed.add(node.id);
      renderTree(state.snapshot.nodes || []);
    });
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && node.id !== "root") {
        event.preventDefault();
        selectNode(node.id);
      }
      if (event.key === " " && node.children.length) {
        event.preventDefault();
        if (state.collapsed.has(node.id)) state.collapsed.delete(node.id);
        else state.collapsed.add(node.id);
        renderTree(state.snapshot.nodes || []);
      }
    });
    group.addEventListener("pointerenter", (event) => showTooltip(event, node));
    group.addEventListener("pointermove", (event) => positionTooltip(event));
    group.addEventListener("pointerleave", hideTooltip);
    elements.nodes.append(group);
  });

  const maxX = Math.max(...visible.map((node) => node.x)) + 280;
  const maxY = Math.max(...visible.map((node) => node.y)) + 80;
  state.layoutBounds = { minX: -30, minY: -50, maxX, maxY };
  applyTransform();
}

function horizontalCurve(x1, y1, x2, y2) {
  const middle = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`;
}

function showTooltip(event, node) {
  elements.tooltip.innerHTML = `
    <strong>${escapeHtml(node.operator)} / ${escapeHtml(compactId(node.id))}</strong>
    <span>Status: ${escapeHtml(node.status)} · Score: ${escapeHtml(
      formatScore(node.score),
    )}</span>
    <span>${escapeHtml(node.hypothesis || node.pair || "No hypothesis recorded")}</span>
  `;
  elements.tooltip.classList.add("visible");
  positionTooltip(event);
}

function positionTooltip(event) {
  const bounds = elements.treeStage.getBoundingClientRect();
  const tooltipBounds = elements.tooltip.getBoundingClientRect();
  const left = Math.min(
    event.clientX - bounds.left + 14,
    bounds.width - tooltipBounds.width - 10,
  );
  const top = Math.min(
    event.clientY - bounds.top + 14,
    bounds.height - tooltipBounds.height - 10,
  );
  elements.tooltip.style.left = `${Math.max(8, left)}px`;
  elements.tooltip.style.top = `${Math.max(8, top)}px`;
}

function hideTooltip() {
  elements.tooltip.classList.remove("visible");
}

function applyTransform() {
  const { x, y, scale } = state.transform;
  elements.viewport.setAttribute("transform", `translate(${x},${y}) scale(${scale})`);
}

function fitTree() {
  if (!state.layoutBounds) return;
  const stageBounds = elements.treeStage.getBoundingClientRect();
  const width = state.layoutBounds.maxX - state.layoutBounds.minX;
  const height = state.layoutBounds.maxY - state.layoutBounds.minY;
  const scale = Math.max(
    0.16,
    Math.min(1.15, (stageBounds.width - 50) / width, (stageBounds.height - 50) / height),
  );
  state.transform = {
    x: 25 - state.layoutBounds.minX * scale,
    y: (stageBounds.height - height * scale) / 2 - state.layoutBounds.minY * scale,
    scale,
  };
  applyTransform();
}

function selectNode(nodeId) {
  state.selectedNodeId = nodeId;
  renderTree(state.snapshot?.nodes || []);
  renderInspector();
}

async function renderInspector() {
  const node = state.snapshot?.nodes.find(
    (candidate) => candidate.id === state.selectedNodeId,
  );
  if (!node) {
    state.detailNodeId = null;
    elements.inspectorEmpty.hidden = false;
    elements.inspectorContent.hidden = true;
    elements.inspectorStatus.textContent = "No selection";
    elements.inspectorStatus.className = "status-chip status-unknown";
    return;
  }

  elements.inspectorEmpty.hidden = true;
  elements.inspectorContent.hidden = false;
  elements.inspectorStatus.textContent = node.status;
  elements.inspectorStatus.className = `status-chip status-${
    node.status_key || "unknown"
  }`;
  elements.candidateOperator.textContent = node.operator || "unknown";
  elements.candidateId.textContent = node.short_id || compactId(node.id);
  elements.candidateScore.textContent = formatScore(node.score);
  elements.candidateDevice.textContent = node.device || "not recorded";
  elements.candidateParent.textContent = compactId(node.parent);
  elements.candidateBranch.textContent = node.branches?.join(" · ") || "—";
  elements.candidateArtifact.textContent = node.artifact_dir || "not finalized";
  elements.candidateTrust.textContent = node.research_trust || "not recorded";
  elements.candidateMethod.textContent =
    node.method_name || "No bound Method Lineage recorded.";
  elements.candidatePair.textContent = node.pair
    ? `mechanism signature ${node.pair}`
    : "No mechanism signature recorded.";
  renderMethodReferences(node.method_references);
  renderApproach(node);
  renderFinding(node);
  renderMolecular(node.molecular);
  renderCandidateChecks(node.checks || []);

  // A live refresh re-reads the detail every few seconds. Only a genuine change
  // of selection clears the table and the log; otherwise they would flicker.
  const isNewSelection = state.detailNodeId !== node.id;
  if (isNewSelection) {
    setTaskTableMessage("Loading the evaluator's per-task result…");
    elements.candidateLog.textContent = "Loading bounded log tail…";
  }

  const runTag = state.snapshot?.run_tag;
  if (!runTag) {
    state.detailNodeId = null;
    setTaskTableMessage("No campaign is selected.");
    return;
  }
  try {
    const detail = await loadNodeDetail(runTag, node.id);
    if (state.selectedNodeId !== node.id) return;
    state.detailNodeId = node.id;
    renderTaskRows(detail.tasks || []);
    elements.candidateLog.textContent = formatLogTail(detail.logs);
  } catch (error) {
    if (isNewSelection) {
      setTaskTableMessage(`Could not load the per-task result: ${error.message}`);
      elements.candidateLog.textContent = `Could not load logs: ${error.message}`;
    }
  }
}

function formatLogTail(logs) {
  const sections = (logs?.tail || []).filter((entry) => entry?.text);
  if (sections.length) {
    return sections
      .map((entry) => `── ${entry.path}\n${entry.text}`)
      .join("\n\n");
  }
  const paths = logs?.run || [];
  return paths.length
    ? `No readable log body. Recorded paths:\n${paths.join("\n")}`
    : "No finalized run.log is available.";
}

function setTaskTableMessage(message) {
  elements.taskTableBody.replaceChildren();
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 6;
  cell.textContent = message;
  row.append(cell);
  elements.taskTableBody.append(row);
}

function renderTaskRows(tasks) {
  if (!tasks.length) {
    setTaskTableMessage("No evaluator summary is recorded for this node.");
    if (elements.taskTableNote) elements.taskTableNote.hidden = true;
    return;
  }
  if (elements.taskTableNote) elements.taskTableNote.hidden = false;
  elements.taskTableBody.replaceChildren();
  tasks.forEach((task) => {
    const row = document.createElement("tr");
    row.className = "task-row";
    const scored = Number(task.seeds_scored ?? 0);
    const recorded = Number(task.seeds_recorded ?? 0);
    const values = [
      task.task,
      task.status,
      formatScore(task.initial_top1, 3),
      formatScore(task.final_top1, 3),
      formatScore(task.auc, 3),
      `${scored}/${recorded}`,
    ];
    values.forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (index === 1) {
        cell.className = `task-${task.status}`;
        if (task.errors?.length) cell.title = task.errors.join(" / ");
      }
      if (index === 5 && task.uncounted_seeds?.length) {
        cell.className = "task-missing";
        cell.title = `Not counted: seed ${task.uncounted_seeds.join(", ")}`;
      }
      row.append(cell);
    });
    elements.taskTableBody.append(row);
    renderSeedRows(task);
  });
}

//: The mean is the number the protocol ranks by, but it hides whether the
//: seeds agreed. Each seed's own result sits under its task, and a seed the
//: mean excluded is still shown, marked, rather than silently dropped.
function renderSeedRows(task) {
  (task.per_seed || []).forEach((entry) => {
    const row = document.createElement("tr");
    row.className = entry.counted ? "seed-row" : "seed-row seed-uncounted";

    const label = document.createElement("td");
    label.textContent =
      entry.seed_kind === "confirmation"
        ? `seed ${entry.seed} · confirmation`
        : `seed ${entry.seed}`;
    row.append(label);

    const status = document.createElement("td");
    status.textContent = entry.status;
    status.className = `task-${entry.status}`;
    if (entry.error) status.title = entry.error;
    row.append(status);

    [entry.initial_top1, entry.final_top1, entry.auc].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = formatScore(value, 3);
      row.append(cell);
    });

    const note = document.createElement("td");
    if (!entry.counted) {
      note.textContent = "uncounted";
      note.className = "task-missing";
      note.title = "Recorded, but not averaged into the task mean.";
    }
    row.append(note);

    elements.taskTableBody.append(row);
  });
}

function renderCandidateChecks(checks) {
  elements.candidateChecks.replaceChildren();
  if (!checks.length) {
    const item = document.createElement("div");
    item.className = "check-item check-ok";
    item.textContent = "No consistency violations detected.";
    elements.candidateChecks.append(item);
    return;
  }
  checks.forEach((check) => {
    const item = document.createElement("div");
    item.className = `check-item severity-${check.severity}`;
    item.textContent = check.message;
    elements.candidateChecks.append(item);
  });
}

function renderSlots(snapshot) {
  elements.resourcePools.replaceChildren();
  ["cuda"].forEach((device) => {
    const resource = snapshot.resources?.[device] || {
      capacity: 0,
      used: 0,
      available: 0,
    };
    const utilization =
      resource.capacity > 0 ? Math.min(100, (resource.used / resource.capacity) * 100) : 0;
    const pool = document.createElement("div");
    pool.className = `pool pool-${device}`;
    pool.innerHTML = `
      <div class="pool-head">
        <span>${escapeHtml(device)} pool</span>
        <strong>${resource.used}/${resource.capacity}</strong>
      </div>
      <div class="pool-bar"><span style="width:${utilization}%"></span></div>
      <div class="pool-usage">
        <span>${resource.available} available</span>
        <span>${escapeHtml(resource.profile?.cpu_cores ?? "—")} CPU cores / lease</span>
      </div>
    `;
    elements.resourcePools.append(pool);
  });

  elements.slotGrid.replaceChildren();
  const slots = snapshot.slots || [];
  if (!slots.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = "No build slots are configured yet.";
    elements.slotGrid.append(empty);
    return;
  }
  slots.forEach((slot) => {
    const card = document.createElement("article");
    card.className = "slot-card";
    const lease = slot.lease || {};
    const detail =
      slot.hypothesis ||
      slot.pair ||
      (slot.state === "idle" ? "Available for the next candidate." : "No metadata recorded.");
    card.innerHTML = `
      <div class="slot-card-head">
        <span class="slot-name">slot-${slot.slot}</span>
        <span class="slot-state ${escapeHtml(slot.state)}">${escapeHtml(slot.state)}</span>
      </div>
      <span class="slot-device ${escapeHtml(slot.device || "")}">${escapeHtml(
        slot.device || "unassigned",
      )}</span>
      <p class="slot-detail">${escapeHtml(detail)}</p>
      <span class="slot-resource">${escapeHtml(
        lease.resource_id || "no execution lease",
      )}${lease.gpu_id ? ` / gpu ${escapeHtml(lease.gpu_id)}` : ""}</span>
    `;
    if (slot.node_id) {
      card.addEventListener("click", () => {
        const candidate = snapshot.nodes.find(
          (node) =>
            node.id === slot.node_id ||
            node.id.startsWith(slot.node_id) ||
            slot.node_id.startsWith(node.short_id),
        );
        if (candidate) selectNode(candidate.id);
      });
    }
    elements.slotGrid.append(card);
  });
}

function renderFindings(findings) {
  elements.findingCount.textContent = findings.length;
  elements.findingsList.replaceChildren();
  if (!findings.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = "All currently observable invariants are consistent.";
    elements.findingsList.append(empty);
    return;
  }
  findings.forEach((finding) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `finding-item severity-${finding.severity}`;
    item.innerHTML = `
      <strong>${escapeHtml(finding.label || finding.scope || "campaign")}</strong>
      ${escapeHtml(finding.message)}
    `;
    if (finding.node_id) {
      item.addEventListener("click", () => selectNode(finding.node_id));
    } else {
      item.disabled = true;
    }
    elements.findingsList.append(item);
  });
}

function humanizeEventName(name) {
  const label = String(name || "campaign event").replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function truncate(value, limit) {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function eventTime(event) {
  if (event.at) {
    const parsed = new Date(event.at);
    if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleTimeString();
  }
  if (event.epoch) return new Date(Number(event.epoch) * 1000).toLocaleTimeString();
  return "unknown time";
}

function summarizeEventDetail(detail) {
  if (!detail || typeof detail !== "object") return "";
  const named = EVENT_DETAIL_KEYS.filter(
    (key) => detail[key] !== undefined && detail[key] !== null && detail[key] !== "",
  );
  const keys = named.length ? named : Object.keys(detail).slice(0, 3);
  return keys
    .map((key) => {
      const value = detail[key];
      const rendered =
        value !== null && typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
      return `${key}=${truncate(rendered, 72)}`;
    })
    .join(" · ");
}

function renderEvents(events) {
  elements.eventsList.replaceChildren();
  if (!events.length) {
    const empty = document.createElement("li");
    empty.className = "empty-list";
    empty.textContent = "No campaign events recorded.";
    elements.eventsList.append(empty);
    return;
  }
  events.forEach((event) => {
    const item = document.createElement("li");
    item.className = "event-item";
    const meta = [eventTime(event)];
    if (event.round !== undefined && event.round !== null) {
      meta.push(`round ${event.round}`);
    }
    if (event.stage) meta.push(event.stage);
    const summary = summarizeEventDetail(event.detail);
    item.innerHTML = `
      <strong>${escapeHtml(humanizeEventName(event.event || event.type))}</strong>
      <span class="event-meta">${escapeHtml(meta.join(" · "))}</span>
      ${summary ? `<code>${escapeHtml(summary)}</code>` : ""}
    `;
    elements.eventsList.append(item);
  });
}

elements.refreshButton.addEventListener("click", () => fetchSnapshot());
elements.liveToggle.addEventListener("change", scheduleRefresh);
elements.runSelect.addEventListener("change", () => {
  state.selectedNodeId = null;
  state.detailNodeId = null;
  state.collapsed.clear();
  elements.nodeSearchInput.value = "";
  closeNodeSearch();
  fetchSnapshot({ preserveSelection: false });
});
elements.nodeSearchInput.addEventListener("input", () => {
  state.activeSearchIndex = 0;
  state.searchOpen = true;
  renderNodeSearch();
});
elements.nodeSearchInput.addEventListener("focus", () => {
  if (elements.nodeSearchInput.value.trim()) {
    state.searchOpen = true;
    renderNodeSearch();
  }
});
elements.nodeSearchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeNodeSearch();
    elements.nodeSearchInput.blur();
    return;
  }
  if (!state.searchResults.length) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    state.activeSearchIndex =
      (state.activeSearchIndex + direction + state.searchResults.length) %
      state.searchResults.length;
    state.searchOpen = true;
    renderNodeSearch();
  } else if (event.key === "Enter") {
    event.preventDefault();
    locateNode(state.searchResults[state.activeSearchIndex].node.id);
  }
});
elements.nodeSearchClear.addEventListener("click", () => {
  elements.nodeSearchInput.value = "";
  state.activeSearchIndex = 0;
  renderNodeSearch();
  elements.nodeSearchInput.focus();
});
document.addEventListener("pointerdown", (event) => {
  if (!elements.nodeSearch.contains(event.target)) closeNodeSearch();
});
document.addEventListener("keydown", (event) => {
  const target = event.target;
  const isTyping =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target?.isContentEditable;
  if (event.key === "/" && !isTyping && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    elements.nodeSearchInput.focus();
    elements.nodeSearchInput.select();
  }
});
elements.fitButton.addEventListener("click", fitTree);
elements.expandButton.addEventListener("click", () => {
  state.collapsed.clear();
  renderTree(state.snapshot?.nodes || []);
  window.setTimeout(fitTree, 20);
});
elements.tree.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  if (event.target.closest(".tree-node")) return;
  state.drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: state.transform.x,
    originY: state.transform.y,
  };
  elements.tree.setPointerCapture(event.pointerId);
  elements.tree.classList.add("dragging");
});
elements.tree.addEventListener("pointermove", (event) => {
  if (!state.drag || event.pointerId !== state.drag.pointerId) return;
  state.transform.x = state.drag.originX + event.clientX - state.drag.startX;
  state.transform.y = state.drag.originY + event.clientY - state.drag.startY;
  applyTransform();
});
function endDrag(event) {
  if (!state.drag || event.pointerId !== state.drag.pointerId) return;
  state.drag = null;
  elements.tree.classList.remove("dragging");
}
elements.tree.addEventListener("pointerup", endDrag);
elements.tree.addEventListener("pointercancel", endDrag);
elements.tree.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const bounds = elements.tree.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    const previousScale = state.transform.scale;
    const nextScale = Math.max(
      0.12,
      Math.min(2.8, previousScale * Math.exp(-event.deltaY * 0.0012)),
    );
    const worldX = (pointerX - state.transform.x) / previousScale;
    const worldY = (pointerY - state.transform.y) / previousScale;
    state.transform.x = pointerX - worldX * nextScale;
    state.transform.y = pointerY - worldY * nextScale;
    state.transform.scale = nextScale;
    applyTransform();
  },
  { passive: false },
);
elements.tree.addEventListener("click", hideTooltip);
window.addEventListener("resize", () => {
  if (state.layoutBounds) fitTree();
});

function applyStaticMode() {
  if (!STATIC_SITE) return;
  document.body.classList.add("static-site");
  elements.liveToggle.checked = false;
  elements.liveToggle.disabled = true;
  const eyebrow = document.getElementById("masthead-eyebrow");
  const title = document.getElementById("masthead-title");
  const footerRole = document.getElementById("footer-role");
  if (eyebrow) eyebrow.textContent = STATIC_SITE.eyebrow || "Molecular design / research record";
  if (title && STATIC_SITE.title) {
    title.textContent = STATIC_SITE.title;
    document.title = STATIC_SITE.title;
  }
  if (footerRole) footerRole.textContent = "Static export of the campaign record";
  elements.inspectorEmpty.textContent =
    "Select a node to examine its method, finding, molecular feature, and five-task result.";
  updateRunOptions(STATIC_SITE.run_tags || [], STATIC_SITE.default_run);
}

applyStaticMode();
fetchSnapshot({ preserveSelection: false }).then(() => {
  window.setTimeout(fitTree, 30);
});
scheduleRefresh();
