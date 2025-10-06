/**
 * Patched pdf-parse usage: directly require the underlying lib/pdf-parse.js implementation
 * bypassing the index.js debug harness that attempts to open a test PDF when !module.parent.
 *
 * If pdf-parse package was removed from dependencies, this will fail; ensure dependency present.
 */
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let impl = null;

export async function parsePdf(buffer) {
  if (!impl) {
    // Resolve lib implementation file
    const libPath = require.resolve('pdf-parse/lib/pdf-parse.js');
    impl = require(libPath);
  }
  // pdf-parse expects either Buffer or typed array; we pass Buffer to preserve original behavior.
  return impl(buffer);
}
