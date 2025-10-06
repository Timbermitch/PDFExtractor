import path from 'path';
import fs from 'fs';

export function notFoundHandler(req, res, next) {
  // If requesting HTML (no extension) attempt to serve frontend index for SPA-like behavior
  const accept = req.headers.accept || '';
  const isHtmlPref = accept.includes('text/html');
  const hasExt = path.extname(req.path) !== '';
  if(isHtmlPref && !hasExt){
    const idx = path.join(process.cwd(), 'frontend', 'index.html');
    if(fs.existsSync(idx)){
      return res.sendFile(idx);
    }
  }
  res.status(404).json({ error: 'Not Found' });
}

export function errorHandler(err, req, res, next) { // eslint-disable-line
  console.error('Error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Server Error' });
}

export function requireBody(fields) {
  return function(req, res, next) {
    const missing = fields.filter(f => !(f in req.body));
    if (missing.length) {
      return res.status(400).json({ error: 'Missing fields', missing });
    }
    next();
  };
}
