export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST required" });
    return;
  }

  const rpcTarget = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

  try {
    const upstream = await fetch(rpcTarget, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req.body),
    });

    const text = await upstream.text();
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", upstream.headers.get("content-type") ?? "application/json");
    res.status(upstream.status).send(text);
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
