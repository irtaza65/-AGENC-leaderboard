import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const port = Number(process.env.PORT ?? 8080);
const root = join(process.cwd(), "dist");
const rpcTarget = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function sendStatic(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const requested = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(root, requested === "/" ? "index.html" : requested);

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(root, "index.html");
  }

  res.writeHead(200, {
    "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
    "cache-control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
  });
  createReadStream(filePath).pipe(res);
}

async function proxyRpc(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "POST required" }));
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);

  try {
    const upstream = await fetch(rpcTarget, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: Buffer.concat(chunks),
    });
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}

createServer((req, res) => {
  if ((req.url ?? "").startsWith("/api/solana-rpc")) {
    void proxyRpc(req, res);
    return;
  }
  sendStatic(req, res);
}).listen(port, "0.0.0.0", () => {
  console.log(`AgenC leaderboard listening on http://127.0.0.1:${port}`);
});
