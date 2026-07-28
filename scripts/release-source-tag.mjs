import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const excludedPaths = [
  ':(exclude).codex/**',
  ':(exclude).omc/**',
  ':(exclude)docs/**',
  ':(exclude)plans/**',
  ':(exclude)qa/**',
  ':(exclude)HANDOFF.md',
];
const sourcePathspec = ['.', ...excludedPaths];

function git(args, encoding = 'utf8') {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding,
    maxBuffer: 128 * 1024 * 1024,
  });
}

const commit = git(['rev-parse', '--short', 'HEAD']).trim();
const trackedPatch = git(['diff', '--binary', 'HEAD', '--', ...sourcePathspec], null);
const untrackedOutput = git([
  'ls-files',
  '--others',
  '--exclude-standard',
  '-z',
  '--',
  ...sourcePathspec,
], null);
const untrackedPaths = untrackedOutput
  .toString('utf8')
  .split('\0')
  .filter(Boolean)
  .sort();

if (trackedPatch.length === 0 && untrackedPaths.length === 0) {
  process.stdout.write(commit);
  process.exit(0);
}

const fingerprint = createHash('sha256');
fingerprint.update(trackedPatch);
for (const path of untrackedPaths) {
  fingerprint.update(path);
  fingerprint.update('\0');
  fingerprint.update(readFileSync(path));
  fingerprint.update('\0');
}

process.stdout.write(`${commit}-dirty-${fingerprint.digest('hex').slice(0, 12)}`);
