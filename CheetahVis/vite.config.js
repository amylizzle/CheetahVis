import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig(({ mode }) => {
  const base = '/';

  return {
    define: {
      'import.meta.env.MODE': JSON.stringify(mode),
    },
    envPrefix: 'VITE_', // Stick to Vite convention
    base, 
    publicDir: 'public',
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/three')) {
              return 'three';
            }
            if (id.includes('node_modules/plotly.js-dist')) {
              return 'plotly';
            }
            if (id.includes('node_modules/three/examples/jsm')) {
              return 'three-extras';
            }
            return 'vendor';
          },
        },
      },
      chunkSizeWarningLimit: 1500,  // 1.5 MB
      minify: 'esbuild',  // Faster minification
    },
    plugins: [
      viteStaticCopy({
        targets: [
          { src: 'serve.json', dest: './' }
        ]
      })
    ]
  };
});
