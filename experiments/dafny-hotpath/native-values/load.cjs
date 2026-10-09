'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { NativeValues } = require('./dist/runtime.js');
const { createNativeApi } = require('./dist/api.js');

function loadKernel() {
  const filename = path.join(__dirname, 'generated.js');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(fs.readFileSync(filename, 'utf8') +
    '\nmodule.exports = NativeValues.__default;\n', filename);
  Object.defineProperties(loaded.exports, Object.getOwnPropertyDescriptors(NativeValues));
  return loaded.exports;
}

function loadNativeApi() { return createNativeApi(loadKernel()); }
module.exports = { loadKernel, loadNativeApi };
