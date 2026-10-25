/**
 * Starts the web app and the local admin API together, so `npm run dev` stays
 * the only command anyone has to remember.
 *
 * The admin API exits quietly on its own if serviceAccount.json is absent — the
 * app still runs, just without in-panel password reset.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Run tools through Node directly rather than via their npx/.cmd shims. Those
// shims need `shell: true` on Windows, which Node now warns about (DEP0190), and
// a shell in between also stops Ctrl+C from reaching the real process — Vite
// could be left running and holding the port.
const VITE = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')

const children = []

function run(command, args, label) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit' })
  child.on('exit', (code) => {
    // Vite going down means the session is over; the API quitting is expected
    // when there is no service-account key.
    if (label === 'vite') shutdown(code ?? 0)
  })
  children.push(child)
  return child
}

function shutdown(code) {
  children.forEach((c) => {
    if (!c.killed) {
      try { c.kill() } catch { /* already gone */ }
    }
  })
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

run(process.execPath, ['server/admin-api.mjs'], 'api')
run(process.execPath, [VITE], 'vite')
