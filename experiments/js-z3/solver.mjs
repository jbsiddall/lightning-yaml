import { spawn } from 'node:child_process';

export async function check(z3, smt, timeoutMs) {
  const run = (input, expectModel = false) => new Promise(resolve => {
    let stdout = '', stderr = '', settled = false;
    const child = spawn(z3, ['-in', '-smt2'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const finish = result => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    child.stdout.setEncoding('utf8').on('data', x => stdout += x);
    child.stderr.setEncoding('utf8').on('data', x => stderr += x);
    child.on('error', error => finish({ status: 'error', error: error.message, stdout, stderr }));
    child.on('close', code => {
      const trimmed = stdout.trim();
      const hasError = /\(error\b/.test(trimmed) || /\(error\b/.test(stderr);
      const status = trimmed === 'unsat' ? 'proved' : trimmed === 'sat' || expectModel && validModelOutput(trimmed) ? 'refuted' : trimmed === 'unknown' ? 'unknown' : 'malformed';
      finish({ status: code !== 0 || hasError ? 'error' : status, code, stdout, stderr });
    });
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ status: 'timeout', stdout, stderr }); }, timeoutMs);
    child.stdin.end(input);
  });
  const initial = await run(smt);
  if (initial.status !== 'refuted') return initial;
  const model = await run(`${smt.replace(/\(check-sat\)\s*$/, '(check-sat)')}\n(get-model)\n`, true);
  if (model.status !== 'refuted' || !validModelOutput(model.stdout.trim())) return { ...model, status: model.status === 'refuted' ? 'malformed' : model.status === 'proved' ? 'malformed' : model.status };
  return model;
}

function validModelOutput(text) {
  if (!text.startsWith('sat')) return false;
  const rest = text.slice(3).trim();
  if (!rest.startsWith('(') || !rest.endsWith(')')) return false;
  let depth = 0;
  for (const char of rest) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

export function query(assumptions, bad) {
  const forms = [...assumptions, bad].map(x => `(assert ${x})`).join('\n');
  return `(set-option :produce-models true)\n(set-logic ALL)\n${forms}\n(check-sat)\n`;
}
