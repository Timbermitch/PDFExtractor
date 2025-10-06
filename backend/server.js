import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import fs from 'fs';
import { createRequire } from 'module';
import uploadRouter from './routes/upload.js';
import processRouter from './routes/process.js';
import exportRouter from './routes/export.js';
import listRouter from './routes/list.js';
import deleteRouter from './routes/deleteReport.js';
import debugGoalsRouter from './routes/debugGoals.js';
import reportGetRouter from './routes/reportGet.js';
import reportSummaryRouter from './routes/reportSummary.js';
import metricsRouter from './routes/metrics.js';
import { notFoundHandler, errorHandler } from './utils/errorHandlers.js';

dotenv.config();

const app = express();
console.log(`[diagnostic] server.js entry pid=${process.pid} node=${process.version}`);
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// Static serve data directories for quick inspection (read-only intent)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Serve data directory (under project root or current working dir)
app.use('/data', express.static(path.join(process.cwd(), 'data')));
// Serve simple frontend UI if present (support running from repo root or backend/)
function resolveFrontendDir(){
  // Candidate directories in priority order
  const candidates = [
    path.join(process.cwd(), 'frontend_build'),       // explicit copied build
    path.join(process.cwd(), 'frontend', 'build'),    // CRA style build inside frontend
    path.join(process.cwd(), 'frontend'),             // raw frontend folder
    path.join(process.cwd(), '..', 'frontend'),       // running from backend/ subdir
  ];
  for(const dir of candidates){
    try {
      if(fs.existsSync(path.join(dir,'index.html'))){
        return dir;
      }
    } catch(_) { /* ignore */ }
  }
  return candidates[2]; // default to /frontend even if missing
}
const frontendDir = resolveFrontendDir();
console.log('[startup] frontendDir resolved to', frontendDir);
app.use(express.static(frontendDir));
app.get('/', (req, res) => {
  const idx = path.join(frontendDir, 'index.html');
  if(fs.existsSync(idx)){
    return res.sendFile(idx);
  }
  // Fallback minimal inline UI so Render root is never blank.
  res.setHeader('Content-Type','text/html; charset=utf-8');
  return res.end(`<!doctype html><html><head><meta charset=utf-8><title>PDF Extractor Backend</title><style>body{font-family:system-ui,Arial,sans-serif;background:#111;color:#eee;padding:2rem;line-height:1.5;}code{background:#222;padding:.15rem .4rem;border-radius:4px;}a{color:#7fb3ff;text-decoration:none;}a:hover{text-decoration:underline;}h1{margin-top:0;font-size:1.4rem;}ul{margin:0 0 1rem 1.2rem;padding:0;}li{margin:.25rem 0;}</style></head><body><h1>PDF Extraction Service</h1><p>No <code>index.html</code> frontend was found at runtime. The API is live.</p><h2>Endpoints</h2><ul><li><code>/health</code> – liveness</li><li><code>/version</code> – build metadata</li><li><code>/upload</code> – multipart PDF upload (field <code>file</code>)</li><li><code>/process</code> – build structured report (POST JSON: { id })</li><li><code>/reports</code> – list processed reports</li><li><code>/report/:id</code> – fetch single report</li><li><code>/export/:id?format=csv|json</code> – export data</li></ul><p>To deploy the UI, include a <code>frontend/index.html</code> or CRA build (served from <code>frontend/build</code> or <code>frontend_build</code>).</p><p><em>Render Fallback Mode</em></p></body></html>`);
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Lightweight version/build metadata endpoint (no external deps, safe for prod)
let pkgVersion = '0.0.0';
try {
  // Resolve backend package.json version
  const requireLocal = createRequire(import.meta.url);
  const pkg = requireLocal('./package.json');
  pkgVersion = pkg.version || pkgVersion;
} catch (e) {
  console.warn('[startup] unable to load package version', e.message);
}
app.get('/version', (_req, res) => {
  res.json({
    service: 'pdf-extractor-backend',
    version: pkgVersion,
    commit: process.env.GIT_SHA || null,
    buildTime: process.env.BUILD_TIME || null,
    node: process.version,
    env: process.env.NODE_ENV || 'development'
  });
});

app.use('/upload', uploadRouter);
app.use('/process', processRouter);
app.use('/export', exportRouter);
app.use('/reports', listRouter);
app.use('/reports', deleteRouter);
app.use('/debug', debugGoalsRouter);
app.use('/report', reportGetRouter); // singular fetch by id
app.use('/reports', reportSummaryRouter);
app.use('/reports', metricsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

// Default port aligned with frontend proxy (5200) so fewer mismatches.
const BASE_PORT = parseInt(process.env.PORT, 10) || 5200;
// Use dual-stack default (no explicit host) so that both IPv4 (127.0.0.1) and IPv6 (::1) localhost resolutions work.
// Previously hard-coding '0.0.0.0' caused browser attempts to ::1 (IPv6 localhost) to fail with ECONNREFUSED -> Axios "Network Error".
const BIND_HOST = process.env.BIND_HOST || '';
const MAX_TRIES = 3;

function startServer(optionsOrAttempt, maybePort){
  // Backward compatibility: startServer(attempt, port)
  let attempt = 1;
  let port = BASE_PORT;
  if(typeof optionsOrAttempt === 'number'){
    attempt = optionsOrAttempt || 1;
    if(typeof maybePort === 'number') port = maybePort;
  } else if (typeof optionsOrAttempt === 'object' && optionsOrAttempt){
    port = optionsOrAttempt.preferredPort || BASE_PORT;
    attempt = 1;
  }
  const hostLabel = BIND_HOST || '(default)';
  console.log(`[startup] attempting listen host=${hostLabel} port=${port} attempt=${attempt}`);
  const server = BIND_HOST
    ? app.listen(port, BIND_HOST, () => {
        const addr = server.address();
        console.log(`[startup] Server listening on ${typeof addr === 'object' ? addr.address : addr}:${port} (attempt ${attempt})`);
        selfHealthCheck(port);
      })
    : app.listen(port, () => {
        const addr = server.address();
        console.log(`[startup] Server listening (default host) on ${typeof addr === 'object' ? addr.address : addr}:${port} (attempt ${attempt})`);
        selfHealthCheck(port);
      });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < MAX_TRIES) {
      console.error(`[startup] Port ${port} in use, retrying on ${port+1} (attempt ${attempt+1}/${MAX_TRIES})`);
      setTimeout(() => startServer(attempt + 1, port + 1), 300);
    } else {
      console.error('[startup] Failed to start server:', err);
      process.exit(1);
    }
  });
  server.on('close', () => {
    console.warn('[lifecycle] server close event fired');
  });
  // Keep a reference for potential future introspection
  global.__EXPRESS_SERVER__ = server;
  return { server, port };
}

