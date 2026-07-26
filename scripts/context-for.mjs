#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const defaultRepoRoot = resolve(scriptDir, '..');
export const defaultManifestPath = resolve(defaultRepoRoot, '.codex/context-manifest.json');

function unique(values) {
  return [...new Set(values)];
}

function normalizeInput(value, repoRoot) {
  const raw = String(value).replaceAll('\\', '/').trim();
  if (!raw) return { value: '', pathLike: false };
  const firstSegment = raw.split('/')[0];
  const pathLike = isAbsolute(raw)
    || raw.startsWith('.')
    || (
      raw.includes('/')
      && !/\s/.test(raw)
      && existsSync(resolve(repoRoot, firstSegment))
    );
  if (pathLike) {
    const absolutePath = isAbsolute(raw) ? raw : resolve(repoRoot, raw);
    const fromRoot = relative(repoRoot, absolutePath).replaceAll('\\', '/');
    if (fromRoot === '..' || fromRoot.startsWith('../') || isAbsolute(fromRoot)) {
      return { value: '', pathLike: true };
    }
    return { value: fromRoot.replace(/^\.\//, '').toLowerCase(), pathLike: true };
  }
  return { value: raw.toLowerCase(), pathLike: false };
}

function containsKeyword(input, keyword) {
  const normalizedKeyword = keyword.toLowerCase();
  if (normalizedKeyword.includes(' ')) return input.includes(normalizedKeyword);
  const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(input);
}

function matchesProfile(profile, inputs, repoRoot) {
  const normalized = inputs
    .map((input) => normalizeInput(input, repoRoot))
    .filter((input) => input.value);
  const rules = profile.match;
  return normalized.some((input) =>
    rules.exact.some((candidate) => input.value === candidate.toLowerCase())
    || rules.prefixes.some((prefix) => input.value.startsWith(prefix.toLowerCase()))
    || rules.contains.some((fragment) => input.value.includes(fragment.toLowerCase()))
    || (!input.pathLike && rules.keywords.some((keyword) => containsKeyword(input.value, keyword))));
}

export function loadManifest(manifestPath = defaultManifestPath) {
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

export function resolveContext(manifest, {
  inputs = [],
  explicitProfiles = [],
  repoRoot = defaultRepoRoot,
} = {}) {
  const explicit = new Set(explicitProfiles);
  const profiles = manifest.profiles.filter((profile) =>
    explicit.has(profile.id) || matchesProfile(profile, inputs, repoRoot));

  return {
    version: manifest.version,
    profiles: profiles.map((profile) => profile.id),
    context: unique([
      ...manifest.base,
      ...(manifest.optional ?? []).filter((contextPath) => existsSync(resolve(repoRoot, contextPath))),
      ...profiles.flatMap((profile) => profile.context),
    ]),
    qa: unique(profiles.flatMap((profile) => profile.qa)),
    matched: profiles.length > 0,
  };
}

export function validateManifest(manifest, repoRoot = defaultRepoRoot) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['manifest must be an object'];
  }
  if (!Number.isInteger(manifest.version) || manifest.version < 1) {
    errors.push('version must be a positive integer');
  }
  if (
    !Array.isArray(manifest.base)
    || !Array.isArray(manifest.optional)
    || !Array.isArray(manifest.profiles)
  ) {
    return [...errors, 'base, optional, and profiles must be arrays'];
  }

  const ids = new Set();
  for (const profile of manifest.profiles) {
    if (!profile || typeof profile.id !== 'string' || !profile.id.trim()) {
      errors.push('every profile must have a non-empty id');
      continue;
    }
    if (ids.has(profile.id)) errors.push(`duplicate profile id: ${profile.id}`);
    ids.add(profile.id);

    for (const field of ['description', 'match', 'context', 'qa']) {
      if (profile[field] == null) errors.push(`${profile.id}: missing ${field}`);
    }
    if (typeof profile.description !== 'string' || !profile.description.trim()) {
      errors.push(`${profile.id}: description must be a non-empty string`);
    }
    for (const field of ['prefixes', 'exact', 'contains', 'keywords']) {
      if (!Array.isArray(profile.match?.[field])) {
        errors.push(`${profile.id}: match.${field} must be an array`);
      } else if (profile.match[field].some((entry) => typeof entry !== 'string' || !entry.trim())) {
        errors.push(`${profile.id}: match.${field} entries must be non-empty strings`);
      }
    }
    if (!Array.isArray(profile.context) || !profile.context.length) {
      errors.push(`${profile.id}: context must be a non-empty array`);
    }
    if (!Array.isArray(profile.qa) || !profile.qa.length) {
      errors.push(`${profile.id}: qa must be a non-empty array`);
    } else if (profile.qa.some((entry) => typeof entry !== 'string' || !entry.trim())) {
      errors.push(`${profile.id}: qa entries must be non-empty strings`);
    }
  }

  for (const contextPath of unique([
    ...manifest.base,
    ...manifest.profiles.flatMap((profile) => profile.context ?? []),
  ])) {
    if (typeof contextPath !== 'string' || !contextPath.trim()) {
      errors.push('context paths must be non-empty strings');
      continue;
    }
    if (!isWithinRepo(repoRoot, contextPath)) {
      errors.push(`context path must be repository-relative: ${contextPath}`);
    } else if (!existsSync(resolve(repoRoot, contextPath))) {
      errors.push(`context path does not exist: ${contextPath}`);
    }
  }

  for (const contextPath of manifest.optional) {
    if (typeof contextPath !== 'string' || !contextPath.trim()) {
      errors.push('optional context paths must be non-empty strings');
    } else if (!isWithinRepo(repoRoot, contextPath)) {
      errors.push(`optional context path must be repository-relative: ${contextPath}`);
    }
  }

  return errors;
}

function isWithinRepo(repoRoot, contextPath) {
  if (isAbsolute(contextPath)) return false;
  const fromRoot = relative(repoRoot, resolve(repoRoot, contextPath));
  return fromRoot !== '..' && !fromRoot.startsWith('../') && !isAbsolute(fromRoot);
}

function parseArgs(argv) {
  const inputs = [];
  const explicitProfiles = [];
  let json = false;
  let check = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') json = true;
    else if (arg === '--check') check = true;
    else if (arg === '--profile') {
      const profile = argv[index + 1];
      if (!profile) throw new Error('--profile requires an id');
      explicitProfiles.push(...profile.split(',').filter(Boolean));
      index += 1;
    } else {
      inputs.push(arg);
    }
  }
  return { inputs, explicitProfiles, json, check };
}

