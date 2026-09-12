#!/usr/bin/env node
/**
 * Mirror `packages/sdk` into the standalone public repo.
 *
 * WHY A SCRIPT AND NOT A COPY. The moment the SDK exists in two working trees
 * it can differ in two working trees, and the difference is invisible until an
 * integrator hits it. This repo already carries a scar from exactly that shape:
 * CLAUDE.md documents the DefiLlama adapters as "a hand-maintained mirror" kept
 * honest only by a parity test somebody remembered to write.
 *
 * So the monorepo is the source of truth and the public repo is OUTPUT.
 * Everything under `dest` that this script owns is deleted and rewritten on
 * every run — never edited by hand, and the README it writes says so.
 *
 * WHAT DOES NOT TRAVEL, and why each one:
 *
 *   node_modules   obvious.
 *   dist/          a build artifact. Shipping it in a source repo invites
 *                  someone to read a stale build as the source, and npm builds
 *                  it from `prepublishOnly` anyway.
 *   *.env, *.key   never, under any circumstance. Asserted below rather than
 *                  trusted to the ignore list, because "I filtered it" and "I
 *                  checked afterwards" are different claims and only the
 *                  second one survives a refactor of the filter.
 *   rpc-probe-results.json
 *                  a timestamped latency snapshot of third-party endpoints. It
 *                  is evidence for a decision already encoded in
 *                  `chains/endpoints.ts`, not something a consumer needs, and
 *                  it goes stale in a way that looks authoritative.
 *
 * Usage:  node scripts/sync-public-repo.mjs [--dest <path>] [--dry-run]
 */

import { readdirSync, statSync, mkdirSync, copyFileSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SDK = join(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const destArg = args.indexOf('--dest')
const DEST =
  destArg !== -1 && args[destArg + 1]
    ? args[destArg + 1]
    : join(SDK, '..', '..', '..', 'latch-sdk')

/** Copied verbatim. Anything not named here does not travel.
 *  `assets` holds the repo's social-preview image, which the README embeds.
 *  It is NOT in package.json `files`, so it never enters the npm tarball —
 *  a 90 KB PNG has no business in a dependency. */
const INCLUDE_DIRS = ['src', 'test', 'scripts', 'assets']
const INCLUDE_FILES = [
  'package.json',
  'package-lock.json',
  'README.md',
  'LICENSE',
  'schema.graphql',
  'tsconfig.json',
  'tsconfig.build.json',
  'vitest.config.ts',
]

/** Refused even if some future edit to the lists above would let them through. */
const FORBIDDEN = [/(^|[/\\])\.env($|\.)/i, /\.key$/i, /\.pem$/i, /(^|[/\\])keystore([/\\]|$)/i]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const files = []
for (const d of INCLUDE_DIRS) {
  const p = join(SDK, d)
  if (existsSync(p)) files.push(...walk(p))
}
for (const f of INCLUDE_FILES) {
  const p = join(SDK, f)
  if (existsSync(p)) files.push(p)
}

/* The assertion, not the filter, is what makes this safe to run unattended. */
for (const f of files) {
  const rel = relative(SDK, f)
  if (FORBIDDEN.some((re) => re.test(rel))) {
    console.error(`REFUSING TO SYNC: ${rel} matches a forbidden pattern.`)
    process.exit(1)
  }
}

if (!existsSync(DEST)) {
  console.error(`Destination does not exist: ${DEST}`)
  process.exit(1)
}
if (!existsSync(join(DEST, '.git'))) {
  console.error(`Destination is not a git repo: ${DEST}\nRefusing to write into a plain directory.`)
  process.exit(1)
}

/* Clear only what this script owns. A file the public repo added on its own —
   CI config, issue templates, a CONTRIBUTING — is left alone, because the
   mirror owns the package and not the repository around it. */
for (const d of [...INCLUDE_DIRS]) {
  const p = join(DEST, d)
  if (existsSync(p) && !DRY) rmSync(p, { recursive: true, force: true })
}

let n = 0
for (const f of files) {
  const rel = relative(SDK, f)
  const target = join(DEST, rel)
  if (!DRY) {
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(f, target)
  }
  n++
}

/* THE MIRROR MUST NOT TRY TO REGENERATE ITS ABIs.
   `build` here is `npm run generate && tsc`, and every generator reads Foundry
   artifacts out of ../core, ../registry and ../launchpad — paths that exist
   only inside the monorepo. Copied verbatim, `npm run build` fails on a fresh
   clone with "Artifact not found", which is a broken repo for anyone who wants
   to contribute.
   The generated ABI files themselves DO travel (under each module's own
   `generated` directory), so the mirror has everything it needs to compile.
   Regeneration is a monorepo
   operation, because that is the only place the source of truth for those ABIs
   — the Solidity — exists. Rewriting the scripts here rather than editing the
   real package.json keeps that asymmetry in one place. */
if (!DRY) {
  const pkgPath = join(DEST, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  for (const k of Object.keys(pkg.scripts)) {
    if (k === 'generate' || k.startsWith('generate:')) delete pkg.scripts[k]
  }
  pkg.scripts.build = 'tsc -p tsconfig.build.json'
  pkg.scripts.prepublishOnly = 'npm run build'
  pkg.repository = { type: 'git', url: 'git+https://github.com/Latch-Protocol-Team/latch-sdk.git' }
  pkg.bugs = { url: 'https://github.com/Latch-Protocol-Team/latch-sdk/issues' }
  pkg.homepage = 'https://latch.guru'
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + String.fromCharCode(10))
}

const version = JSON.parse(readFileSync(join(SDK, 'package.json'), 'utf8')).version
console.log(`${DRY ? '[dry run] would sync' : 'synced'} ${n} files -> ${DEST}`)
console.log(`  @latchprotocol/sdk@${version}`)
if (!DRY) console.log('  now: cd into the repo, review `git status`, commit, push.')
