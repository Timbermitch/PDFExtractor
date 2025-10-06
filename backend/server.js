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
  console.log('[diagnostic] resolveFrontendDir() cwd=', process.cwd());
  let chosen = candidates[2];
  candidates.forEach((dir, idx) => {
    let stat = 'missing';
    let idxExists = false;
    try {
      if(fs.existsSync(dir)) stat = 'exists';
      idxExists = fs.existsSync(path.join(dir,'index.html'));
    } catch(e){ stat = 'err:' + e.code; }
    console.log(`[diagnostic] candidate[${idx}] dir=${dir} dirState=${stat} indexHtml=${idxExists}`);
    if(!chosen && idxExists) chosen = dir;
    if(idxExists && !chosen) chosen = dir;
  });
  // Prefer first with index.html
  for(const dir of candidates){
    try { if(fs.existsSync(path.join(dir,'index.html'))) { chosen = dir; break; } } catch(_){}
  }
  return chosen;
}
const frontendDir = resolveFrontendDir();
console.log('[startup] frontendDir resolved to', frontendDir, 'index.html exists=', fs.existsSync(path.join(frontendDir,'index.html')));
// Additional explicit build dir (if created by render build step) gets priority for static assets
const explicitBuildDir = path.join(process.cwd(),'frontend_build');
if(fs.existsSync(explicitBuildDir)){
  console.log('[startup] Serving explicit build dir at / (priority)', explicitBuildDir);
  app.use(express.static(explicitBuildDir));
}

