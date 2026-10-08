// Sends JSON gzip-compressed when the browser accepts it (all browsers do).
// The full potentials / leads lists are ~5 MB of JSON, right at Vercel's 4.5 MB response limit;
// gzip shrinks them ~10x, so the tabs keep loading as Zoho data grows.
const zlib = require('zlib');

function sendJson(req, res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  const accepts = String(req.headers['accept-encoding'] || '');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Vary', 'Accept-Encoding');
  if (body.length > 64 * 1024 && /\bgzip\b/.test(accepts)) {
    const gz = zlib.gzipSync(body, { level: 6 });
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', gz.length);
    res.statusCode = status;
    return res.end(gz);
  }
  res.setHeader('Content-Length', body.length);
  res.statusCode = status;
  return res.end(body);
}

module.exports = { sendJson };
