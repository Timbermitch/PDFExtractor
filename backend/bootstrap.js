// Explicit bootstrap entrypoint to aid deployment debugging on platforms like Render.
// Provides loud diagnostics about environment, working directory, files, and route registration.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { startServer, app } from './server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function listDir(p, depth=0){
  try {
    const entries = fs.readdirSync(p).slice(0, 40);
    return entries.map(e => {
      const full = path.join(p,e);
      const stat = (()=>{ try { return fs.statSync(full);} catch{ return null; }})();
      return {
        name: e,
        type: stat ? (stat.isDirectory()? 'dir':'file') : 'missing',
        size: stat && stat.isFile()? stat.size : undefined
      };
    });
  } catch (e){
    return [{ error: e.message }];
  }
}

function snapshot(){
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd,'frontend_build','index.html'),
    path.join(cwd,'frontend','build','index.html'),
    path.join(cwd,'frontend','index.html'),
    path.join(cwd,'..','frontend','index.html')
  ];
  return {
    timestamp: new Date().toISOString(),
    node: process.version,
    pid: process.pid,
    argv: process.argv,
    cwd,
    bootstrapDir: __dirname,
    envSubset: Object.fromEntries(['NODE_ENV','PORT','GIT_SHA','BUILD_TIME','KEEP_ALIVE'].map(k=>[k, process.env[k]||null])),
    candidateFrontend: candidates.map(f => ({ file: f, exists: fs.existsSync(f) })),
    cwdListing: listDir(cwd),
    backendListing: listDir(__dirname),
  };
}

console.log('[bootstrap] starting diagnostics');
console.log('[bootstrap] snapshot', JSON.stringify(snapshot(), null, 2));

// Start server explicitly (do not rely on server.js auto-start when imported)
const { server, port } = startServer();

function reportRoutes(){
  try {
    const layers = app._router?.stack || [];
    const routes = [];
    layers.forEach(l => {
      if(l.route && l.route.path){
        const methods = Object.keys(l.route.methods).filter(m=>l.route.methods[m]);
        routes.push({ path: l.route.path, methods });
      }
    });
    console.log('[bootstrap] routeCount=' + routes.length);
    console.log('[bootstrap] firstRoutes=', routes.slice(0,20));
    if(!routes.some(r=>r.path === '/health')){
      console.warn('[bootstrap] WARNING: /health route not found in registered routes!');
    }
  } catch(e){
    console.warn('[bootstrap] route introspection failed', e.message);
  }
}

setTimeout(reportRoutes, 400);
setTimeout(() => {
  console.log('[bootstrap] second route sample after 2s (post async imports)');
  reportRoutes();
}, 2000);

server.on('listening', () => {
  console.log(`[bootstrap] server listening on port ${port}`);
});

// Keep process alive; periodic heartbeat
setInterval(()=>process.stdout.write('#'), 15000).unref();
