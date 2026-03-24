import { defineConfig, type PreviewServer, type ResolvedServerUrls, type ViteDevServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

function scoreNetworkUrl(url: string): number {
  try {
    const { hostname } = new URL(url)

    if (/^192\.168\./.test(hostname)) return 4
    if (/^10\./.test(hostname)) return 3
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return 2
    if (/^169\.254\./.test(hostname)) return -1
    if (/^198\.(18|19)\./.test(hostname)) return -2
  } catch {
    return 0
  }

  return 0
}

function getCompactResolvedUrls(urls: ResolvedServerUrls): ResolvedServerUrls {
  if (urls.network.length <= 1) return urls

  const preferredNetworkUrl = [...urls.network]
    .sort((left, right) => scoreNetworkUrl(right) - scoreNetworkUrl(left))[0]

  return {
    ...urls,
    network: preferredNetworkUrl ? [preferredNetworkUrl] : [],
  }
}

function compactPrintedNetworkUrls(server: ViteDevServer | PreviewServer): void {
  const originalPrintUrls = server.printUrls.bind(server)

  server.printUrls = () => {
    if (server.resolvedUrls) {
      // Keep LAN access, but only print one preferred network URL in the terminal.
      server.resolvedUrls = getCompactResolvedUrls(server.resolvedUrls)
    }

    originalPrintUrls()
  }
}

function compactNetworkUrlsPlugin() {
  return {
    name: 'compact-network-urls',
    configureServer(server: ViteDevServer) {
      compactPrintedNetworkUrls(server)
    },
    configurePreviewServer(server: PreviewServer) {
      compactPrintedNetworkUrls(server)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), compactNetworkUrlsPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0', // 允许局域网访问
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
