import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export async function loadTypeScript(pathOverride) {
  const candidates = pathOverride ? [pathOverride] : ['typescript'];
  for (const candidate of candidates) {
    try { return require(candidate); } catch {}
  }
  throw new Error('TypeScript is required; install it or pass --typescript <module path>');
}

export async function loadGraph(entryPath, root, ts) {
  const rootReal = await realpath(root);
  const modules = new Map();
  const visiting = new Set();
  async function visit(file) {
    const canonical = await realpath(file);
    if (!canonical.startsWith(`${rootReal}${path.sep}`) && canonical !== rootReal) throw new Error(`import escapes example root: ${file}`);
    if (!canonical.endsWith('.mjs')) throw new Error(`only .mjs source files are supported: ${canonical}`);
    if (visiting.has(canonical)) throw new Error(`import cycle at ${canonical}`);
    if (modules.has(canonical)) return modules.get(canonical);
    visiting.add(canonical);
    const text = await readFile(canonical, 'utf8');
    const source = ts.createSourceFile(canonical, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    if (source.parseDiagnostics.length) throw new Error(`syntax error in ${canonical}: ${source.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; ')}`);
    const mod = { path: canonical, text, hash: createHash('sha256').update(text).digest('hex'), source, functions: new Map(), constants: new Map(), imports: new Map(), exports: new Map(), bindings: new Set() };
    modules.set(canonical, mod);
    for (const stmt of source.statements) {
      if (ts.isImportDeclaration(stmt)) {
        if (!ts.isStringLiteral(stmt.moduleSpecifier) || !(stmt.moduleSpecifier.text.startsWith('./') || stmt.moduleSpecifier.text.startsWith('../')) || !stmt.moduleSpecifier.text.endsWith('.mjs') || !stmt.importClause?.namedBindings || stmt.importClause.name || !ts.isNamedImports(stmt.importClause.namedBindings) || stmt.importClause.isTypeOnly) throw new Error(`unsupported import in ${canonical}: ${stmt.getText(source)}`);
        const targetPath = path.resolve(path.dirname(canonical), stmt.moduleSpecifier.text);
        const target = await visit(targetPath);
        for (const el of stmt.importClause.namedBindings.elements) {
          if (el.isTypeOnly) throw new Error('type-only import unsupported');
          const imported = el.propertyName?.text ?? el.name.text;
          if (!target.exports.has(imported)) throw new Error(`missing export ${imported} from ${target.path}`);
          if (mod.bindings.has(el.name.text)) throw new Error(`duplicate binding ${el.name.text}`);
          mod.bindings.add(el.name.text);
          mod.imports.set(el.name.text, { module: target, name: imported });
        }
      } else if (ts.isFunctionDeclaration(stmt)) {
        if (!stmt.name || stmt.asteriskToken || stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword || m.kind === ts.SyntaxKind.AsyncKeyword)) throw new Error(`unsupported function declaration: ${stmt.getText(source)}`);
        if (mod.bindings.has(stmt.name.text)) throw new Error(`duplicate declaration ${stmt.name.text}`);
        const params = new Set();
        for (const parameter of stmt.parameters) {
          if (!ts.isIdentifier(parameter.name) || params.has(parameter.name.text)) throw new Error(`unsupported or duplicate parameter in ${stmt.name.text}`);
          params.add(parameter.name.text);
        }
        mod.bindings.add(stmt.name.text);
        mod.functions.set(stmt.name.text, stmt);
        if (stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) addExport(mod, stmt.name.text, stmt.name.text);
      } else if (ts.isVariableStatement(stmt)) {
        if (!(stmt.declarationList.flags & ts.NodeFlags.Const)) throw new Error('only inert const declarations are allowed at module scope');
        for (const decl of stmt.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name) || !decl.initializer || !(ts.isNumericLiteral(decl.initializer) || decl.initializer.kind === ts.SyntaxKind.TrueKeyword || decl.initializer.kind === ts.SyntaxKind.FalseKeyword)) throw new Error('module const must be an initialized numeric/Boolean literal');
          if (mod.bindings.has(decl.name.text)) throw new Error(`duplicate declaration ${decl.name.text}`);
          mod.bindings.add(decl.name.text);
          mod.constants.set(decl.name.text, decl.initializer);
        }
      } else if (ts.isExportDeclaration(stmt)) {
        if (stmt.moduleSpecifier || !stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) throw new Error('unsupported export declaration');
        for (const el of stmt.exportClause.elements) {
          const local = el.propertyName?.text ?? el.name.text;
          if (!mod.functions.has(local)) throw new Error(`unsupported exported binding ${local}`);
          addExport(mod, el.name.text, local);
        }
      } else if (stmt.kind !== ts.SyntaxKind.EmptyStatement) throw new Error(`unsupported top-level statement: ${stmt.getText(source)}`);
    }
    visiting.delete(canonical);
    return mod;
  }
  const entry = await visit(entryPath);
  return { entry, modules: [...modules.values()], ts };
}

function addExport(module, exported, local) {
  if (module.exports.has(exported)) throw new Error(`duplicate export ${exported}`);
  module.exports.set(exported, local);
}

export function resolveFunction(module, name) {
  const imported = module.imports.get(name);
  const target = imported?.module ?? module;
  const declarationName = imported ? target.exports.get(imported.name) : name;
  const actualName = declarationName ?? (imported ? imported.name : name);
  const fn = target.functions.get(actualName);
  if (!fn) throw new Error(`unknown function ${name} in ${module.path}`);
  return { module: target, fn, name: actualName };
}

export function resolveExport(module, exportedName) {
  const local = module.exports.get(exportedName);
  if (!local) throw new Error(`missing export ${exportedName} from ${module.path}`);
  const fn = module.functions.get(local);
  if (!fn) throw new Error(`export ${exportedName} is not a function`);
  return { module, fn, name: local };
}
