import dns from 'node:dns';
import express from 'express';
import cors from 'cors';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  // Ignored
}
import path from 'node:path';
import dotenv from 'dotenv';
import { BotDatabase } from './backend/database/db.js';
import { SmartBotWorker } from './backend/bot/botWorker.js';
import { createApiRouter } from './backend/routes/api.js';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = Number.parseInt(process.env.PORT || '4000', 10);
  const HOST = '0.0.0.0';

  app.use(cors());
  app.use(express.json());

  // Initialize Database & Worker
  const db = new BotDatabase();
  const worker = new SmartBotWorker(db);

  // API Routes FIRST
  const apiRouter = createApiRouter(worker);
  app.use('/api', apiRouter);

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      exchange: 'Delta Exchange',
      timestamp: new Date().toISOString(),
      botStatus: worker.getStatus().botStatus,
    });
  });

  // Strict API Catch-All: Under NO circumstances should ANY /api request EVER fall through to Vite SPA html fallback!
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl || req.url}` });
  });

  // Vite middleware for development vs static build in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`[Delta Smart Trading Bot] Running on http://${HOST}:${PORT}`);
    // Start the trading worker only after the HTTP server is listening.
    worker.start().catch((err) => {
      console.error('[Delta Smart Trading Bot] Worker startup error:', err);
    });
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(`[Delta Smart Trading Bot] HTTP server failed on ${HOST}:${PORT}:`, err);
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[Delta Smart Trading Bot] Port ${PORT} is already in use. ` +
        'Set the AIC Cloud PORT environment variable to an available port and redeploy.'
      );
    }
    process.exit(1);
  });
}

startServer().catch((err) => {
  console.error('[Delta Smart Trading Bot] Fatal server startup error:', err);
  process.exit(1);
});