function selfHealthCheck(port) {
  const hosts = ['127.0.0.1', '::1'];
  hosts.forEach(h => {
    const options = { host: h, port, path: '/health', timeout: 4000 };
    const req = http.request(options, (res) => {
      if (res.statusCode === 200) {
        console.log(`[startup] Health check OK host=${h}`);
      } else {
        console.warn(`[startup] Health check non-200 host=${h} status=${res.statusCode}`);
      }
    });
    req.on('error', (e) => {
      console.error(`[startup] Health check failed host=${h}:`, e.message);
    });
    req.end();
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('[fatal] Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught Exception:', err);
});
process.on('exit', (code) => {
  console.warn(`[lifecycle] process exit code=${code}`);
});
process.on('beforeExit', (code) => {
  console.warn(`[lifecycle] beforeExit code=${code}`);
});
// Graceful shutdown only if not explicitly told to keep alive (KEEP_ALIVE=1 will skip forced exits in dev smoke tests)
const ENABLE_SHUTDOWN = process.env.KEEP_ALIVE !== '1';
['SIGINT','SIGTERM','SIGBREAK'].forEach(sig => {
  process.on(sig, () => {
    if(!ENABLE_SHUTDOWN){
      console.warn(`[lifecycle] signal ${sig} received but KEEP_ALIVE=1 so ignoring shutdown`);
      return;
    }
    console.warn(`[lifecycle] signal ${sig} received - initiating graceful shutdown`);
    const srv = global.__EXPRESS_SERVER__;
    if (srv && srv.listening) {
      try {
        srv.close(() => {
          console.warn('[lifecycle] server closed, exiting process');
          process.exit(0);
        });
        setTimeout(() => {
          console.warn('[lifecycle] forced exit after close timeout');
          process.exit(0);
        }, 3000).unref();
      } catch (e) {
        console.error('[lifecycle] error during close', e);
        process.exit(1);
      }
    } else {
      process.exit(0);
    }
  });
});

// Periodic heartbeat to prove liveness if process unexpectedly ends early
setInterval(() => {
  if (global.__EXPRESS_SERVER__?.listening) {
    process.stdout.write('.');
  }
}, 15000).unref();

// Export for programmatic tests
export { app, startServer };

// Only auto-start if this file is the entry point (not imported by a test script)
const isDirect = process.argv[1] && path.basename(process.argv[1]) === 'server.js';
if (isDirect) {
  startServer();
}
