export const ACCEPTANCE_SCOPES = Object.freeze(["all", "cpu-memory"]);

const ALL_MEASURED_METRICS = Object.freeze([
  "time", "facade-profile-time", "peak-rss", "retained-heap", "cold-import", "gzip-size",
]);
const CPU_MEMORY_METRICS = Object.freeze([
  "time", "facade-profile-time", "peak-rss", "retained-heap",
]);

export function parseAcceptanceScope(value = "all") {
  if (!ACCEPTANCE_SCOPES.includes(value)) {
    throw new Error(`--acceptance must be one of ${ACCEPTANCE_SCOPES.map((scope) => `"${scope}"`).join(" or ")}; received ${JSON.stringify(value)}`);
  }
  return value;
}

export function acceptanceScopeDetails(scope) {
  const name = parseAcceptanceScope(scope);
  const blockingMetrics = name === "all" ? [...ALL_MEASURED_METRICS] : [...CPU_MEMORY_METRICS];
  const informationalMetrics = ALL_MEASURED_METRICS.filter((metric) => !blockingMetrics.includes(metric));
  return {
    name,
    collection: "full; all measured suites and rows are retained",
    blockingMetrics,
    informationalMetrics,
    allMeasuredMetrics: [...ALL_MEASURED_METRICS],
  };
}

export function classifyOverThreshold(rows, scope) {
  const { blockingMetrics } = acceptanceScopeDetails(scope);
  const unknownMetrics = rows.filter((row) => !ALL_MEASURED_METRICS.includes(row.metric));
  if (unknownMetrics.length > 0) {
    throw new Error(`unclassified acceptance metric: ${unknownMetrics.map((row) => JSON.stringify(row.metric)).join(", ")}`);
  }
  const blocking = new Set(blockingMetrics);
  return {
    over15Percent: rows.filter((row) => blocking.has(row.metric)),
    informationalOver15Percent: rows.filter((row) => !blocking.has(row.metric)),
    allOver15Percent: rows,
  };
}

export function acceptanceStatus(scope, over15Percent) {
  const name = parseAcceptanceScope(scope);
  if (name === "all") {
    return over15Percent.length === 0
      ? "pass"
      : "fail: investigate every over-threshold row; no aggregate score substitutes for row-level review";
  }
  return over15Percent.length === 0
    ? "pass: cpu-memory scope only; startup and bundle results remain informational"
    : "fail: cpu-memory scope has over-threshold rows; investigate every row";
}
