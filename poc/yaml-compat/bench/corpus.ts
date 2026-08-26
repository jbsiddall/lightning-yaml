/**
 * Deterministic corpus generator for the yaml-compat POC baseline.
 *
 * Produces a fixed set of YAML fixtures (no network, no randomness beyond a
 * seeded PRNG) that exercise the workloads named in the optimization thesis:
 * JSON-shaped records, block-style config, comment-dense k8s/compose/CI files,
 * multi-document streams, and a large block-YAML stress case.
 *
 * Run:  node --import tsx poc/yaml-compat/bench/corpus.ts
 * Files land in poc/yaml-compat/bench/corpus/. Files >500 KB are gitignored.
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "corpus");

// ---- tiny seeded PRNG (mulberry32) -----------------------------------------
function prng(seed: number) {
  let a = seed | 0;
  return (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHA = "abcdefghijklmnopqrstuvwxyz";
const WORDS = [
  "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel",
  "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa",
  "quebec", "romeo", "sierra", "tango", "uniform", "victor", "whiskey",
  "xray", "yankee", "zulu", "server", "client", "config", "service", "node",
  "pod", "deploy", "replica", "image", "port", "volume", "network", "build",
  "test", "stage", "prod", "dev", "cache", "queue", "worker", "job", "task",
];

function pick<T>(rand: () => number, xs: T[]): T {
  return xs[Math.floor(rand() * xs.length)];
}

function ident(rand: () => number, len = 6): string {
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHA[Math.floor(rand() * 26)];
  return s;
}

function write(name: string, text: string): void {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const p = join(OUT, name);
  writeFileSync(p, text);
  const kb = (Buffer.byteLength(text) / 1024).toFixed(1);
  console.log(`  wrote ${name} (${kb} KB)`);
}

// ---- json-records (small / medium / large) ---------------------------------
function jsonRecordsYaml(targetBytes: number): string {
  const rand = prng(0xC0FFEE);
  const lines: string[] = [];
  let size = 0;
  let i = 0;
  while (size < targetBytes) {
    const name = pick(rand, WORDS) + "-" + ident(rand, 4);
    const host = ident(rand, 5) + "." + pick(rand, ["io", "dev", "app", "net"]);
    const enabled = rand() > 0.3;
    const replicas = 1 + Math.floor(rand() * 12);
    const port = 1024 + Math.floor(rand() * 64000);
    const weight = +(rand() * 100).toFixed(4);
    const tag = "v" + (1 + Math.floor(rand() * 9)) + "." + Math.floor(rand() * 20) + "." + Math.floor(rand() * 10);
    const desc = pick(rand, WORDS) + " " + pick(rand, WORDS) + " " + pick(rand, WORDS);
    lines.push(`- name: ${name}`);
    lines.push(`  host: ${host}`);
    lines.push(`  enabled: ${enabled}`);
    lines.push(`  replicas: ${replicas}`);
    lines.push(`  port: ${port}`);
    lines.push(`  weight: ${weight}`);
    lines.push(`  tag: ${tag}`);
    lines.push(`  description: "${desc}"`);
    lines.push(`  index: ${i}`);
    for (let j = 0; j < 3; j++) {
      lines.push(`  label_${j}: ${pick(rand, WORDS)}-${ident(rand, 3)}`);
    }
    size = lines.reduce((a, l) => a + l.length + 1, 0);
    i++;
  }
  return lines.join("\n") + "\n";
}

// ---- block-config (~50 KB) -------------------------------------------------
function blockConfigYaml(targetBytes: number): string {
  const rand = prng(0xBEEF);
  const out: string[] = [];
  let size = 0;
  let section = 0;
  while (size < targetBytes) {
    const secName = pick(rand, WORDS) + "_" + section;
    out.push(`${secName}:`);
    const fields = 6 + Math.floor(rand() * 10);
    for (let f = 0; f < fields; f++) {
      const k = pick(rand, WORDS) + "_" + ident(rand, 3);
      const v = rand() > 0.5 ? String(Math.floor(rand() * 10000)) : pick(rand, WORDS);
      out.push(`  ${k}: ${v}`);
    }
    out.push(`  nested:`);
    const subs = 2 + Math.floor(rand() * 4);
    for (let s = 0; s < subs; s++) {
      out.push(`    - name: ${ident(rand, 5)}`);
      out.push(`      enabled: ${rand() > 0.4}`);
      out.push(`      count: ${Math.floor(rand() * 500)}`);
    }
    out.push("");
    size = out.reduce((a, l) => a + l.length + 1, 0);
    section++;
  }
  return out.join("\n") + "\n";
}

// ---- comments-rich: k8s deployment (~10 KB) --------------------------------
function k8sDeploymentYaml(): string {
  const rand = prng(0xFACE);
  const lines: string[] = [];
  lines.push("# Kubernetes Deployment manifest");
  lines.push("# Generated for baseline benchmarks — do not hand-edit");
  lines.push("# Maintainer: platform-team@example.com");
  lines.push("apiVersion: apps/v1");
  lines.push("kind: Deployment");
  lines.push("metadata:");
  lines.push("  # The name must be DNS-compatible and <=63 chars");
  lines.push("  name: baseline-workload");
  lines.push("  namespace: production");
  lines.push("  labels:");
  lines.push("    # Used by Service selector — keep in sync");
  lines.push("    app: baseline");
  lines.push("    tier: backend");
  lines.push("    env: prod");
  lines.push("spec:");
  lines.push("  # Replica count tuned for the POC baseline");
  lines.push("  replicas: 4");
  lines.push("  selector:");
  lines.push("    matchLabels:");
  lines.push("      app: baseline");
  lines.push("  strategy:");
  lines.push("    # RollingUpdate keeps the old pod alive until the new one is Ready");
  lines.push("    type: RollingUpdate");
  lines.push("    rollingUpdate:");
  lines.push("      maxSurge: 1");
  lines.push("      maxUnavailable: 0");
  lines.push("  template:");
  lines.push("    metadata:");
  lines.push("      labels:");
  lines.push("        app: baseline");
  lines.push("        # Hash the config to trigger rollout on change");
  lines.push("        config-hash: abc123def456");
  lines.push("    spec:");
  lines.push("      # Prefer spread across nodes for resilience");
  lines.push("      affinity:");
  lines.push("        podAntiAffinity:");
  lines.push("          preferredDuringSchedulingIgnoredDuringExecution:");
  lines.push("            - weight: 100");
  lines.push("              podAffinityTerm:");
  lines.push("                labelSelector:");
  lines.push("                  matchExpressions:");
  lines.push("                    - key: app");
  lines.push("                      operator: In");
  lines.push("                      values: [baseline]");
  lines.push("                topologyKey: kubernetes.io/hostname");
  lines.push("      containers:");
  lines.push("        - name: app");
  lines.push("          # Pinned image tag — do not use :latest in prod");
  lines.push("          image: registry.example.com/baseline:v2.9.0");
  lines.push("          imagePullPolicy: IfNotPresent");
  lines.push("          ports:");
  lines.push("            - name: http");
  lines.push("              containerPort: 8080");
  lines.push("              protocol: TCP");
  lines.push("          # Liveness must be forgiving on cold starts");
  lines.push("          livenessProbe:");
  lines.push("            httpGet:");
  lines.push("              path: /healthz");
  lines.push("              port: http");
  lines.push("            initialDelaySeconds: 30");
  lines.push("            periodSeconds: 10");
  lines.push("          readinessProbe:");
  lines.push("            httpGet:");
  lines.push("              path: /readyz");
  lines.push("              port: http");
  lines.push("            initialDelaySeconds: 5");
  lines.push("            periodSeconds: 5");
  lines.push("          resources:");
  lines.push("            # Requests = guaranteed; limits = hard cap");
  lines.push("            requests:");
  lines.push("              cpu: 250m");
  lines.push("              memory: 256Mi");
  lines.push("            limits:");
  lines.push("              cpu: \"1\"");
  lines.push("              memory: 1Gi");
  lines.push("          env:");
  for (let i = 0; i < 30; i++) {
    const k = pick(rand, WORDS).toUpperCase() + "_" + ident(rand, 3).toUpperCase();
    const v = pick(rand, WORDS) + "-" + Math.floor(rand() * 1000);
    lines.push(`            # ${pick(rand, WORDS)} config`);
    lines.push(`            - name: ${k}`);
    lines.push(`              value: "${v}"`);
  }
  lines.push("      # Always pull the secret for the private registry");
  lines.push("      imagePullSecrets:");
  lines.push("        - name: registry-cred");
  lines.push("      terminationGracePeriodSeconds: 60");
  return lines.join("\n") + "\n";
}

// ---- comments-rich: docker-compose with merge key + anchors (~10 KB) -------
function dockerComposeYaml(): string {
  const rand = prng(0xD0CC);
  const lines: string[] = [];
  lines.push("# docker-compose.yml — baseline POC fixture");
  lines.push("# Uses YAML merge key (<<) and anchors to DRY up service definitions.");
  lines.push("# Do not edit by hand; regenerate with the corpus script.");
  lines.push("");
  lines.push("version: \"3.9\"");
  lines.push("");
  lines.push("# Shared defaults — every service merges this via <<: *default");
  lines.push("x-default: &default");
  lines.push("  # Base image pinned to a known-good digest-bearing tag");
  lines.push("  image: registry.example.com/base:v2.9.0");
  lines.push("  restart: unless-stopped");
  lines.push("  logging:");
  lines.push("    driver: json-file");
  lines.push("    options:");
  lines.push("      max-size: \"10m\"");
  lines.push("      max-file: \"5\"");
  lines.push("  # Common env for every container");
  lines.push("  environment: &common-env");
  lines.push("    TZ: UTC");
  lines.push("    LANG: en_US.UTF-8");
  lines.push("    LOG_LEVEL: info");
  lines.push("");
  lines.push("x-network: &net");
  lines.push("  networks:");
  lines.push("    - backend");
  lines.push("    - frontend");
  lines.push("");
  lines.push("services:");
  const services = [
    "api", "worker", "scheduler", "gateway", "cache", "queue",
    "indexer", "mailer", "webhook", "cron", "monitor", "proxy",
  ];
  for (const svc of services) {
    lines.push(`  ${svc}:`);
    lines.push(`    <<: [*default, *net]`);
    lines.push(`    # ${svc} — ${pick(rand, WORDS)} ${pick(rand, WORDS)} component`);
    lines.push(`    container_name: ${svc}-prod`);
    lines.push(`    hostname: ${svc}.internal`);
    const port = 3000 + Math.floor(rand() * 6000);
    lines.push(`    ports:`);
    lines.push(`      - "${port}:${port}"`);
    lines.push(`    environment:`);
    lines.push(`      <<: *common-env`);
    lines.push(`      SERVICE_NAME: ${svc}`);
    lines.push(`      PORT: "${port}"`);
    for (let i = 0; i < 6; i++) {
      const k = pick(rand, WORDS).toUpperCase() + "_" + ident(rand, 2).toUpperCase();
      lines.push(`      ${k}: "${pick(rand, WORDS)}-${Math.floor(rand() * 999)}"`);
    }
    lines.push(`    deploy:`);
    lines.push(`      replicas: ${1 + Math.floor(rand() * 5)}`);
    lines.push(`      resources:`);
    lines.push(`        limits:`);
    lines.push(`          cpus: "0.${5 + Math.floor(rand() * 9)}"`);
    lines.push(`          memory: ${128 * (1 + Math.floor(rand() * 8))}M`);
    lines.push(`    depends_on:`);
    lines.push(`      - ${pick(rand, services.filter((s) => s !== svc))}`);
    lines.push(`    healthcheck:`);
    lines.push(`      test: ["CMD", "curl", "-f", "http://localhost:${port}/health"]`);
    lines.push(`      interval: 30s`);
    lines.push(`      timeout: 5s`);
    lines.push(`      retries: 3`);
    lines.push("");
  }
  lines.push("networks:");
  lines.push("  backend:");
  lines.push("    driver: bridge");
  lines.push("  frontend:");
  lines.push("    driver: bridge");
  lines.push("");
  lines.push("volumes:");
  lines.push("  cache-data:");
  lines.push("  queue-data:");
  return lines.join("\n") + "\n";
}

// ---- comments-rich: github actions (~5 KB) ---------------------------------
function githubActionsYaml(): string {
  const lines: string[] = [];
  lines.push("# .github/workflows/ci.yml — baseline fixture");
  lines.push("# Represents a typical CI pipeline with matrix builds, caching, and artifacts.");
  lines.push("");
  lines.push("name: CI");
  lines.push("");
  lines.push("on:");
  lines.push("  push:");
  lines.push("    branches: [main, release/*]");
  lines.push("  pull_request:");
  lines.push("    branches: [main]");
  lines.push("  # Allow manual re-run from the Actions tab");
  lines.push("  workflow_dispatch:");
  lines.push("");
  lines.push("# Cancel older runs on the same ref to save minutes");
  lines.push("concurrency:");
  lines.push("  group: ${{ github.workflow }}-${{ github.ref }}");
  lines.push("  cancel-in-progress: true");
  lines.push("");
  lines.push("env:");
  lines.push("  NODE_VERSION: \"22\"");
  lines.push("  PNPM_VERSION: \"10\"");
  lines.push("  CI: \"true\"");
  lines.push("");
  lines.push("jobs:");
  const jobs = [
    "lint", "typecheck", "unit-test", "integration-test",
    "benchmark", "build", "e2e", "deploy-staging",
  ];
  for (const job of jobs) {
    lines.push(`  ${job}:`);
    lines.push(`    # ${job} — runs on the standard GitHub-hosted runner`);
    lines.push(`    runs-on: ubuntu-latest`);
    lines.push(`    timeout-minutes: ${10 + Math.floor(Math.random() * 20)}`);
    lines.push(`    steps:`);
    lines.push(`      - name: Checkout`);
    lines.push(`        uses: actions/checkout@v4`);
    lines.push(`        with:`);
    lines.push(`          fetch-depth: 0`);
    lines.push(`      - name: Setup Node`);
    lines.push(`        uses: actions/setup-node@v4`);
    lines.push(`        with:`);
    lines.push(`          node-version: \${{ env.NODE_VERSION }}`);
    lines.push(`          cache: pnpm`);
    lines.push(`      - name: Install dependencies`);
    lines.push(`        run: pnpm install --frozen-lockfile`);
    lines.push(`      - name: Run ${job}`);
    lines.push(`        run: pnpm run ${job}`);
    lines.push(`        env:`);
    lines.push(`          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}`);
    if (job === "benchmark") {
      lines.push(`      - name: Upload benchmark results`);
      lines.push(`        uses: actions/upload-artifact@v4`);
      lines.push(`        with:`);
      lines.push(`          name: benchmark-results`);
      lines.push(`          path: results/benchmarks/`);
    }
    if (job === "build") {
      lines.push(`      - name: Upload build artifact`);
      lines.push(`        uses: actions/upload-artifact@v4`);
      lines.push(`        with:`);
      lines.push(`          name: dist`);
      lines.push(`          path: dist/`);
    }
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

// ---- multidoc-k8s (~100 KB) ------------------------------------------------
function multidocK8sYaml(targetBytes: number): string {
  const rand = prng(0xD0C5);
  const parts: string[] = [];
  let size = 0;
  let i = 0;
  const kinds = ["Deployment", "Service", "ConfigMap", "Secret", "Ingress", "ServiceAccount"];
  while (size < targetBytes) {
    const kind = kinds[i % kinds.length];
    const name = pick(rand, WORDS) + "-" + ident(rand, 4);
    const ns = pick(rand, ["default", "production", "staging", "kube-system"]);
    const lines: string[] = [];
    if (i > 0) lines.push("---");
    lines.push(`# Document ${i}: ${kind} ${name}`);
    lines.push(`apiVersion: v1`);
    lines.push(`kind: ${kind}`);
    lines.push(`metadata:`);
    lines.push(`  name: ${name}`);
    lines.push(`  namespace: ${ns}`);
    lines.push(`  labels:`);
    lines.push(`    app: ${pick(rand, WORDS)}`);
    lines.push(`    version: "v${1 + Math.floor(rand() * 9)}.${Math.floor(rand() * 20)}"`);
    if (kind === "Deployment") {
      lines.push(`spec:`);
      lines.push(`  replicas: ${1 + Math.floor(rand() * 8)}`);
      lines.push(`  selector:`);
      lines.push(`    matchLabels:`);
      lines.push(`      app: ${name}`);
      lines.push(`  template:`);
      lines.push(`    spec:`);
      lines.push(`      containers:`);
      lines.push(`        - name: ${name}`);
      lines.push(`          image: registry.example.com/${name}:latest`);
      lines.push(`          ports:`);
      lines.push(`            - containerPort: ${1024 + Math.floor(rand() * 64000)}`);
    } else if (kind === "Service") {
      lines.push(`spec:`);
      lines.push(`  type: ClusterIP`);
      lines.push(`  selector:`);
      lines.push(`    app: ${name}`);
      lines.push(`  ports:`);
      lines.push(`    - port: ${80 + Math.floor(rand() * 1000)}`);
      lines.push(`      targetPort: ${3000 + Math.floor(rand() * 6000)}`);
    } else if (kind === "ConfigMap") {
      lines.push(`data:`);
      const n = 4 + Math.floor(rand() * 8);
      for (let k = 0; k < n; k++) {
        lines.push(`  ${pick(rand, WORDS)}_${ident(rand, 2)}: "${pick(rand, WORDS)} ${pick(rand, WORDS)}"`);
      }
    } else {
      lines.push(`data:`);
      lines.push(`  note: "placeholder ${i}"`);
    }
    const text = lines.join("\n");
    parts.push(text);
    size += text.length + 1;
    i++;
  }
  return parts.join("\n") + "\n";
}

// ---- large-block (~5 MB) ---------------------------------------------------
function largeBlockYaml(targetBytes: number): string {
  const rand = prng(0xB16);
  const out: string[] = [];
  let size = 0;
  let i = 0;
  while (size < targetBytes) {
    const sec = pick(rand, WORDS) + "_" + i;
    out.push(`${sec}:`);
    const fields = 10 + Math.floor(rand() * 16);
    for (let f = 0; f < fields; f++) {
      const k = pick(rand, WORDS) + "_" + ident(rand, 3);
      const v = rand() > 0.5 ? String(Math.floor(rand() * 100000)) : pick(rand, WORDS) + "-" + ident(rand, 4);
      out.push(`  ${k}: ${v}`);
    }
    out.push(`  items:`);
    const items = 3 + Math.floor(rand() * 6);
    for (let j = 0; j < items; j++) {
      out.push(`    - id: ${Math.floor(rand() * 1000000)}`);
      out.push(`      name: ${ident(rand, 6)}`);
      out.push(`      active: ${rand() > 0.3}`);
      out.push(`      score: ${+(rand() * 1000).toFixed(3)}`);
    }
    out.push("");
    size = out.reduce((a, l) => a + l.length + 1, 0);
    i++;
  }
  return out.join("\n") + "\n";
}

// ---- main ------------------------------------------------------------------
function main(): void {
  console.log("Generating POC baseline corpus into", OUT);
  mkdirSync(OUT, { recursive: true });

  write("json-records-small.yaml", jsonRecordsYaml(10 * 1024));
  write("json-records-medium.yaml", jsonRecordsYaml(200 * 1024));
  write("json-records-large.yaml", jsonRecordsYaml(2 * 1024 * 1024));
  write("block-config.yaml", blockConfigYaml(50 * 1024));
  write("comments-k8s-deployment.yaml", k8sDeploymentYaml());
  write("comments-docker-compose.yaml", dockerComposeYaml());
  write("comments-github-actions.yaml", githubActionsYaml());
  write("multidoc-k8s.yaml", multidocK8sYaml(100 * 1024));
  write("large-block.yaml", largeBlockYaml(5 * 1024 * 1024));
}

main();
