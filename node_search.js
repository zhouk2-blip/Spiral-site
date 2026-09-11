"use strict";

(function exposeNodeSearch(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HacoNodeSearch = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const SEARCH_FIELDS = [
    ["id", 100],
    ["short_id", 95],
    ["branch", 75],
    ["pair", 65],
    ["hypothesis", 55],
    ["finding", 45],
    ["operator", 40],
  ];

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function fieldValues(node, field) {
    if (field === "branch") return Array.isArray(node.branches) ? node.branches : [];
    return [node[field]];
  }

  function matchScore(value, query, fieldWeight) {
    const normalized = normalize(value);
    if (!normalized) return null;
    if (normalized === query) return fieldWeight + 100;
    if (normalized.startsWith(query)) return fieldWeight + 50;
    const position = normalized.indexOf(query);
    return position < 0 ? null : fieldWeight - Math.min(position, 30);
  }

  /** Rank nodes by identifier precision, then by descriptive metadata match. */
  function rankNodes(nodes, rawQuery, limit = 8) {
    const query = normalize(rawQuery);
    if (!query || !Array.isArray(nodes) || limit <= 0) return [];

    return nodes
      .map((node) => {
        let best = null;
        SEARCH_FIELDS.forEach(([field, weight]) => {
          fieldValues(node, field).forEach((value) => {
            const score = matchScore(value, query, weight);
            if (score !== null && (!best || score > best.score)) {
              best = {
                node,
                score,
                matchedField: field,
                matchedValue: String(value),
              };
            }
          });
        });
        return best;
      })
      .filter(Boolean)
      .sort(
        (left, right) =>
          right.score - left.score ||
          (Number(right.node.score) || -1) - (Number(left.node.score) || -1) ||
          String(left.node.short_id || left.node.id).localeCompare(
            String(right.node.short_id || right.node.id),
          ),
      )
      .slice(0, limit);
  }

  return { rankNodes };
});
