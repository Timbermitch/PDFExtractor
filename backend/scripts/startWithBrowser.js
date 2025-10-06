#!/usr/bin/env node
import { spawn } from 'child_process';
import open from 'open';
import path from 'path';

// Start the server with KEEP_ALIVE so it won't exit after first signal
const server = spawn(process.execPath, [path.join('backend','server.js')], {
  env: { ...process.env, KEEP_ALIVE: '1' },
  stdio: ['ignore','pipe','pipe']
});

server.stderr.on('data', d => {
  process.stderr.write(d);
});

server.stdout.on('data', d => {
  const line = d.toString();
  process.stdout.write(line);
  const m = line.match(/Server listening.*:(\d+) \(attempt/);
  if(m){
    tryOpenOnce(m[1]);
  }
});

let opened = false;

function tryOpenOnce(port){
  if(opened) return;
  opened = true;
  const uiPath = process.env.UI_PATH || '/';
  const url = `http://localhost:${port}${uiPath}`;
  open(url).catch(()=>{
    console.error('[startWithBrowser] Failed to auto-open browser. Open manually:', url);
  });
}

// Fallback: try default and fallback ports after delay if not yet opened.
setTimeout(() => { if(!opened) tryOpenOnce(5200); }, 1500);
setTimeout(() => { if(!opened) tryOpenOnce(5201); }, 4000);
setTimeout(() => { if(!opened) tryOpenOnce(5202); }, 5500);

server.on('exit', code => {
  console.log(`[startWithBrowser] server exited code=${code}`);
  if(!opened){
    console.log('[startWithBrowser] Server ended before browser could open.');
  }
});
