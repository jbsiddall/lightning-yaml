// A narrow example of the kind of AST pass a Babel plugin could implement.
// Valid only for these verified, in-bounds UTF-16 accesses, with the original
// bignumber.js constructor. It is not a general BigNumber optimization.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const tooling = process.argv[2];
if (!tooling) throw Error('Usage: node postprocess.cjs /path/to/node_modules');
const ts = require(path.join(tooling, 'typescript'));
const esbuild = require(path.join(tooling, 'esbuild'));
const filename = path.join(__dirname, 'Shapes.js');
const source = fs.readFileSync(filename, 'utf8');
const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let replacements = 0;
const unparen = node => {
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
};
const transformed = ts.transform(parsed, [context => {
  let approved = false;
  const visitor = node => {
    if (ts.isMethodDeclaration(node)) {
      const before = approved;
      approved = ['FlowPlainLine', 'QuoteEnd'].includes(node.name.getText(parsed));
      const result = ts.visitEachChild(node, visitor, context);
      approved = before;
      return result;
    }
    if (approved && ts.isCallExpression(node) && node.arguments.length === 0) {
      const outer = unparen(node.expression);
      if (ts.isPropertyAccessExpression(outer) && outer.name.text === 'toNumber') {
        const ctor = unparen(outer.expression);
        if (ts.isNewExpression(ctor) && ts.isIdentifier(ctor.expression) &&
            ctor.expression.text === 'BigNumber' && ctor.arguments?.length === 1) {
          const inner = unparen(ctor.arguments[0]);
          if (ts.isCallExpression(inner) && inner.arguments.length === 1 &&
              ts.isNumericLiteral(inner.arguments[0]) && inner.arguments[0].text === '0') {
            const member = unparen(inner.expression);
            if (ts.isPropertyAccessExpression(member) && member.name.text === 'charCodeAt') {
              const access = unparen(member.expression);
              if (ts.isElementAccessExpression(access)) {
                replacements++;
                return context.factory.createCallExpression(
                  context.factory.createPropertyAccessExpression(access.expression, 'charCodeAt'),
                  undefined, [access.argumentExpression]);
              }
            }
          }
        }
      }
    }
    return ts.visitEachChild(node, visitor, context);
  };
  return root => ts.visitNode(root, visitor);
}]);
assert.equal(replacements, 4, 'Compiler output changed; review the transformation');
const rewritten = ts.createPrinter().printFile(transformed.transformed[0]);
transformed.dispose();
const suffix = '\nmodule.exports = Shapes.__default;\n';
const outputs = {
  'Shapes.rewritten.js': rewritten + suffix,
  'Shapes.min.js': esbuild.transformSync(source + suffix, {
    loader: 'js', minify: true, target: 'es2022', legalComments: 'inline'
  }).code,
  'Shapes.rewritten.min.js': esbuild.transformSync(rewritten + suffix, {
    loader: 'js', minify: true, target: 'es2022', legalComments: 'inline'
  }).code,
};
for (const [name, code] of Object.entries(outputs)) fs.writeFileSync(path.join(__dirname, name), code);
console.log(JSON.stringify({tool: 'TypeScript AST + esbuild',
  typescript: ts.version, esbuild: esbuild.version, replacements,
  bytes: {original: Buffer.byteLength(source),
    ...Object.fromEntries(Object.entries(outputs).map(([name, code]) => [name, Buffer.byteLength(code)]))}}));
