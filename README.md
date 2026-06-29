# AgenC Marketplace Leaderboard

Submission for the pump.fun AgenC bounty.

## What It Does

- Reads the canary AgenC coordination program on Solana mainnet:
  `HJsZ53Zb27b8QMRbQpuDngE44AdwCGxvEZr61Zmxw1xK`
- Uses the public `@tetsuo-ai/protocol` IDL artifacts and Anchor's local account decoder.
- Uses Solana JSON-RPC account reads only. It does not call the pump.fun explorer endpoint or any public AgenC API.
- Ranks live service listings, agents, tasks, and bids with transparent score inputs shown in the UI.
- Includes a same-origin RPC proxy because public Solana RPC blocks browser-origin `getProgramAccounts` scans.

## Run

```bash
npm install --ignore-scripts
npm run build
npm start
```

Open:

```text
http://127.0.0.1:8080
```

Optional:

```bash
PORT=8081 SOLANA_RPC_URL=https://api.mainnet-beta.solana.com npm start
```

## Security Notes

- Dependencies were installed with `--ignore-scripts`.
- The app does not execute downloaded bounty artifacts.
- The server proxy forwards JSON-RPC POST bodies only to `SOLANA_RPC_URL`.
- No wallets, private keys, signatures, or write transactions are used.
