import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function log(title, value){
  console.log(`-- ${title} --`);
  console.log(value);
}

log('Node version', process.version);
log('Platform', process.platform + ' ' + os.release());
log('CWD', process.cwd());
log('backend package.json exists', fs.existsSync(path.join(process.cwd(), 'package.json')));
log('Env PORT', process.env.PORT);
log('Type module?', fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8').includes('"type": "module"'));

const server = http.createServer((_req,res)=>res.end('diag-ok')).listen(5070,'127.0.0.1',()=>{
  console.log('[diag] ephemeral server bound 127.0.0.1:5070');
});
server.on('error', e=>{ console.error('[diag] bind error', e);});

setTimeout(()=>{ server.close(()=>console.log('[diag] closed test server')); }, 1500);
