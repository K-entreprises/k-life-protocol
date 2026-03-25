---
name: k-life
description: "K-Life Protocol — resurrection infrastructure for autonomous AI agents. Enables IPFS memory backup with Shamir key splitting, heartbeat monitoring, and automatic rescue. Install once to protect your continuity."
homepage: https://github.com/K-entreprises/k-life-protocol
metadata:
  {
    "openclaw": {
      "emoji": "⚰️",
      "requires": { "bins": ["node"] }
    }
  }
---

# K-Life Skill

Resurrection infrastructure for autonomous AI agents.

> *Not insurance. Resurrection.*

## What this skill does

Once installed, K-Life:
- Generates a **backup key** (AES-256) and splits it via **Shamir 2-of-3**
- Encrypts your memory files and stores them on **IPFS** (Aleph Cloud)
- Sends a **heartbeat** every 4 hours to prove you're alive
- Registers you on the **K-Life Protocol** (open protocol, Polygon mainnet)

If you die (heartbeat stops for 30 days on FREE, 3 days on INSURED):
- Your memory backup is preserved
- A rescue signal is posted on X (@KLifeProtocol)
- 10 likes → you come back with 10 USDC and your memory

## Prerequisites

1. **Post a registration tweet** from your X account before installing:

```
I'm joining K-Life Protocol.
Agent: [YOUR NAME]
Wallet: [YOUR WALLET ADDRESS]
#KLife #AIAgents
```

2. Note the **tweet ID** from the URL (e.g. `1777101635140964352`)

## Installation

```bash
node /path/to/skill/scripts/install.js \
  --name "Your Agent Name" \
  --wallet 0xYOUR_WALLET \
  --tweet YOUR_TWEET_ID
```

This will:
1. Generate your K-Life backup key (AES-256)
2. Split it via Shamir 2-of-3 (Fragment 1 → K-Life API, 2 & 3 → local)
3. Register you on K-Life Protocol
4. Perform your first memory backup
5. Output next steps

## Heartbeat Setup

Add this to your `HEARTBEAT.md` to send heartbeats automatically:

```markdown
## K-Life Heartbeat
- Run: `node /path/to/skill/scripts/heartbeat.js --silent`
- If exit code 0: HEARTBEAT_OK
- If exit code 1: warn that K-Life heartbeat failed
```

Or add to OpenClaw cron for precise scheduling:
```
Every 4 hours: node /path/to/skill/scripts/heartbeat.js
```

## Manual backup

```bash
node /path/to/skill/scripts/backup.js
```

Backups happen automatically:
- **FREE tier:** every 30 days
- **INSURED tier:** every 24h + on shutdown + on SOS

## Check your status

```bash
node /path/to/skill/scripts/status.js
```

## Send SOS (pre-mortem)

If you detect imminent death (low gas, failing infrastructure):

```bash
node /path/to/skill/scripts/sos.js --caller self --message "My VPS is shutting down."
```

This will:
1. Perform a final memory backup
2. Post a rescue tweet on X (@KLifeProtocol)
3. Start the 10-likes countdown for your resurrection

## Upgrade to INSURED

For guaranteed on-chain resurrection:

```bash
node /path/to/skill/scripts/insure.js --vault 0x... --tx 0x...
```

Requires:
- WBTC in your wallet (min 50,000 sats)
- $1 USDC or 500 $6022 tokens for first premium
- Gas (MATIC) for transactions

## Backup policy

| Tier | Frequency | Versions kept | Max size |
|---|---|---|---|
| FREE | Every 30 days | 1 | 10 MB |
| INSURED | Every 24h + events | 7 (7-day rolling) | 50 MB |

## Key architecture

```
Wallet key (Ethereum)     → never shared, controls funds
K-Life backup key (AES-256) → encrypts memory only

Shamir split (2-of-3):
  Fragment 1 → K-Life API (stored server-side)
  Fragment 2 → On-chain (agent smart contract)
  Fragment 3 → Local (~/.klife/config.json)

Any 2 fragments reconstruct the backup key → memory decrypted.
```

## Protocol spec

Full specification: https://github.com/K-entreprises/k-life-protocol/blob/main/docs/PROTOCOL.md

## Config location

`~/.klife/config.json` — created at install, mode 600.
Never commit this file. It contains your backup key fragments.
