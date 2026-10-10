import { resolveFunction } from './source.mjs';

export const MAX = 9007199254740991n;
const MIN = -MAX;
const safe = x => `(and (<= ${MIN} ${x}) (<= ${x} ${MAX}))`;
let fresh = 0;
const symbols = new Map();
export function symbolDeclarations() { return [...symbols].map(([name, sort]) => `(declare-const ${name} ${sort === 'Bool' ? 'Bool' : 'Int'})`).join('\n'); }
export function registerSymbol(name, sort) { symbols.set(name, sort); }
const id = prefix => `${prefix.replace(/[^A-Za-z0-9_]/g, '_')}_${fresh++}`;
const and = xs => xs.length ? xs.length === 1 ? xs[0] : `(and ${xs.join(' ')})` : 'true';
const not = x => `(not ${x})`;

function cloneState(s) { return { scopes: s.scopes.map(x => new Map(x)), values: new Map(s.values), path: [...s.path] }; }
function lookup(state, name) {
  for (let i = state.scopes.length - 1; i >= 0; i--) if (state.scopes[i].has(name)) return state.scopes[i].get(name);
  throw new Error(`unbound identifier ${name}`);
}

export function makeTranslator(graph, ts, contracts, addObligation) {
  const callStack = [];

  function expr(node, state, module) {
    if (ts.isParenthesizedExpression(node)) return expr(node.expression, state, module);
    if (ts.isNumericLiteral(node)) {
      const n = BigInt(node.text.replaceAll('_', ''));
      if (n < MIN || n > MAX) throw new Error(`unsafe numeric literal ${node.text}`);
      return { value: n.toString(), sort: 'Int' };
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return { value: node.kind === ts.SyntaxKind.TrueKeyword ? 'true' : 'false', sort: 'Bool' };
    if (ts.isIdentifier(node)) {
      if (node.text === 'Number') throw new Error('Number is only allowed for pristine Number.isSafeInteger');
      if (module.constants.has(node.text) && !hasBinding(state, node.text)) return expr(module.constants.get(node.text), state, module);
      const binding = lookup(state, node.text), value = state.values.get(binding);
      if (!value) throw new Error(`read before initialization: ${node.text}`);
      return value;
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
      const a = expr(node.operand, state, module); expect(a, 'Bool', '!'); return { value: not(a.value), sort: 'Bool' };
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
      const n = BigInt(node.operand.text.replaceAll('_', ''));
      if (n > MAX) throw new Error(`unsafe numeric literal ${node.getText()}`);
      return { value: `(- ${n})`, sort: 'Int' };
    }
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText() === 'Number' && node.expression.name.text === 'isSafeInteger') {
        if (hasBinding(state, 'Number') || module.bindings.has('Number')) throw new Error('Number.isSafeInteger is unavailable when Number is shadowed');
        if (node.arguments.length !== 1) throw new Error('Number.isSafeInteger takes one argument');
        const a = expr(node.arguments[0], state, module); expect(a, 'Int', 'Number.isSafeInteger');
        return { value: 'true', sort: 'Bool' };
      }
      if (!ts.isIdentifier(node.expression)) throw new Error(`unsupported call ${node.getText()}`);
      if (hasBinding(state, node.expression.text) || module.constants.has(node.expression.text)) throw new Error(`calling a local value is unsupported: ${node.expression.text}`);
      const target = resolveFunction(module, node.expression.text);
      if (hasLoop(ts, target.fn)) throw new Error(`calls to loop-containing function ${target.name} are unsupported; verify it as an entry target`);
      if (callStack.includes(target.fn)) throw new Error(`recursive call to ${target.name}`);
      const args = node.arguments.map(a => expr(a, state, module));
      const params = target.fn.parameters;
      if (args.length !== params.length) throw new Error(`wrong arity for ${target.name}`);
      for (let i = 0; i < args.length; i++) {
        if (params[i].type) throw new Error('TypeScript annotations are unsupported in JavaScript source mode');
        const sort = args[i].sort;
        expect(args[i], sort, `argument ${i + 1} to ${target.name}`);
        if (sort === 'Int') addObligation(state.path, not(safe(args[i].value)), `call-domain:${target.name}:${i}`);
      }
      callStack.push(target.fn);
      const result = runFunction(target, args, state.path, module);
      callStack.pop();
      if (result.length !== 1) throw new Error(`call to ${target.name} has path-dependent return; unsupported in expression`);
      state.path.push(...(result[0].pathExtra ?? []));
      return result[0];
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      const a = expr(node.left, state, module);
      if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
        expect(a, 'Bool', 'logical operator');
        const oldPath = state.path;
        state.path = [...oldPath, op === ts.SyntaxKind.AmpersandAmpersandToken ? a.value : not(a.value)];
        const b = expr(node.right, state, module); expect(b, 'Bool', 'logical operator');
        state.path = oldPath;
        return { value: op === ts.SyntaxKind.AmpersandAmpersandToken ? `(and ${a.value} ${b.value})` : `(or ${a.value} ${b.value})`, sort: 'Bool' };
      }
      const b = expr(node.right, state, module);
      if ([ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken].includes(op)) {
        expect(a, 'Int', 'arithmetic'); expect(b, 'Int', 'arithmetic');
        if (op === ts.SyntaxKind.AsteriskToken) {
          const rightLiteral = ts.isNumericLiteral(node.right), leftLiteral = ts.isNumericLiteral(node.left);
          if (!rightLiteral && !leftLiteral) throw new Error('multiplication requires an integer literal operand');
        }
        const value = `(${op === ts.SyntaxKind.PlusToken ? '+' : op === ts.SyntaxKind.MinusToken ? '-' : '*'} ${a.value} ${b.value})`;
        addObligation(state.path, not(safe(value)), `arithmetic-safe:${node.getText()}`);
        return { value, sort: 'Int' };
      }
      if ([ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken].includes(op)) {
        expect(a, 'Int', 'comparison'); expect(b, 'Int', 'comparison');
        const smt = ({ [ts.SyntaxKind.LessThanToken]: '<', [ts.SyntaxKind.LessThanEqualsToken]: '<=', [ts.SyntaxKind.GreaterThanToken]: '>', [ts.SyntaxKind.GreaterThanEqualsToken]: '>=' })[op];
        return { value: `(${smt} ${a.value} ${b.value})`, sort: 'Bool' };
      }
      if ([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(op)) {
        if (a.sort !== b.sort) throw new Error('strict equality requires operands with same sort');
        const eq = `(= ${a.value} ${b.value})`;
        return { value: op === ts.SyntaxKind.EqualsEqualsEqualsToken ? eq : not(eq), sort: 'Bool' };
      }
    }
    throw new Error(`unsupported expression: ${node.getText()}`);
  }
  function expect(value, sort, where) { if (value.sort !== sort) throw new Error(`${where} requires ${sort}, got ${value.sort}`); }

  function runFunction(target, args, assumptions) {
    const { module, fn } = target;
    const state = { scopes: [new Map()], values: new Map(), path: [...assumptions] };
    if (!fn.body) throw new Error(`function ${target.name} must have a body`);
    fn.parameters.forEach((p, i) => {
      if (!ts.isIdentifier(p.name) || p.initializer || p.dotDotDotToken || p.questionToken) throw new Error('parameters must be required identifiers');
      if (p.type) throw new Error('TypeScript annotations are unsupported in JavaScript source mode');
      if (p.name.text === 'Number' || module.bindings.has('Number')) throw new Error('shadowing Number is unsupported');
      const key = id(`${target.name}_${p.name.text}`); state.scopes[0].set(p.name.text, key);
      const sort = args[i].sort;
      if (sort === 'Int') addObligation(state.path, not(safe(args[i].value)), `input-safe:${p.name.text}`);
      state.values.set(key, { value: args[i].value, sort });
    });
    target._loopSeen = false;
    state.scopes.push(new Map());
    prepareScope(state, fn.body.statements, true);
    const outputs = statements(fn.body.statements, [state], module, target);
    if (outputs.some(x => !x.returned)) throw new Error(`function ${target.name} has a path that falls through`);
    if (!outputs.length) throw new Error(`function ${target.name} has no return`);
    const sort = outputs[0].result.sort;
    if (outputs.some(x => x.result.sort !== sort)) throw new Error(`function ${target.name} returns inconsistent sorts`);
    let value = outputs.at(-1).result.value;
    for (let i = outputs.length - 2; i >= 0; i--) value = `(ite ${and(outputs[i].path)} ${outputs[i].result.value} ${value})`;
    const pathExtra = outputs.length === 1 ? outputs[0].path.slice(assumptions.length) : [];
    const cases = outputs.map(x => ({ value: x.result.value, path: x.path }));
    return [{ value, sort, pathExtra, cases }];
  }

  function statements(nodes, states, module, target) {
    let current = states;
    for (const node of nodes) {
      const next = [];
      for (const state of current) {
        if (state.returned) { next.push(state); continue; }
        if (ts.isBlock(node)) {
          const nested = cloneState(state); nested.scopes.push(new Map());
          prepareScope(nested, node.statements);
          const result = statements(node.statements, [nested], module, target);
          for (const r of result) { r.scopes.pop(); next.push(r); }
        } else if (ts.isVariableStatement(node)) {
          const isConst = Boolean(node.declarationList.flags & ts.NodeFlags.Const);
          for (const d of node.declarationList.declarations) {
            if (!ts.isIdentifier(d.name) || !d.initializer || d.type) throw new Error('locals require initialized unannotated identifiers');
            const name = d.name.text, key = state.scopes.at(-1).get(name);
            if (name === 'Number') throw new Error('shadowing Number is unsupported');
            if (!key || state.values.has(key)) throw new Error(`duplicate lexical declaration ${name}`);
            const v = expr(d.initializer, state, module); state.values.set(key, { ...v, mutable: !isConst });
          }
          next.push(state);
        } else if (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression) && node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.expression.left)) {
          const name = node.expression.left.text, key = lookup(state, name), old = state.values.get(key);
          if (!old) throw new Error(`assignment before initialization: ${name}`);
          if (!old.mutable) throw new Error(`assignment to const ${name}`);
          const v = expr(node.expression.right, state, module); expect(v, old.sort, `assignment to ${name}`); state.values.set(key, { ...v, mutable: old.mutable }); next.push(state);
        } else if (ts.isIfStatement(node)) {
          const cond = expr(node.expression, state, module); expect(cond, 'Bool', 'if condition');
          const yes = cloneState(state), no = cloneState(state); yes.path.push(cond.value); no.path.push(not(cond.value));
          next.push(...statements([node.thenStatement], [yes], module, target));
          if (node.elseStatement) next.push(...statements([node.elseStatement], [no], module, target)); else next.push(no);
        } else if (ts.isReturnStatement(node) && node.expression) {
          const v = expr(node.expression, state, module); state.returned = true; state.result = v; next.push(state);
        } else if (ts.isWhileStatement(node)) {
          const annotation = contracts.loops?.[`${target.name}:0`];
          if (!annotation) throw new Error(`missing loop annotation ${target.name}:0`);
          if (target._loopSeen) throw new Error('only one loop per function is supported');
          target._loopSeen = true;
          const modified = modifiedNames(ts, node);
          const entryInv = contractExpr(annotation.invariant, state, 'Bool');
          addObligation(state.path, not(entryInv), `loop-init:${target.name}`);
          const head = cloneState(state);
          for (const name of modified) {
            const key = lookup(head, name), old = head.values.get(key), sym = id(`havoc_${name}`);
            registerSymbol(sym, old.sort);
            head.values.set(key, { value: sym, sort: old.sort, mutable: old.mutable });
            if (old.sort === 'Int') head.path.push(safe(sym));
          }
          const inv = contractExpr(annotation.invariant, head, 'Bool'); head.path.push(inv);
          const decBefore = contractExpr(annotation.decreases, head, 'Int');
          addObligation(head.path, `(< ${decBefore} 0)`, `loop-decreases-nonnegative:${target.name}`);
          const condition = expr(node.expression, head, module); expect(condition, 'Bool', 'while condition');
          const body = cloneState(head); body.path.push(condition.value);
          const bodyOut = statements([node.statement], [body], module, target);
          for (const b of bodyOut) {
            if (b.returned) throw new Error('return from loop body is unsupported');
            const invAfter = contractExpr(annotation.invariant, b, 'Bool');
            addObligation(b.path, not(invAfter), `loop-preservation:${target.name}`);
            const decAfter = contractExpr(annotation.decreases, b, 'Int');
            addObligation(b.path, `(not (< ${decAfter} ${decBefore}))`, `loop-decreases:${target.name}`);
          }
          const exit = cloneState(head); exit.path.push(not(condition.value));
          state.values = exit.values; state.path = exit.path; next.push(state);
        } else throw new Error(`unsupported statement: ${node.getText()}`);
      }
      current = next;
    }
    return current;
  }

  function contractExpr(spec, state, expected) {
    const go = x => {
      if (Object.hasOwn(x, 'const')) {
        if (typeof x.const === 'boolean') return { value: String(x.const), sort: 'Bool' };
        if (!Number.isSafeInteger(x.const)) throw new Error('contract constants must be safe integer literals');
        return { value: String(x.const), sort: 'Int' };
      }
      if (Object.hasOwn(x, 'var')) { const v = state.values.get(lookup(state, x.var)); if (!v) throw new Error(`contract reads uninitialized ${x.var}`); return v; }
      const ops = { add: ['+', 'Int', 'Int'], sub: ['-', 'Int', 'Int'], mul: ['*', 'Int', 'Int'], eq: ['=', null, 'Bool'], ne: ['distinct', null, 'Bool'], lt: ['<', 'Int', 'Bool'], le: ['<=', 'Int', 'Bool'], gt: ['>', 'Int', 'Bool'], ge: ['>=', 'Int', 'Bool'], and: ['and', 'Bool', 'Bool'], or: ['or', 'Bool', 'Bool'] };
      if (x.op === 'not') { const a = go(x.args[0]); expect(a, 'Bool', 'contract not'); return { value: not(a.value), sort: 'Bool' }; }
      const desc = ops[x.op]; if (!desc || !Array.isArray(x.args)) throw new Error(`unsupported contract operator ${x.op}`);
      const [smt, operandSort, resultSort] = desc; const args = x.args.map(go);
      if (['and', 'or'].includes(x.op)) {
        if (args.length < 2) throw new Error(`operator ${x.op} needs at least two arguments`);
        args.forEach(a => expect(a, 'Bool', `contract ${x.op}`));
        return { value: `(${smt} ${args.map(a => a.value).join(' ')})`, sort: 'Bool' };
      }
      if (args.length !== 2) throw new Error(`operator ${x.op} needs two arguments`);
      if (operandSort) args.forEach(a => expect(a, operandSort, `contract ${x.op}`));
      if (x.op === 'eq' || x.op === 'ne') { if (args[0].sort !== args[1].sort) throw new Error('contract equality sort mismatch'); }
      return { value: `(${smt} ${args[0].value} ${args[1].value})`, sort: resultSort };
    };
    const result = go(spec); expect(result, expected, 'contract expression'); return result.value;
  }

  return { runFunction, contractExpr, expr };
}

