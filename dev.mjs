import { spawn } from 'node:child_process'
import process from 'node:process'

const children = [
  { name: 'proxy', args: ['server.mjs'] },
  { name: 'vite', args: ['node_modules/vite/bin/vite.js'] },
].map(({ name, args }) => {
  const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: false })
  child.on('error', (error) => {
    console.error(`[${name}] ${error.message}`)
    shutdown(1)
  })
  child.on('exit', (code, signal) => {
    if (!shuttingDown && code !== 0) {
      console.error(`[${name}] exited with ${signal || code}`)
      shutdown(code || 1)
    }
  })
  return child
})

let shuttingDown = false

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(code), 150)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
