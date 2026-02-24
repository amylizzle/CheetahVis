import express from 'express';
import path from "path";
import { fileURLToPath } from "url";

const app = express();

const HTTP_PORT = process.env.VITE_HTTP_PORT || 8080;
const HTTP_INTERFACE = process.env.VITE_HTTP_HOST || '0.0.0.0';
const WEBSOCKET_PORT = process.env.VITE_APP_WEBSOCKET_PORT || 8081;

// Serve static files from the 'dist' directory

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, '/dist');

// Serve static files from the Vite build output (dist folder)
app.use(express.static(distPath, {
  setHeaders: (res, filePath) => {
    // Ensure JavaScript files are served with the correct MIME type
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
    // Ensure CSS files are served with the correct MIME type
    if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    }
    // Ensure .gltf files are served with the correct MIME type
    if (filePath.endsWith('.gltf')) {
      res.setHeader('Content-Type', 'application/json');
    }
    // Ensure .bin files are served with the correct MIME type
    if (filePath.endsWith('.bin')) {
      res.setHeader('Content-Type', 'application/octet-stream');
    }
  }
}));

app.get('/wsport', (req, res) => {
  res.send(WEBSOCKET_PORT)
})

// Handle all routes by serving index.html (for client-side routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});



app.listen(HTTP_PORT, HTTP_INTERFACE, () => {
  console.log(`Production Server running at http://localhost:${HTTP_PORT}`);
});
