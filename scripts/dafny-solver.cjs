'use strict';

const { accessSync, constants, realpathSync } = require('node:fs');
const { delimiter, isAbsolute, join, resolve } = require('node:path');

function resolveZ3Path(override = process.env.DAFNY_Z3, pathValue = process.env.PATH ?? '') {
  const requested = override || 'z3';
  if (isAbsolute(requested) || requested.includes('/') || requested.includes('\\')) {
    return realpathSync(resolve(requested));
  }

  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')
    : [''];
  for (const directory of pathValue.split(delimiter)) {
    for (const extension of extensions) {
      const candidate = resolve(join(directory || process.cwd(), `${requested}${extension}`));
      try {
        accessSync(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
        return realpathSync(candidate);
      } catch {
        // Try the next PATH directory or platform executable suffix.
      }
    }
  }
  throw new Error(`Z3 executable '${requested}' was not found on PATH`);
}

function proverPathArgument(z3Path) {
  if (!isAbsolute(z3Path)) throw new Error('Dafny PROVER_PATH must be an absolute Z3 executable path');
  return `/proverOpt:PROVER_PATH=${z3Path}`;
}

module.exports = { resolveZ3Path, proverPathArgument };
