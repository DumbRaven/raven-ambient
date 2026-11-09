import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  // 两个入口：主界面，以及「放到桌面」那个放映窗。
  // 桌面窗必须是独立的 html 而不是主界面的一个路由——它跑在另一个渲染进程里，
  // 只该加载版式需要的那些代码，不该把整个收藏柜、音频引擎都带过去。
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        desktop: resolve(__dirname, 'desktop.html'),
      },
    },
  },
});
