import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Vite injects an inline React-refresh bootstrap in development. The renderer's
// production CSP stays strict; relax script-src only on the local dev server.
const developmentCspPlugin = {
  name: 'electron-development-csp',
  apply: 'serve' as const,
  transformIndexHtml(html: string) {
    return html.replace("script-src 'self' 'wasm-unsafe-eval';", "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval';")
  },
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    // Serve the WASM files from the installed MediaPipe package so the
    // renderer does not depend on a version-drifting CDN for its runtime.
    publicDir: resolve(__dirname, 'node_modules/@mediapipe/tasks-vision/wasm'),
    server: {
      port: 5175,
      strictPort: true,
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        // Renderer code needs native ESM exports; the shared package's built
        // CommonJS barrel cannot expose runtime named exports in the browser.
        '@proctoroverlay/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      },
    },
    plugins: [react(), developmentCspPlugin],
  },
})
