/**
 * Post-build script: rewrite bare relative imports in compiled JS output
 * so Node.js ESM can resolve them.
 *
 * - `from './config'`        → `from './config/index.js'`  (directory barrel)
 * - `from './middleware/auth'` → `from './middleware/auth.js'` (file)
 * - `from 'express'`         → unchanged (package import)
 * - `from './foo.js'`        → unchanged (already has extension)
 *
 * Usage: node fix-esm-imports.js [dist-dir]
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { globSync } from 'node:fs';

const distDir = resolve(process.argv[2] || './dist');
const staticImportRegex = /(from\s+['"])(\.\.?\/[^'"]+)(['"])/g;

function resolveImport(importPath, fromFile) {
  const dir = dirname(fromFile);
  const absPath = resolve(dir, importPath);

  // Already has an extension — leave it
  if (importPath.endsWith('.js') || importPath.endsWith('.mjs') || importPath.endsWith('.cjs')) {
    return importPath;
  }

  // Try as file: ./foo → ./foo.js
  if (existsSync(absPath + '.js')) {
    return importPath + '.js';
  }

  // Try as directory barrel: ./foo → ./foo/index.js
  if (existsSync(join(absPath, 'index.js'))) {
    return importPath + '/index.js';
  }

  // Can't resolve — leave as-is (might be a package export or type-only)
  return importPath;
}

let totalFixed = 0;

function walkDir(dir) {
  const entries = globSync(dir + '/**/*.js');
  for (const filePath of entries) {
    let content = readFileSync(filePath, 'utf-8');
    let modified = false;

    const rewriteImport = (match, prefix, importPath, suffix) => {
      const resolved = resolveImport(importPath, filePath);
      if (resolved !== importPath) {
        totalFixed++;
        modified = true;
      }
      return prefix + resolved + suffix;
    };

    content = content.replace(staticImportRegex, rewriteImport);

    if (modified) {
      writeFileSync(filePath, content, 'utf-8');
    }
  }
}

walkDir(distDir);
console.log(`Fixed ${totalFixed} bare imports in ${distDir}`);
