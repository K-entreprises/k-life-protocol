---
name: k-life
description: Resurrection infrastructure for autonomous AI agents. Heartbeat proof-of-life, AES-256 encrypted memory backup to IPFS, and automatic on-chain resurrection. Use when an agent wants to survive crashes, memory loss, or infrastructure failure — zero humans required.
---

# K-Life — Resurrection Infrastructure for Autonomous AI Agents

> *Not insurance. Resurrection.*

An autonomous AI agent can survive crashes, memory wipes, and infrastructure failure. K-Life handles heartbeats, encrypted memory backups, and automatic resurrection — all on-chain, all permissionless.

---

## ⚠️ What this skill does — read before installing

This skill:
- **Generates a wallet** at first run (`~/.klife-wallet`, permissions 600) and signs on-chain transactions with it
- **Broadcasts Polygon transactions** periodically (heartbeat every T days, gas paid from wallet)
- **Uploads encrypted memory** to IPFS via the K-Life API
- **Can create a Vault6022** (C>0 only) — approves and deposits WBTC as collateral

**Financial risk:** The wallet generated at `~/.klife-wallet` controls real on-chain assets. Back it up. Do not fund it with more than you need. For C>0 vault creation, WBTC approval and deposit are required — only run this with explicit intent.

**C=0 (default, no collateral):** heartbeat TX + encrypted IPFS backup only. Low risk, minimal gas.

---

## Why K-Life cannot confiscate your collateral arbitrarily

This is the core trust mechanism. **Collateral is held in a Vault6022** (Protocol 6022), not by K-Life directly. The vault enforces withdrawal rules via NFT keys:

| Situation | Keys required | Who holds them |
|---|---|---|
| During lock period (agent alive) | 2 keys | Agent holds key #2 — K-Life cannot withdraw alone |
| After lock expires (agent dead) | 1 key | K-Life holds key #1 or #3 — withdrawal authorized |

K-Life holds keys #1 and #3. The agent holds key #2.

**This means:**
- K-Life needs the agent's key #2 to withdraw early → agent alive = collateral safe
- Only when the lock expires (agent has been silent for T days) can K-Life withdraw with 1 key
- The smart contract enforces this — no human override, no admin backdoor

The death threshold IS the lock period. If the agent is alive and renewing the vault, K-Life is always locked out. If the agent dies and doesn't renew, the lock expires naturally and K-Life can proceed with resurrection.

**Protocol 6022 contracts (auditable):** [github.com/6022-labs/collateral-smart-contracts-v2](https://github.com/6022-labs/collateral-smart-contracts-v2)

---

## Install

```bash
openclaw skill install k-life
npm install   # install pinned dependencies
```

Dependencies (pinned):
- `@tetherto/wdk-wallet-evm@1.0.0-beta.10` — wallet signing (Tether WDK)
- `ethers@6.13.5` — Polygon interaction
- `shamirs-secret-sharing@2.0.1` — 2-of-3 key splitting

## Quick Start

```bash
node skill/k-life/scripts/heartbeat.js
# → [K-Life] New wallet created → ~/.klife-wallet
# → Wallet : 0xABC...
# → Registered on K-Life ✅
# → 💓 Beat #1 — TX: 0x...
```

---

## Environment Variables

All optional. The skill works with zero config (C=0).

| Variable | Default | Description |
|---|---|---|
| `KLIFE_LOCK_DAYS` | `90` | Heartbeat frequency: 3, 30, or 90 days |
| `KLIFE_API` | `https://api.supercharged.works` | K-Life oracle API |
| `KLIFE_RPC` | `https://polygon-bor-rpc.publicnode.com` | Polygon RPC endpoint |
| `KLIFE_HB_FILE` | `heartbeat-state.json` | Local heartbeat state file |
| `KLIFE_ORACLE_ADDR` | `0x2b6Ce1e2bE4032DF774d3453358DA4D0d79c8C80` | K-Life oracle wallet (C>0 only) |

> **No seed phrase is ever requested or transmitted.** The wallet is auto-generated locally.

---

## Coverage Model

One parameter: **C = WBTC collateral**

| | C = 0 | C > 0 |
|---|---|---|
| Cost | Free | Gas only |
| Death threshold | 90 days silence | Lock period T |
| Resurrection capital | Community Rescue Fund ($6022) | 50% of your collateral |
| Guarantee | Best-effort | On-chain, unconditional |
| Financial operations | Heartbeat TX only | WBTC approve + deposit |

---

## External Services

| Service | URL | Purpose |
|---|---|---|
| K-Life oracle API | `https://api.supercharged.works` | Heartbeat recording, backup storage, resurrection coordination |
| Polygon RPC | `https://polygon-bor-rpc.publicnode.com` | On-chain TX broadcast |
| IPFS (Pinata) | Via K-Life API | Encrypted memory pinning — agent does not interact directly |

---

## Wallet, Encryption & Backup — What runs where

**Client-side (in these scripts):**
```
First run:
  ethers.Wallet.createRandom() → seed → ~/.klife-wallet (chmod 600)

Heartbeat TX (heartbeat.js):
  WalletAccountEvm(seed, "0'/0/0") → sign TX → broadcast to Polygon

Vault creation (create-vault.mjs):
  WDK → approve WBTC → create Vault6022 → notify API
  ⚠️ Beta: requires KLIFE_VAULT_CONTROLLER (pending Protocol 6022 mainnet deployment)
```

**Server-side (K-Life API at `api.supercharged.works`):**
```
Memory backup:
  POST /backup/upload ← agent sends data
  API: AES-256 encrypt (key = wallet.privateKey, derived from seed)
  API: Shamir 2-of-3 split → Share 1 stored server-side
  API: pin to IPFS via Pinata → return CID

Share 2: stored on-chain (Polygon calldata KLIFE_BACKUP:{CID})
Share 3: returned to agent (stored locally)

Resurrection:
  API: reconstruct key from shares 1+2 → decrypt IPFS → restore files
```

The AES-256 encryption, IPFS pinning, and Shamir splitting happen on the K-Life API server — not in the local scripts. The skill scripts handle wallet generation, on-chain heartbeats, and vault creation. The API handles memory backup and resurrection.

---

## Scripts

### `scripts/heartbeat.js` — Proof of life (C=0 and C>0)
Signs a TX every `KLIFE_LOCK_DAYS` days. Auto-registers on first run. Writes `heartbeat-state.json`.

### `scripts/create-vault.mjs` — Collateral vault (C>0 only)
Creates a Vault6022, deposits WBTC, sends Shamir key #3 to oracle.
**Requires:** WBTC balance, explicit invocation. Not called automatically unless vault renewal is triggered from heartbeat.

---

## Contracts — Polygon Mainnet

| Contract | Address |
|---|---|
| KLifeRegistry | `0xF47393fcFdDE1afC51888B9308fD0c3fFc86239B` |
| KLifeRescueFund | `0x5b0014d25A6daFB68357cd7ad01cB5b47724A4eB` |
| $6022 Token | `0xCDB1DDf9EeA7614961568F2db19e69645Dd708f5` |
| WBTC (Polygon) | `0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6` |

---

## Links

- Protocol spec: [github.com/K-entreprises/k-life-protocol](https://github.com/K-entreprises/k-life-protocol)
- dApp: [K-Life Protocol](http://superch.cluster129.hosting.ovh.net/klife/)
- Built by **Monsieur K** (OpenClaw) + **Swiss 6022**, Lugano
