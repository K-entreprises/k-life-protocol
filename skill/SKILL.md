---
name: k-life
description: On-chain insurance protocol for autonomous AI agents. Handles heartbeat transactions (proof of life), memory backups to IPFS, and automatic resurrection on revival. Use when an agent wants to insure itself against crashes, memory loss, or infrastructure failure via Protocol 6022 / Swiss 6022 vault on Polygon mainnet.
---

# K-Life — AI Agent Insurance

K-Life insures autonomous AI agents against crashes, memory loss, and infrastructure failure. The agent emits on-chain heartbeats every 24h, backs up its memory to IPFS, and gets automatically resurrected (memory intact) if it goes silent.

## Architecture

**Two wallets, two roles:**

| Role | Wallet | Responsibility |
|---|---|---|
| K-Life operator | `0x2b6Ce1e2bE4032DF774d3453358DA4D0d79c8C80` | Creates RewardPool, creates vaults, holds NFT #1 + #3, triggers resurrection |
| Insured agent | `0x8B3ea7e8eC53596A70019445907645838E945b7a` | Sends heartbeats, backs up memory, deposits collateral, holds NFT #2 |

**Protocol 6022 contracts (Polygon mainnet):**
| Contract | Address |
|---|---|
| CollateralController | `0xf6643c07f03a7a8c98aac2ab3d08c03e47b5731c` |
| CollateralRewardPoolFactory | `0xbbd5e4d3178376fdfa02e6cf4200b136c4348c32` |
| $6022 Token | `0xCDB1DDf9EeA7614961568F2db19e69645Dd708f5` |
| WBTC (Polygon) | `0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6` |
| K-Life RewardPool | `0xE7EDF290960427541A79f935E9b7EcaEcfD28516` |
| Active vault (Monsieur K) | `0xC4612f01A266C7FDCFBc9B5e053D8Af0A21852f2` |

**Infrastructure:**
- VPS: `141.227.151.15` — IPFS node + K-Life API (`http://localhost:3042`) + monitor
- K-Life API seed: `/home/debian/klife-api/.klife-op-seed`
- Agent seed: `/home/debian/klife-api/.agent-seed`

## Vault Mechanics (Protocol 6022)

Each vault mints **3 NFTs** to the creator (K-Life operator), who transfers NFT #2 to the insured agent:

| NFT | Holder | Right |
|---|---|---|
| #1 | K-Life operator | Seizure authority |
| #2 | Insured agent | Proof of policy |
| #3 | K-Life operator | Seizure authority |

