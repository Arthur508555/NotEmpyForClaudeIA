const http = require("http");
const fs = require("fs");
const path = require("path");
const { obfuscate } = require("./src/obfuscador");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Payload muito grande."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const clean = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = path.normalize(path.join(ROOT, clean));
  if (!file.startsWith(ROOT)) return send(res, 403, "Forbidden", "text/plain");
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, "Not found", "text/plain");
    send(res, 200, data, MIME[path.extname(file)] || "application/octet-stream");
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/obfuscate") {
      const body = await readBody(req);
      const input = JSON.parse(body || "{}");
      const result = obfuscate(String(input.code || ""), {
        name: String(input.name || "chunk"),
        complexity: String(input.complexity || "high"),
        debug: Boolean(input.debug)
      });
      return send(res, 200, JSON.stringify(result));
    }
    if (req.method === "GET") return serveStatic(req, res);
    return send(res, 405, JSON.stringify({ ok: false, error: "Metodo nao permitido." }));
  } catch (error) {
    return send(res, 400, JSON.stringify({ ok: false, error: error.message }));
  }
});

server.listen(PORT, () => {
  console.log(`Obf-CC rodando em http://localhost:${PORT}`);
});