function formatText(result, manifest) {
  const lines = [
    `Context manifest v${result.version}`,
    `Profiles: ${result.profiles.length ? result.profiles.join(', ') : 'none'}`,
    '',
    'Read:',
    ...result.context.map((entry) => `- ${entry}`),
  ];

  if (result.qa.length) {
    lines.push('', 'QA:', ...result.qa.map((entry) => `- ${entry}`));
  }
  if (!result.matched) {
    lines.push(
      '',
      'No task profile matched. Scout the target first, then pass --profile <id>.',
      `Available profiles: ${manifest.profiles.map((profile) => profile.id).join(', ')}`,
    );
  }
  return lines.join('\n');
}

export function runCli(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  let manifest;
  try {
    manifest = loadManifest();
  } catch (error) {
    console.error(`Unable to read context manifest: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const errors = validateManifest(manifest);
  if (options.check) {
    if (errors.length) {
      console.error(errors.map((error) => `- ${error}`).join('\n'));
      return 1;
    }
    console.log(
      `Context manifest valid: v${manifest.version}, ${manifest.profiles.length} profiles, `
      + `${unique([
        ...manifest.base,
        ...manifest.optional,
        ...manifest.profiles.flatMap((profile) => profile.context),
      ]).length} context paths.`,
    );
    return 0;
  }
  if (errors.length) {
    console.error('Context manifest is invalid. Run pnpm context:check.');
    return 1;
  }

  const knownIds = new Set(manifest.profiles.map((profile) => profile.id));
  const unknown = options.explicitProfiles.filter((profile) => !knownIds.has(profile));
  if (unknown.length) {
    console.error(`Unknown profile: ${unknown.join(', ')}`);
    return 2;
  }

  const result = resolveContext(manifest, options);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatText(result, manifest));
  return 0;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  process.exitCode = runCli();
}
