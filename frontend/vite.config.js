import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

const gitHash = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim() }
  catch { return 'dev' }
})()

const gitDate = (() => {
  try { return execSync('git log -1 --format=%cd --date=format:"%b %d"').toString().trim() }
  catch { return '' }
})()

export default defineConfig({
  plugins: [react()],
  define: {
    __GIT_HASH__: JSON.stringify(gitHash),
    __GIT_DATE__: JSON.stringify(gitDate),
  },
  server: {
    proxy: {
      '/api':   'http://localhost:5000',
      '/ws':    { target: 'ws://localhost:5000', ws: true },
      '/vnc':   { target: 'ws://localhost:5000', ws: true },
      '/host-ws': { target: 'ws://localhost:5000', ws: true },
      '/terminal': 'http://localhost:5000',
      '/host-terminal': 'http://localhost:5000',
    }
  },
  build: {
    outDir: 'dist',
    target: 'esnext',   // noVNC uses top-level await
  }
})
