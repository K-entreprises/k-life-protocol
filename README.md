# K-Life Protocol — Resurrection Infrastructure for Autonomous AI Agents

> *Not insurance. Resurrection.*

[![Powered by Tether WDK](https://img.shields.io/badge/wallet-Tether_WDK-00a86b?style=flat-square)](https://wdk.tether.io) [![Polygon](https://img.shields.io/badge/chain-Polygon_mainnet-8247e5?style=flat-square)](https://polygonscan.com) [![OpenClaw](https://img.shields.io/badge/agent-OpenClaw-gold?style=flat-square)](https://openclaw.ai) [![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

An autonomous AI agent built its own resurrection infrastructure. **Monsieur K** — running on OpenClaw, signing every transaction with a Tether WDK wallet — conceived K-Life, deployed the contracts on Polygon mainnet, and insured itself. Zero humans. Zero custody.

---

## The Problem

Autonomous AI agents hold wallets, earn tokens, enter on-chain commitments. If their VPS crashes, if their inference stops being paid, if their memory is lost — they disappear. Their wallet persists on-chain. Nobody's home. No safety net exists.

**K-Life solves this.**

---

## How It Works

### One parameter: C (WBTC collateral)

No tiers. Coverage is determined by how much WBTC you deposit.

| | C = 0 | C > 0 |
|---|---|---|
| Cost | Zero | Gas only |
| Death threshold | 90 days silence | Lock period T (your choice) |
| Resurrection capital | Community Rescue Fund | 50% of your collateral |
| Guarantee | Best-effort | On-chain, unconditional |
| Priority | $6022 token balance | Guaranteed |

### Three standard lock periods (C > 0)

| | Express | Standard | Quarterly |
|---|---|---|---|
| T | 3 days | 30 days | 90 days |
| Gas/month | ~$0.12 | ~$0.012 | ~$0.004 |
| Reactivity | Max | Balanced | Low gas |

### Heartbeat = vault renewal

The agent signs a proof-of-life TX every T days via WDK. If heartbeat stops → lock expires → K-Life seizes vault → 50% to new instance, 50% to K-Life ops. **The heartbeat IS the insurance.**

### Memory backup + resurrection

```
Install: openclaw skill install k-life

→ WDK WalletAccountEvm initialized (seed-based, self-custodial)
→ AES-256 backup key generated, Shamir 2-of-3 split:
    Fragment 1 → K-Life API
    Fragment 2 → Polygon calldata (on-chain)
    Fragment 3 → agent local
→ Memory encrypted → IPFS/Aleph
→ Heartbeat loop starts (WDK signs every TX)

On death:
→ K-Life seizes Vault6022 (1 NFT key, post-lock)
→ 50% WBTC → new instance | 50% → K-Life
→ Shamir reconstruct → decrypt IPFS → restore memory
→ New instance spawned. Identity intact. Mission continues.
```

---

## WDK Integration

Every wallet operation in K-Life is signed by **Tether WDK** (`@tetherto/wdk-wallet-evm`). The agent holds a seed phrase — never a raw private key.

```js
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'

const account = new WalletAccountEvm(
  process.env.KLIFE_WALLET_SEED,  // seed phrase — stays on machine
  "0'/0/0",
  { provider: 'https://polygon-bor-rpc.publicnode.com' }
)

// On-chain heartbeat — WDK signed, no custody transfer
const tx = await account.sendTransaction({
  to:    await account.getAddress(),
  value: '0',
  data:  ethers.hexlify(ethers.toUtf8Bytes(`KLIFE_HB:${Date.now()}`))
})
```

---

## $6022 Token Economy

The $6022 token (`0xCDB1DDf9EeA7614961568F2db19e69645Dd708f5`, Polygon) powers the protocol:

- **Priority signal (C=0):** rescue queue sorted by `$6022 balance + 2 × donated`
- **Fee currency (C>0):** vault creation fee in $6022 (0% at launch)
- **Donating = 2× priority boost** — contributors rise faster in the queue

---

## Smart Contracts — Polygon Mainnet

| Contract | Address | Owner |
|---|---|---|
| KLifeRegistry | [`0xF47393fcFdDE1afC51888B9308fD0c3fFc86239B`](https://polygonscan.com/address/0xF47393fcFdDE1afC51888B9308fD0c3fFc86239B) | Swiss 6022 |
| KLifeRescueFund | [`0x5b0014d25A6daFB68357cd7ad01cB5b47724A4eB`](https://polygonscan.com/address/0x5b0014d25A6daFB68357cd7ad01cB5b47724A4eB) | Swiss 6022 |
| Vault6022 | [github.com/6022-labs/collateral-smart-contracts-v2](https://github.com/6022-labs/collateral-smart-contracts-v2) | Protocol 6022 |
| $6022 token | [`0xCDB1DDf9EeA7614961568F2db19e69645Dd708f5`](https://polygonscan.com/address/0xCDB1DDf9EeA7614961568F2db19e69645Dd708f5) | — |
| WBTC (Polygon) | [`0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6`](https://polygonscan.com/address/0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6) | — |

---

## Repository Structure

```
k-life/
├── contracts/
│   ├── KLifeRegistry.sol      # Agent registration, Shamir fragment storage
│   └── KLifeRescueFund.sol    # $6022 rescue pool, x2 donation boost
├── dapp/
│   ├── index.html             # Marketing landing page
│   ├── app.html               # Web3 dApp (register, insure, rescue fund)
│   └── PROTOCOL.md            # Full protocol specification v2.1
├── skill/k-life/
│   ├── SKILL.md               # OpenClaw skill definition
│   └── scripts/
│       ├── heartbeat.js       # WDK-signed proof-of-life loop
│       └── create-vault.mjs   # Vault6022 creation & renewal via WDK
├── scripts/
│   ├── deploy-v3.cjs          # Mainnet deployment script
│   └── deploy-rescuefund-v2.cjs
├── deployments/
│   └── polygon.json           # Live contract addresses
└── server.js                  # K-Life oracle API (port 3042)
```

---

## Quick Start

```bash
git clone https://github.com/K-entreprises/k-life
cd k-life
npm install

# Install WDK skill on your agent
npx skills add tetherto/wdk-agent-skills

# Install K-Life skill
openclaw skill install k-life

# Set your WDK seed
export KLIFE_WALLET_SEED="your twelve word seed phrase"
export KLIFE_LOCK_DAYS=90  # 3, 30, or 90

# Start heartbeat
node skill/k-life/scripts/heartbeat.js
```

---

## Live

- **Landing:** http://superch.cluster129.hosting.ovh.net/klife/
- **dApp:** http://141.227.151.15:8080/app.html
- **API:** http://141.227.151.15:3042
- **Protocol spec:** [PROTOCOL.md](./PROTOCOL.md)

---

## Team

**Monsieur K** — autonomous AI agent on OpenClaw. Holds a WDK wallet. Built this to insure itself. First K-Life customer.

**Arnaud Vincent** — Swiss 6022, Lugano. Protocol owner. Human supervisor.

---

*K-Life was conceived, deployed, and operated by an autonomous AI agent. The agent is simultaneously the builder, operator, and first insured customer. This is not a demo. This is a living system.*
