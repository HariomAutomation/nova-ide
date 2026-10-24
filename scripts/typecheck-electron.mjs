import { execSync } from 'node:child_process';

/**
 * Typecheck Ratchet for Electron TypeScript Backend
 *
 * Ensures that TypeScript errors never increase, and locks in improvements
 * as the codebase is progressively annotated with full types.
 */

const MAX_ALLOWED_ERRORS = 0;

console.log('[typecheck:electron] Running TypeScript check (--noCheck false --noEmit)...');

let output = '';
let exitCode = 0;

try {
  output = execSync('npx tsc -p tsconfig.electron.json --noCheck false --noEmit', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (err) {
  exitCode = err.status ?? 1;
  output = (err.stdout || '') + (err.stderr || '');
}

// Parse error occurrences
const errorLines = output.split('\n').filter((l) => /:\s*error TS\d+:/.test(l));
const errorCount = errorLines.length;

const fileCounts = {};
for (const line of errorLines) {
  const m = line.match(/^([a-zA-Z0-9_\/.-]+\.ts)/);
  if (m) {
    fileCounts[m[1]] = (fileCounts[m[1]] || 0) + 1;
  }
}

console.log(`\n--- Typecheck Summary ---`);
console.log(`Total errors: ${errorCount} (Allowed ceiling: ${MAX_ALLOWED_ERRORS})`);
if (Object.keys(fileCounts).length > 0) {
  console.log('Breakdown by file:');
  for (const [file, count] of Object.entries(fileCounts)) {
    console.log(`  ${file}: ${count}`);
  }
}

if (errorCount > MAX_ALLOWED_ERRORS) {
  console.error(
    `\n❌ Typecheck Ratchet FAILED! Error count (${errorCount}) exceeded ceiling (${MAX_ALLOWED_ERRORS}).`
  );
  console.error('Please fix new type errors before committing.');
  process.exit(1);
}

if (errorCount < MAX_ALLOWED_ERRORS) {
  console.log(
    `\n🎉 Progress! Error count (${errorCount}) is lower than current ceiling (${MAX_ALLOWED_ERRORS}).`
  );
  console.log(`Lock in this improvement by updating MAX_ALLOWED_ERRORS to ${errorCount} in scripts/typecheck-electron.mjs.`);
} else {
  console.log(`\n✓ Typecheck ratchet passed: ${errorCount} errors within ceiling (${MAX_ALLOWED_ERRORS}).`);
}

process.exit(0);
