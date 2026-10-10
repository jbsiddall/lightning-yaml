#!/usr/bin/env node
import { readFile, mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadTypeScript, loadGraph, resolveFunction, resolveExport } from './source.mjs';
import { makeTranslator, contractInputs, domainAssumptions, inputEnvironment, symbolDeclarations, registerSymbol } from './symbolic.mjs';
import { check, query } from './solver.mjs';

const args = process.argv.slice(2);
function options(argv) {
  const out = { config: null, z3: 'z3', typescript: null, outDir: null, timeout: 5000 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--z3') out.z3 = argv[++i];
    else if (argv[i] === '--typescript') out.typescript = argv[++i];
    else if (argv[i] === '--out') out.outDir = argv[++i];
    else if (argv[i] === '--timeout-ms') out.timeout = Number(argv[++i]);
    else if (!out.config) out.config = argv[i];
    else throw new Error(`unexpected argument ${argv[i]}`);
  }
  if (!out.config || !Number.isSafeInteger(out.timeout) || out.timeout <= 0) throw new Error('usage: node verify.mjs <contracts.json> [--z3 path] [--typescript module] [--out dir] [--timeout-ms ms]');
  return out;
}

async function main() {
  const cli = options(args), configPath = path.resolve(cli.config), configDir = path.dirname(configPath);
  const contracts = JSON.parse(await readFile(configPath, 'utf8'));
  const root = path.resolve(configDir, contracts.exampleRoot ?? '.');
  const ts = await loadTypeScript(cli.typescript);
  const obligations = [], claimReports = [];
  const addObligation = (assumptions, bad, kind) => obligations.push({ assumptions: [...assumptions], bad, kind });
  const validatedModules = new Set();
  const discoveredLoops = new Set();
  let validationIndex = 0;
  for (const claim of contracts.claims ?? []) {
    const entryFile = path.resolve(root, claim.file);
    const graph = await loadGraph(entryFile, root, ts);
    for (const module of graph.modules) for (const [name, fn] of module.functions) {
      let ordinal = 0;
      const visit = node => {
        if (ts.isWhileStatement(node)) discoveredLoops.add(`${name}:${ordinal++}`);
        ts.forEachChild(node, visit);
      };
      visit(fn);
    }
    const entry = resolveExport(graph.entry, claim.export);
    if (entry.fn.parameters.length !== claim.params.length) throw new Error(`parameter contract mismatch for ${claim.name}`);
    for (let i = 0; i < claim.params.length; i++) if (claim.params[i].name !== entry.fn.parameters[i].name.text) throw new Error(`parameter name mismatch for ${claim.name} at position ${i + 1}`);
    const translator = makeTranslator(graph, ts, contracts, addObligation);
    for (const module of graph.modules) if (!validatedModules.has(module.path)) {
      validatedModules.add(module.path);
      for (const [name, fn] of module.functions) {
        const target = { module, fn, name };
        const claimedParams = target.module === entry.module && target.fn === entry.fn ? claim.params : null;
        const symbolicArgs = fn.parameters.map((p, i) => {
          if (p.type) throw new Error('TypeScript annotations are unsupported in JavaScript source mode');
          const sort = claimedParams?.[i]?.type === 'boolean' ? 'Bool' : 'Int';
          const value = `validation_${validationIndex}_${i}`; registerSymbol(value, sort); return { value, sort };
        });
        validationIndex++;
        translator.runFunction(target, symbolicArgs, symbolicArgs.filter(x => x.sort === 'Int').map(x => `(and (<= -9007199254740991 ${x.value}) (<= ${x.value} 9007199254740991))`));
      }
    }
    const inputs = contractInputs(ts, claim);
    const initial = domainAssumptions(claim, inputs);
    const paramState = inputEnvironment(ts, entry, claim, inputs);
    paramState.path = [...initial];
    if (claim.requires) initial.push(translator.contractExpr(claim.requires, paramState, 'Bool'));
    let concrete = null;
    if (claim.args) {
      if (claim.args.length !== inputs.length) throw new Error(`concrete arity mismatch for ${claim.name}`);
      for (let i = 0; i < inputs.length; i++) {
        const n = claim.args[i];
        if (inputs[i].sort === 'Int' && (!Number.isSafeInteger(n) || typeof n !== 'number')) throw new Error(`invalid concrete integer argument for ${claim.name}`);
        if (inputs[i].sort === 'Bool' && typeof n !== 'boolean') throw new Error(`invalid concrete Boolean argument for ${claim.name}`);
        initial.push(`(= ${inputs[i].value} ${typeof n === 'boolean' ? n : n})`);
      }
      concrete = claim.args;
    }
    addObligation(initial, 'true', `admissibility:${claim.name}`);
    const returned = translator.runFunction(entry, inputs, initial);
    if (claim.expected !== undefined) {
      if (!(typeof claim.expected === 'boolean' || Number.isSafeInteger(claim.expected))) throw new Error(`expected result must be a Boolean or safe integer for ${claim.name}`);
      if (returned[0].sort !== (typeof claim.expected === 'boolean' ? 'Bool' : 'Int')) throw new Error(`expected result sort mismatch for ${claim.name}`);
      for (const c of returned[0].cases) addObligation(c.path, `(not (= ${c.value} ${claim.expected}))`, `claim:${claim.name}`);
    }
    if (claim.ensures) {
      for (const c of returned[0].cases) {
        const post = inputEnvironment(ts, entry, claim, inputs);
        post.path = c.path; post.values.set('result', { value: c.value, sort: returned[0].sort });
        addObligation(c.path, `(not ${translator.contractExpr(claim.ensures, post, 'Bool')})`, `claim:${claim.name}`);
      }
    }
    if (claim.equivalentTo) {
      const other = resolveExport(graph.entry, claim.equivalentTo);
      const second = translator.runFunction(other, inputs, initial);
      if (returned[0].sort !== second[0].sort) throw new Error(`equivalence result sort mismatch for ${claim.name}`);
      addObligation(initial, `(not (= ${returned[0].value} ${second[0].value}))`, `equivalence:${claim.name}`);
    }
    if (claim.expected === undefined && !claim.ensures && !claim.equivalentTo) throw new Error(`claim ${claim.name} needs expected, ensures, or equivalentTo`);
    claimReports.push({ name: claim.name, file: entry.module.path, export: claim.export, concrete, equivalentTo: claim.equivalentTo ?? null, admissibility: { params: claim.params, numberDomain: '[-9007199254740991, 9007199254740991]', booleanDomain: 'true | false', requires: claim.requires ?? null }, dependencies: graph.modules.map(m => ({ file: m.path, sha256: m.hash })) });
  }
  for (const annotation of Object.keys(contracts.loops ?? {})) if (!discoveredLoops.has(annotation)) throw new Error(`unused loop annotation ${annotation}`);
  const symbols = symbolDeclarations();
  const outputDir = cli.outDir ? path.resolve(cli.outDir) : await mkdtemp(path.join(os.tmpdir(), 'js-z3-'));
  await mkdir(outputDir, { recursive: true });
  const reports = [];
  for (let i = 0; i < obligations.length; i++) {
    const item = obligations[i];
    const smt = `${symbols}\n${query(item.assumptions, item.bad)}`;
    await writeFile(path.join(outputDir, `${String(i).padStart(4, '0')}.smt2`), smt);
    const result = await check(cli.z3, smt, cli.timeout);
    let status = result.status;
    if (item.kind.startsWith('admissibility:')) status = result.status === 'refuted' ? 'satisfiable' : result.status === 'proved' ? 'vacuous' : result.status;
    if (item.kind.startsWith('declare:')) status = 'proved';
    reports.push({
      obligation: item.kind, status,
      witness: item.kind.startsWith('admissibility:') && result.status === 'refuted' ? result.stdout : undefined,
      counterexample: result.status === 'refuted' && !item.kind.startsWith('admissibility:') ? result.stdout : undefined,
      counterexampleKind: result.status === 'refuted' && item.kind.startsWith('loop-') ? 'abstract loop-header model; not a concrete source input' : undefined,
      diagnostic: ['proved', 'refuted'].includes(result.status) ? undefined : { stdout: result.stdout, stderr: result.stderr, error: result.error },
    });
  }
  const failed = reports.some(x => !['proved', 'satisfiable'].includes(x.status));
  for (const c of claimReports) c.status = failed ? 'failed' : 'proved';
  const result = {
    status: failed ? 'failed' : 'proved',
    profile: { numbers: 'JavaScript safe integers only', booleans: 'true or false', numericEquality: 'SMT integer equality matches JavaScript === for this subset; signed zero is collapsed, so this is not full contextual equivalence', intrinsic: 'Number.isSafeInteger is assumed to be the pristine global intrinsic' },
    claims: claimReports, obligations: reports, outputDir,
  };
  await writeFile(path.join(outputDir, 'report.json'), JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = failed ? reports.some(x => ['error', 'unknown', 'timeout', 'malformed'].includes(x.status)) ? 2 : 1 : 0;
}

main().catch(error => {
  const report = { status: 'error', claims: [], obligations: [], diagnostic: error.message };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 2;
});
