import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json";
import zip from 'vite-plugin-zip-pack'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    crx({ manifest }),
    zip({ outDir: 'release', outFileName: 'release.zip' }),
  ],
  build: {
    rollupOptions: {
      input: {
        offscreen: 'src/pages/offscreen/index.html',
      },
    },
  },
  optimizeDeps: {
    // transformers 的 web 产物不能被预打包/二次打包，
    // offscreen 里是通过 vendor 目录运行时加载的
    exclude: ['@huggingface/transformers', 'onnxruntime-web'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  legacy: {
    skipWebSocketTokenCheck: true,
  },
})
