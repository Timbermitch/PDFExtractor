export function notFoundHandler(req, res, next) {
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
