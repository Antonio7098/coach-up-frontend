#!/usr/bin/env node
/*
  Ensures lightningcss resolves to the WASM bundle by creating a shim at
  node_modules/lightningcss/pkg/index.js that re-exports lightningcss-wasm.
  Safe to run multiple times.
*/
const fs = require('fs');
const path = require('path');

const pkgDir = path.join(process.cwd(), 'node_modules', 'lightningcss', 'pkg');
const shimFile = path.join(pkgDir, 'index.js');

try {
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    shimFile,
    "module.exports = require('lightningcss-wasm');\n",
    'utf8'
  );
  console.log('[postinstall] lightningcss WASM shim created at', shimFile);
} catch (err) {
  console.warn('[postinstall] Failed to create lightningcss WASM shim:', err?.message || err);
  process.exitCode = 0; // do not fail installs
}