// Expose a lightweight diagnostics endpoint to introspect deployment state (safe, no secrets)
app.get('/__diag', (_req, res) => {
  const candidates = [
    path.join(process.cwd(), 'frontend_build'),
    path.join(process.cwd(), 'frontend', 'build'),
    path.join(process.cwd(), 'frontend'),
    path.join(process.cwd(), '..', 'frontend'),
  ];
  const candidateInfo = candidates.map(d => {
    let exists = false, indexExists = false;
    try { exists = fs.existsSync(d); indexExists = fs.existsSync(path.join(d,'index.html')); } catch(_){}
    return { dir: d, exists, indexHtml: indexExists };
  });
  res.json({
    cwd: process.cwd(),
    dirname: __dirname,
    frontendDir,
    frontendIndexExists: fs.existsSync(path.join(frontendDir,'index.html')),
    portEnv: process.env.PORT || null,
    nodeEnv: process.env.NODE_ENV || null,
    gitSha: process.env.GIT_SHA || null,
    buildTime: process.env.BUILD_TIME || null,
    candidates: candidateInfo,
    memory: process.memoryUsage(),
    uptimeSeconds: process.uptime(),
    routesSample: (app._router?.stack||[]).filter(l=>l.route && l.route.path).slice(0,30).map(l=>({path:l.route.path, methods:Object.keys(l.route.methods)})),
  });
});
app.use(express.static(frontendDir));
app.get('/', (req, res) => {
  const idx = path.join(frontendDir, 'index.html');
  if (fs.existsSync(idx)) {
    return res.sendFile(idx);
  }
  // Richer fallback inline UI with diagnostics so we can tell if the container is fresh.
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const now = new Date().toISOString();
  const envInfo = {
    node: process.version,
    pid: process.pid,
    cwd: process.cwd(),
    frontendDir,
    frontendIndexExists: fs.existsSync(path.join(frontendDir, 'index.html')),
    PORT: process.env.PORT || null,
    NODE_ENV: process.env.NODE_ENV || null,
    GIT_SHA: process.env.GIT_SHA || null,
    BUILD_TIME: process.env.BUILD_TIME || null,
  };
  const diagPre = JSON.stringify(envInfo, null, 2)
    .replace(/[&]/g, '&amp;')
    .replace(/[<]/g, '&lt;');
  return res.end(`<!doctype html><html><head><meta charset=utf-8><title>PDF Extractor Backend – Fallback</title><style>
    :root { color-scheme: dark; }
    body{font-family:system-ui,Segoe UI,Arial,sans-serif;background:#0c1116;color:#e2e8f0;margin:0;padding:2rem;line-height:1.5;}
    h1{margin-top:0;font-size:1.55rem;letter-spacing:.5px;}
    h2{margin-top:2.2rem;font-size:1.05rem;text-transform:uppercase;letter-spacing:.08em;color:#93c5fd;}
    code{background:#1e293b;padding:.15rem .4rem;border-radius:4px;font-size:.85rem;}
    pre{background:#0f172a;padding:1rem;border-radius:8px;overflow:auto;font-size:.8rem;}
    a{color:#60a5fa;text-decoration:none;}a:hover{text-decoration:underline;}
    ul{margin:.4rem 0 1rem 1.1rem;padding:0;}li{margin:.25rem 0;}
    .pill{display:inline-block;background:#1e293b;padding:.25rem .6rem;border-radius:999px;font-size:.7rem;text-transform:uppercase;letter-spacing:.1em;margin-left:.5rem;color:#93c5fd;}
    .warn{color:#fbbf24;}
    .ok{color:#34d399;}
  </style></head><body>
  <h1>PDF Extraction Service <span class="pill">Fallback</span></h1>
  <p class="warn">No <code>index.html</code> UI was found inside <code>${frontendDir}</code> at runtime. You're viewing the embedded fallback page.</p>
  <p>To replace this page, ensure one of these exists at deploy time (with <code>index.html</code>):</p>
  <ol>
    <li><code>backend/frontend_build/</code> (preferred copied build output)</li>
    <li><code>backend/frontend/build/</code> (CRA / Vite build)</li>
    <li><code>backend/frontend/</code> (raw static assets)</li>
  </ol>
  <h2>Primary API Endpoints</h2>
  <ul>
    <li><code>/health</code> – liveness probe</li>
    <li><code>/version</code> – build metadata</li>
    <li><code>/upload</code> – multipart PDF upload (field <code>file</code>)</li>
    <li><code>/process</code> – POST JSON <code>{ id }</code> to generate report</li>
    <li><code>/reports</code> – list processed reports</li>
    <li><code>/report/:id</code> – fetch single report</li>
    <li><code>/export/:id?format=csv|json</code> – export data</li>
    <li><code>/__diag</code> – diagnostics (frontend detection)</li>
  </ul>
  <h2>Current Deployment Diagnostics</h2>
  <pre>${diagPre}</pre>
  <h2>Next Steps To Show Real UI</h2>
  <ol>
    <li>Add or update <code>backend/frontend/index.html</code> (or build output) locally.</li>
    <li>Commit: <code>git add backend/frontend && git commit -m "add embedded ui"</code></li>
    <li>Push: <code>git push</code></li>
    <li>Trigger a new deploy (Render will auto-build or use GitHub Action). If using Docker, make sure build cache is cleared.</li>
    <li>Refresh this page. The fallback banner should disappear.</li>
  </ol>
  <p>Timestamp: <code>${now}</code></p>
  <p style="margin-top:3rem;font-size:.7rem;opacity:.6">If this timestamp doesn't change after a redeploy, the old container/image is still running.</p>
  </body></html>`);
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

// Diagnostic: log registered top-level GET routes to ensure '/' is present (Render debugging)
// Exportable so bootstrap.js can reuse
function logRegisteredRoutes(){
  try {
    const routes = [];
    app._router.stack.forEach(layer => {
      if(layer.route && layer.route.path){
        const methods = Object.keys(layer.route.methods).filter(m=>layer.route.methods[m]);
        routes.push(methods.join(',').toUpperCase() + ' ' + layer.route.path);
      } else if(layer.name === 'router' && layer.handle && layer.handle.stack){
        layer.handle.stack.forEach(r => {
          if(r.route && r.route.path){
            const methods = Object.keys(r.route.methods).filter(m=>r.route.methods[m]);
            routes.push(methods.join(',').toUpperCase() + ' ' + (layer.regexp?.source || '') + r.route.path);
          }
        });
      }
    });
    console.log('[startup] Registered routes count=' + routes.length);
    const sample = routes.filter(r=>r.includes('GET')).slice(0, 25);
    console.log('[startup] First GET routes:', sample);
    if(!routes.some(r=>r.startsWith('GET / ')) && !routes.some(r=>r === 'GET /')){
      console.warn('[startup] WARNING: root GET / route not detected in route stack');
    }
  } catch(e){
    console.warn('[startup] route introspection failed', e.message);
  }
}

app.use(notFoundHandler);
// 404 path logger (after notFoundHandler to avoid interfering with JSON error response)
app.use((req,res,next)=>{ if(res.statusCode===404){ console.warn('[404]', req.method, req.originalUrl); } next(); });
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
export { app, startServer, logRegisteredRoutes };

// Only auto-start if this file is the entry point (not imported by a test script)
const isDirect = process.argv[1] && path.basename(process.argv[1]) === 'server.js';
if (isDirect) {
  const { server } = startServer();
  // Delay a tick to allow routes to register fully then log
  setTimeout(logRegisteredRoutes, 300);
}
