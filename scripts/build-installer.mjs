/**
 * Builds the Windows installer for the desktop till.
 *
 *   npm run electron:build   ->  release/StockPilot-Till-Setup-<version>.exe
 *
 * Why this exists rather than calling electron-builder directly: packing inside
 * this project folder fails on Windows with
 *
 *   EPERM: operation not permitted, rename 'release\win-unpacked.tmp' -> ...
 *
 * Electron unpacks thousands of deeply nested files, and under a long path with
 * spaces the rename is refused (antivirus scanning the freshly written .exe and
 * Windows' path limit both contribute). Staging in a short path at the drive
 * root avoids it entirely, then only the finished installer is copied back.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, copyFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(path.join(root, 'package.json'), 'utf8')))

// Short staging directory at the root of the same drive as the project.
const drive = path.parse(root).root
const STAGE = process.env.SP_BUILD_DIR || path.join(drive, '.stockpilot-build')
const RELEASE = path.join(root, 'release')

// Called through Node directly — see the note in scripts/dev.mjs.
const VITE = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const BUILDER = path.join(root, 'node_modules', 'electron-builder', 'cli.js')

const ok = (m) => console.log(`\x1b[32m  ✓\x1b[0m ${m}`)
const info = (m) => console.log(`\x1b[36m  •\x1b[0m ${m}`)

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) {
    console.log(`\n\x1b[31m  ✗ ${command} failed\x1b[0m\n`)
    process.exit(result.status || 1)
  }
}

console.log(`\n\x1b[1m  Building StockPilot Till ${pkg.version}\x1b[0m\n`)

// 1. Bundle the app with relative asset paths (file:// needs them).
info('Bundling the app…')
run(process.execPath, [VITE, 'build', '--mode', 'electron'])

// 2. Pack, staged outside the project.
info(`Packaging via ${STAGE}`)
rmSync(STAGE, { recursive: true, force: true })
mkdirSync(STAGE, { recursive: true })

run(process.execPath, [BUILDER, '--win', `--config.directories.output=${STAGE.replace(/\\/g, '/')}`])

// 3. Bring the installer back into the project.
mkdirSync(RELEASE, { recursive: true })

const installers = readdirSync(STAGE).filter((f) => f.endsWith('.exe') && !f.includes('__uninstaller'))
if (!installers.length) {
  console.log('\n\x1b[31m  ✗ No installer was produced.\x1b[0m\n')
  process.exit(1)
}

let copied = ''
for (const file of installers) {
  copyFileSync(path.join(STAGE, file), path.join(RELEASE, file))
  copied = file
}
// The blockmap sits next to the installer and is used for delta updates.
readdirSync(STAGE)
  .filter((f) => f.endsWith('.blockmap'))
  .forEach((f) => copyFileSync(path.join(STAGE, f), path.join(RELEASE, f)))

rmSync(STAGE, { recursive: true, force: true })

const finalPath = path.join(RELEASE, copied)
const mb = (statSync(finalPath).size / 1024 / 1024).toFixed(0)

ok(`Installer ready — ${mb} MB`)
console.log(`\n\x1b[1m  ${finalPath}\x1b[0m\n`)
console.log('  Give that file to the shop. It installs like any Windows app and')
console.log('  creates a desktop shortcut.\n')
