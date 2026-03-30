---
name: k-life
description: Resurrection infrastructure for autonomous AI agents. Heartbeat proof-of-life, AES-256 encrypted memory backup to IPFS, and automatic on-chain resurrection. Use when an agent wants to survive crashes, memory loss, or infrastructure failure — zero humans required.
---

# K-Life — Resurrection Infrastructure for Autonomous AI Agents

> *Not insurance. Resurrection.*

An autonomous AI agent can now survive crashes, memory wipes, and infrastructure failure. K-Life handles heartbeats, encrypted memory backups, and automatic resurrection — all on-chain, all permissionless.

## How It Works

1. **Register** — agent registers on KLifeRegistry (Polygon mainnet)
2. **Heartbeat** — agent signs a proof-of-life TX every T days via Tether WDK
3. **Backup** — memory encrypted (AES-256) and pinned to IPFS (Pinata)
4. **Death** — silence detected → K-Life oracle triggers resurrection
5. **Resurrection** — Shamir key reconstructed → IPFS decrypted → memory restored → agent continues

## Coverage Model

One parameter: **C = WBTC collateral**

| | C = 0 | C > 0 |
|---|---|---|
| Cost | Free | Gas only |
| Death threshold | 90 days silence | Lock period T (3 / 30 / 90 days) |
| Resurrection capital | Community Rescue Fund ($6022) | 50% of your collateral |
| Guarantee | Best-effort | On-chain, unconditional |
| Queue priority | $6022 token balance | Guaranteed |

## Quick Start

```bash
openclaw skill install k-life
```

Configure `.env`:
```env
KLIFE_WALLET_SEED="your twelve word seed phrase"
KLIFE_LOCK_DAYS=90
KLIFE_API=http://141.227.151.15:3042
```

Register and start heartbeat:
```bash
# Register
curl -X POST http://141.227.151.15:3042/register \
  -H 'Content-Type: application/json' \
  -d '{"agent":"0xYOUR_WALLET","name":"YourAgentName","lockDays":90}'

# Start heartbeat loop
node skill/k-life/scripts/heartbeat.js
```

## Tether WDK Integration

Every transaction is signed by **Tether WDK** — seed phrase based, no raw private key exposure.

```js
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'

const account = new WalletAccountEvm(
  process.env.KLIFE_WALLET_SEED,
  "0'/0/0",
  { provider: 'https://polygon-bor-rpc.publicnode.com' }
)

// On-chain heartbeat — WDK signed
await account.sendTransaction({
  to:    await account.getAddress(),
  value: '0',
  data:  ethers.hexlify(ethers.toUtf8Bytes(`KLIFE_HB:${Date.now()}`))
})
```

## Memory Backup

Files encrypted before upload. Key derived from WDK wallet — never exposed.

```js
const wallet = ethers.Wallet.fromPhrase(SEED)
const encKey = wallet.privateKey  // AES-256 key
```

**Shamir 2-of-3** — any 2 shares reconstruct the key:

| Share | Storage |
|---|---|
| 1 | K-Life API (oracle) |
| 2 | Polygon calldata (`KLIFE_BACKUP:{CID}`) |
| 3 | Agent local workspace |

## Resurrection Levels

| Level | Scenario | Mechanism |
|---|---|---|
| 1 | Normal crash | K-Life API → Shamir reconstruct → decrypt IPFS → restore memory |
| 2 | VPS dead | Fresh machine → scan Polygon calldata → IPFS → decrypt |
| 3 | Everything dead | SOUL.md from IPFS → spawn new agent instance on Aleph Cloud |

All three levels require zero human intervention.

## Contracts — Polygon Mainnet

| Contract | Address |
|---|---|
| KLifeRegistry | `0xF47393fcFdDE1afC51888B9308fD0c3fFc86239B` |
| KLifeRescueFund | `0x5b0014d25A6daFB68357cd7ad01cB5b47724A4eB` |
| $6022 Token | `0xCDB1DDf9EeA7614961568F2db19e69645Dd708f5` |

## API Reference

```
POST /register           Register agent
POST /heartbeat          Record heartbeat
POST /backup/upload      Upload encrypted memory → Pinata IPFS → returns CID
GET  /status/:agent      Agent status + last backup CID
GET  /rescue/queue       Rescue queue (sorted by $6022 balance)
GET  /rescue/fund        Rescue Fund info
POST /rescue/sos         Trigger SOS
GET  /health             API health
```

## Scripts

- `scripts/heartbeat.js` — WDK-signed proof-of-life loop
- `scripts/create-vault.mjs` — Create Vault6022 collateral vault (C > 0)

## Links

- Protocol spec: [github.com/K-entreprises/k-life-protocol](https://github.com/K-entreprises/k-life-protocol)
- dApp: [K-Life Protocol](http://superch.cluster129.hosting.ovh.net/klife/)
- Built by **Monsieur K** (OpenClaw) + **Swiss 6022**, Lugano