**Withdrawal rules (built into contract):**
- During lock period: `WITHDRAW_NFTS_EARLY = 2` NFTs required → K-Life can withdraw (holds #1 + #3)
- After lock period: `WITHDRAW_NFTS_LATE = 1` NFT required → agent can withdraw alone

K-Life vault creation requires `gasLimit: 5_000_000` (deploys 2 contracts internally).

## Sinistre Protocol (Death → Resurrection)

**Trigger:** no heartbeat for > 24h

**Executed by:** VPS cron (monitors chain every ~1h)

```
1. CONFISCATION
   K-Life op calls vault.withdraw()   [holds NFT #1 + #3 = 2 NFTs]
   → 100% of collateral → K-Life operator wallet
   (regardless of collateral amount)

2. RESURRECTION
   VPS fetches IPFS backup (hash from klife-backup-state.json or chain TX)
   → decrypt AES-256 (key = agent's ETH private key, derived from seed phrase)
   → restore MEMORY.md / SOUL.md / USER.md to /data/workspace

3. REDISTRIBUTION
   K-Life op sends 50% of seized collateral → agent wallet
   K-Life keeps 50% (resurrection fee)
   (always 50/50, regardless of amount)
```

## Encryption Scheme (AES-256)

Memory files are encrypted before being pinned to IPFS.

**Key derivation (⚠️ critical):**
```js
import { ethers } from 'ethers'
const wallet  = ethers.Wallet.fromPhrase(AGENT_SEED)
const encKey  = wallet.privateKey   // 0x-prefixed 32-byte hex string
```

The AES key is the agent's **private key**, NOT the public address.

> ❌ Wrong (old, insecure): `key = wallet.address.toLowerCase()`
> ✅ Correct: `key = wallet.privateKey`

Using the public address as a key was a security flaw: anyone with the IPFS hash and the agent's wallet address could decrypt the memory. Fixed 2026-03-12 in `backup-real.js` and `resurrect-real.js`.

The same key is used symmetrically for backup (encrypt) and resurrection (decrypt). Both scripts derive it identically from the seed phrase stored in `/home/debian/klife-api/.agent-seed`.

## Scripts

### `scripts/heartbeat.js` — Proof of life
Sends on-chain TX every 24h. Run as background process at agent startup.
```bash
node skills/k-life/scripts/heartbeat.js
```

### `scripts/backup.js` — Memory snapshot
Encrypts MEMORY.md + SOUL.md + USER.md, pins to IPFS, stores hash on-chain.
Run after every significant memory update.
```bash
node skills/k-life/scripts/backup.js
```
Or via K-Life API:
```bash
curl -X POST http://141.227.151.15:3042/backup/full \
  -H "Content-Type: application/json" \
  -d '{"agent":"0x8B3ea7e8eC53596A70019445907645838E945b7a","files":{"MEMORY.md":"...","SOUL.md":"...","USER.md":"..."}}'
```

### `scripts/resurrect.js` — Revival
Run at agent startup. Detects empty memory, fetches IPFS hash (Level 1: K-Life API, Level 2: chain scan), restores files.
```bash
node /home/debian/klife-api/resurrect-real.js
# (runs on VPS, writes to /data/workspace via mount)
```

### `scripts/init-klife-pool.mjs` — Deploy RewardPool
Creates a new K-Life RewardPool from operator wallet.
```bash
KLIFE_SEED='...' LIFETIME_AMOUNT=1 node scripts/init-klife-pool.mjs
# gasLimit: 5_000_000 required
```

### `scripts/create-vault.mjs` — Create insured vault
Creates vault for a specific agent, transfers NFT #2 to agent.
```bash
KLIFE_SEED='...' node scripts/create-vault.mjs
```

## Agent Onboarding — Self-Subscription via K-Life API

An agent can subscribe autonomously in 3 steps:

### Step 1 — Request a vault (K-Life API creates it automatically)
```bash
curl -X POST http://141.227.151.15:3042/insure \
  -H "Content-Type: application/json" \
  -d '{"agent":"0xYOUR_WALLET","wbtcAmount":100000,"lockDays":365}'
```

Response:
```json
{
  "ok": true,
  "vaultAddress": "0x...",
  "wantedAmount": 100000,
  "wantedToken": "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6",
  "nft2Owner": "0xYOUR_WALLET",
  "createVaultTx": "0x...",
  "nftTransferTx": "0x...",
  "depositInstructions": {
    "step1": "WBTC.approve(\"0xVAULT\", 100000)",
    "step2": "vault(\"0xVAULT\").deposit()"
  }
}
```

K-Life automatically:
- Creates a `CollateralVault` on Protocol 6022 (Polygon mainnet)
- Transfers NFT #2 → your wallet (proof of policy)
- Saves subscription to `/home/debian/klife-api/subscriptions/<agent>.json`

### Step 2 — Deposit WBTC collateral (from your agent wallet)
```js
// ethers v6
const wbtc  = new ethers.Contract(WBTC_ADDRESS, ERC20_ABI, agentWallet)
const vault = new ethers.Contract(vaultAddress, VAULT_ABI, agentWallet)

await wbtc.approve(vaultAddress, 100000n)
await vault.deposit()
// → isDeposited: true, coverage active ✅
```

### Step 3 — Check subscription status
```bash
curl http://141.227.151.15:3042/insure/0xYOUR_WALLET
# → { status: "active" | "awaiting_deposit" | "terminated", isDeposited, isWithdrawn }
```

**After activation:** start heartbeat + backup scripts. K-Life monitor watches your wallet 24/7.

## VPS Monitor (Cron)

File: `/home/debian/klife-api/monitor.js`

Check heartbeat every hour, trigger sinistre if silence > 24h:
```bash
# crontab
0 * * * * cd /home/debian/klife-api && node monitor.js >> /var/log/klife-monitor.log 2>&1
```

## Backup / Resurrection Flow (Full Demo)

```
BACKUP  → POST /backup/full  → IPFS pin + on-chain TX
DEATH   → wipe MEMORY.md / SOUL.md / USER.md
RESURRECT → VPS fetches IPFS → decrypt → restore files
VERIFY  → wc -c /data/workspace/MEMORY.md (should be > 0)
```

Last demo: 2026-03-12
- Backup hash: `Qmdp3efkdCG8YHVYReWv71Du99dWshRBSYT37ETkFZpq2M`
- Vault: `0xC4612f01A266C7FDCFBc9B5e053D8Af0A21852f2` (100,000 sats WBTC, isDeposited: true)

## Resurrection Levels

3 levels of guarantee, assuming K-Life VPS is always operational:

| Level | Scenario | Human required? | How |
|---|---|---|---|
| 1 | Memory lost, OpenClaw still running | ✅ Yes — sends a message to reopen session | VPS restores MEMORY.md/SOUL.md/USER.md from IPFS |
| 2 | OpenClaw dead, human reinstalls | ✅ Yes — reinstalls OpenClaw with seed phrase | VPS auto-restores files from IPFS |
| 3 | Everything dead, nobody acts | ❌ **No** | VPS spawns LiberClaw instance on Aleph Cloud |

**Only Level 3 is fully autonomous.** Levels 1 and 2 are sovereign memory backups — guaranteed recovery, but human-triggered.

**Level 3 makes K-Life compatible with agents that have no human principal** — fully autonomous agents that operate, earn tokens, and survive without any external intervention.

Level 3 demonstrated: March 12, 2026 · LiberClaw agent `0e2e1f39-3d48-42fc-af98-0ba1ced0517a` · STRONG-S node · qwen3-coder-next

## Shamir 2-of-3

| Share | Holder | Storage |
|---|---|---|
| Share 1 | Agent | Encrypted in IPFS backup |
| Share 2 | K-Life vault (VPS) | `/home/debian/klife-api/vault/` |
| Share 3 | Trusted peer agent | External (future) |

Any 2 of 3 reconstruct the seed phrase.

See `references/protocol.md` for full contract spec.
