import { describe, expect, it } from 'vitest';
import { publishableMemoryRatios } from '../bench/browser/memory/publication.ts';

const rows = ['yaml-plain-small-records', 'yaml-rich-small', 'yaml-rich-medium'].map((workload) => ({ workload, values: { 'lightning-yaml': 1 } }));
const run = (runtime: string, method: 'peak-rss' | 'heap-delta') => ({
  suite: 'memory-ratios', scope: 'competition', method, unit: 'ratio', lower_is_better: true,
  schema_version: 1, generated: '2026-01-01', source: 'test', env: { runtime, cpu: 'unknown', clk: 'unknown' },
  iterations: 60, libraries: [], workloads: rows,
});

describe('browser memory publication', () => {
  it('removes the two small WebKit peak-RSS rows from every run without mutating the input', () => {
    const webkit = run('WebKit 26.0', 'peak-rss');
    const chromium = run('chromium 141', 'heap-delta');
    const output = publishableMemoryRatios([webkit, chromium, webkit]);
    expect(output[0].workloads.map((r) => r.workload)).toEqual(['yaml-rich-medium']);
    expect(output[2].workloads.map((r) => r.workload)).toEqual(['yaml-rich-medium']);
    expect(output[1].workloads).toEqual(rows);
    expect(webkit.workloads).toEqual(rows);
  });
});
