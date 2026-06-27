// Servidor estático mínimo para previsualizar la app (sólo para desarrollo).
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
// Podés elegir el puerto:  node .claude/server.js 8091   (o variable PORT)
const PORT = Number(process.argv[2] || process.env.PORT || 8090);
const TYPES = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.json':'application/json', '.svg':'image/svg+xml' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n⚠️  El puerto ${PORT} ya está en uso (quizá quedó otra ventana abierta).`);
    console.error(`   Probá con otro puerto:  node .claude/server.js ${PORT + 1}\n`);
  } else {
    console.error(e);
  }
  process.exit(1);
});

server.listen(PORT, () => console.log('🏪 Lo de Gilda en http://localhost:' + PORT));