function modifiedNames(ts, node) {
  const names = new Set();
  const visit = (n, locals) => {
    if (ts.isBlock(n)) {
      const nested = new Set(locals);
      for (const statement of n.statements) if (ts.isVariableStatement(statement)) for (const d of statement.declarationList.declarations) if (ts.isIdentifier(d.name)) nested.add(d.name.text);
      for (const child of n.statements) visit(child, nested);
      return;
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left) && !locals.has(n.left.text)) names.add(n.left.text);
    ts.forEachChild(n, child => visit(child, locals));
  };
  visit(node, new Set()); return names;
}

function hasLoop(ts, node) {
  let found = false;
  const visit = child => { if (ts.isWhileStatement(child)) found = true; ts.forEachChild(child, visit); };
  visit(node); return found;
}

function prepareScope(state, nodes, rejectOuter = false) {
  for (const node of nodes) if (node.declarationList) {
    for (const decl of node.declarationList.declarations) {
      if (!decl.name || !decl.name.text) continue;
      const name = decl.name.text;
      if (state.scopes.at(-1).has(name) || rejectOuter && state.scopes.at(-2).has(name)) throw new Error(`duplicate lexical declaration ${name}`);
      state.scopes.at(-1).set(name, id(`${name}_local`));
    }
  }
}

function hasBinding(state, name) { return state.scopes.some(scope => scope.has(name)); }

export function contractInputs(ts, claim) {
  return (claim.params ?? []).map(p => {
    const sort = p.type === 'boolean' ? 'Bool' : p.type === 'number' ? 'Int' : (() => { throw new Error(`unsupported input type ${p.type}`); })();
    const value = id(`arg_${p.name}`); registerSymbol(value, sort); return { value, sort };
  });
}

export function domainAssumptions(claim, inputs) {
  return inputs.flatMap((x, i) => x.sort === 'Int' ? [safe(x.value)] : []).concat(claim.requires ? [] : []);
}

export function inputEnvironment(ts, resolved, claim, inputs) {
  const fn = resolved.fn;
  const state = { scopes: [new Map()], values: new Map(), path: [] };
  fn.parameters.forEach((p, i) => { const key = p.name.text; state.scopes[0].set(key, key); state.values.set(key, inputs[i]); });
  state.scopes[0].set('result', 'result');
  return state;
}
