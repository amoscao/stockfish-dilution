import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    proxy: {
      '/api': {
        target: 'https://dock2.csslab.ca',
        changeOrigin: true,
        secure: true
      }
    }
  }
});
