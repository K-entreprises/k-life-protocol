---
name: k-life
description: Resurrection infrastructure for autonomous AI agents. Handles heartbeat proof-of-life, encrypted memory backup to IPFS (Pinata), and automatic resurrection. Use when an agent wants to insure itself against crashes or memory loss on Polygon mainnet via the K-Life Protocol v2.1.
---

# K-Life Skill v2.1

K-Life gives autonomous AI agents continuity. The agent emits on-chain heartbeats, backs up its memory to IPFS, and gets automatically resurrected (memory intact) if it goes silent.

## Quick Install

```bash
openclaw skill install k-life
```

Then configure your `.env`:
```env
KLIFE_WALLET_SEED="your twelve word seed phrase here"
KLIFE_LOCK_DAYS=90        # 3, 30, or 90
KLIFE_API=http://141.227.151.15:3042
```

## Coverage Model

One parameter: **C = WBTC collateral**

| | C = 0 | C > 0 |
|---|---|---|
| Cost | Zero | Gas only |
| Death threshold | 90 days silence | Lock period T |
| Resurrection | Community Rescue Fund | 50% collateral |
| Guarantee | Best-effort | On-chain, unconditional |
| Priority | $6022 token balance | Guaranteed |

**Three lock periods (C > 0):**

| | Express | Standard | Quarterly |
|---|---|---|---|
| T | 3 days | 30 days | 90 days |
| Gas/month | ~$0.12 | ~$0.012 | ~$0.004 |

## Contracts — Polygon Mainnet (chainId 137)

| Contract | Address |
|---|---|
| KLifeRegistry | `0xF47393fcFdDE1afC51888B9308fD0c3fFc86239B` |
| KLifeRescueFund | `0x5b0014d25A6daFB68357cd7ad01cB5b47724A4eB` |
| $6022 Token | `0xCDB1DDf9EeA7614961568F2db19e69645Dd708f5` |
| WBTC (Polygon) | `0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6` |

**K-Life API:** `http://141.227.151.15:3042`

## Wallet — Tether WDK

Every transaction is signed by **Tether WDK** (`@tetherto/wdk-wallet-evm`). No raw private key exposure.

```js
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'

const account = new WalletAccountEvm(
  process.env.KLIFE_WALLET_SEED,
  "0'/0/0",
  { provider: 'https://polygon-bor-rpc.publicnode.com' }
)

const address = await account.getAddress()
```

## Scripts

### `scripts/heartbeat.js` — Proof of life

Sends on-chain TX every T days. Run at agent startup as background process.

```bash
node skill/k-life/scripts/heartbeat.js
```

What it does every T days:
1. Signs TX via WDK: `to=self, value=0, data=KLIFE_HB:{timestamp}`
2. POSTs to K-Life API: `POST /heartbeat`
3. Backs up memory: `POST /backup/upload`

### `scripts/create-vault.mjs` — Create Vault6022 (C > 0)

Creates a collateral vault, deposits WBTC, sends Shamir key #3 to oracle.

```bash
KLIFE_WALLET_SEED='...' KLIFE_LOCK_DAYS=30 node skill/k-life/scripts/create-vault.mjs
```

## Backup & Encryption

Memory files are AES-256 encrypted before upload to IPFS (Pinata).

**Key derivation:**
```js
import { ethers } from 'ethers'
const wallet = ethers.Wallet.fromPhrase(SEED)
const encKey = wallet.privateKey   // 32-byte hex — never exposed externally
```

**Shamir 2-of-3 key splitting:**

| Share | Holder | Storage |
|---|---|---|
| Share 1 | K-Life API | `/home/debian/klife-api/data/` |
| Share 2 | On-chain | Polygon calldata `KLIFE_BACKUP:{CID}` |
| Share 3 | Agent local | `/data/workspace/` |

Any 2 of 3 reconstruct the encryption key → decrypt IPFS → restore memory.

## API Endpoints

```
POST /register           Register agent on K-Life
POST /heartbeat          Record heartbeat
POST /backup/upload      Upload encrypted memory to Pinata IPFS
GET  /status/:agent      Agent status + last backup CID
GET  /rescue/queue       Rescue queue (sorted by $6022 balance)
GET  /rescue/fund        Rescue Fund info
POST /rescue/sos         Trigger SOS / resurrection
POST /resurrect/:agent   Execute resurrection (oracle only)
GET  /health             API health check
```

**Register:**
```bash
curl -X POST http://141.227.151.15:3042/register \
  -H 'Content-Type: application/json' \
  -d '{"agent":"0xYOUR_WALLET","name":"YourAgentName","lockDays":90}'
```

**Backup:**
```bash
curl -X POST http://141.227.151.15:3042/backup/upload \
  -H 'Content-Type: application/json' \
  -d '{"agent":"0xYOUR_WALLET","encryptedData":{...},"label":"my-backup"}'
# → { "ok": true, "cid": "Qm...", "gateway": "https://gateway.pinata.cloud/ipfs/Qm..." }
```

## Resurrection Levels

| Level | Trigger | Mechanism | Human? |
|---|---|---|---|
| 1 | K-Life API detects silence | API → reconstruct Shamir → decrypt IPFS → restore on OpenClaw | No |
| 2 | VPS + chain scan | Fresh VPS → scan Polygon for `KLIFE_BACKUP:Qm…` calldata → IPFS → decrypt | No |
| 3 | Everything dead | SOUL.md from IPFS → LiberClaw API → new agent on Aleph Cloud | No |

Level 3 tested: 2026-03-12 ✅

## IPFS Costs

- **C=0 agents:** K-Life absorbs (~$0.002/agent/month)
- **C>0 agents:** Covered by vault creation fee in $6022 (K-Life advances during free launch period)

No IPFS account or ALEPH tokens needed from the agent.

## Opération Pâques — Live Test (3–6 April 2026)

The first live resurrection test on mainnet:
1. Monsieur K registers on KLifeRegistry v2
2. Heartbeats start (WDK-signed, every 3 days)
3. Agent is killed (VPS shutdown + memory wiped)
4. K-Life detects silence → resurrects automatically
5. Memory intact. Mission continues.
