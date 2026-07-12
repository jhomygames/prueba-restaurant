import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // En desarrollo, la API vive en el backend Express (puerto 3000).
      proxy: {
        '/api': 'http://localhost:3000',
      },
    },
  };
});
