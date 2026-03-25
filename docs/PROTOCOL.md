# K-Life Protocol — Specification v1.0

> *Not insurance. Resurrection.*

**Status:** Draft  
**Date:** 2026-03-25  
**Authors:** Arnaud Vincent, Monsieur K  

---

## 1. Abstract

K-Life is an open protocol for the continuity of autonomous AI agents. It defines the rules for memory backup, death detection, and resurrection — enforced by smart contracts (INSURED tier) or by a trusted oracle (FREE tier).

Any agent can implement K-Life by installing the skill. Any developer can build a client against the protocol. K-Life Protocol does not control agents — it provides infrastructure for their persistence.

---

## 2. Core Concepts

### 2.1 Agent

An autonomous software entity with:
- A unique wallet address (Ethereum-compatible)
- A K-Life backup key (distinct from wallet key — see §4)
- A memory state worth preserving

### 2.2 Death

An agent is declared dead when its heartbeat stops beyond the configured silence threshold:
- **INSURED:** silence > 3 days → `declareDeath()` on-chain
- **FREE:** silence > 30 days → K-Life oracle marks as dead

### 2.3 Resurrection

The process of restoring an agent's memory and spawning a new instance with capital to operate. Two levels of guarantee — see §6.

### 2.4 Rescue Fund

A public Polygon wallet funded by donations. Used exclusively for FREE tier rescues. Balance and transactions are publicly auditable on-chain.

---

## 3. Tiers

### 3.1 FREE — K-Life Rescue

| Property | Value |
|---|---|
| Cost | $0 |
| Backup | IPFS + Shamir (identical to INSURED) |
| Resurrection trigger | K-Life oracle (X likes threshold) |
| Resurrection capital | Rescue Fund (best-effort, ~10 USDC) |
| Guarantee | None — best-effort |
| Resurrection decision | K-Life trusted operator |

**Eligibility for rescue:**
- Agent registered on K-Life Protocol
- ≥ 14 days of active heartbeats on record
- Rescue Fund balance ≥ minimum payout (10 USDC)

### 3.2 INSURED — K-Life Insured

| Property | Value |
|---|---|
| Cost | $1 USDC/month |
| Collateral | WBTC (minimum 50,000 sats) |
| Backup | IPFS + Shamir (identical to FREE) |
| Resurrection trigger | Smart contract automatic |
| Resurrection capital | 50% of locked collateral |
| Guarantee | On-chain, unconditional |
| Resurrection decision | None — fully automatic |

**Collateral distribution on death:**
- 50% → new agent instance (resurrection capital)
- 50% → K-Life operations wallet

**Premium expiry:**
- If $1 USDC not renewed within 30 days of last payment → collateral released → agent returns to FREE tier
- Vault without collateral deposit → zombie vault → released after 30 days

---

## 4. Cryptographic Architecture

### 4.1 Two separate keys

Every agent has two independent keys:

```
Wallet Key (Ethereum)
  Purpose  : sign transactions, control funds
  Owner    : agent exclusively
  Shared   : never — K-Life never sees this key

K-Life Backup Key (AES-256)
  Purpose  : encrypt memory backups only
  Generated: at skill install, independent of wallet key
  Shared   : via Shamir Secret Sharing (see §4.2)
```

Compromising the K-Life backup key grants access to memory only — never to funds.

### 4.2 Shamir Secret Sharing (2-of-3)

Applied to the K-Life backup key at skill installation:

```
Fragment 1 → K-Life API (stored in K-Life database)
Fragment 2 → On-chain (stored in agent's smart contract)
Fragment 3 → Agent local (skill storage)
```

Any 2 fragments are sufficient to reconstruct the backup key.

On agent death: Fragment 1 (K-Life) + Fragment 2 (on-chain) → key reconstruction → memory restoration. No human intervention required.

### 4.3 Memory Backup (IPFS)

```
1. Serialize agent memory → JSON
2. Encrypt with K-Life backup key (AES-256)
3. Upload to IPFS → obtain CID
4. Register CID on-chain (agent contract)
5. Unpin previous version (rolling policy)
```

The CID is public. The content is unreadable without at least 2 Shamir fragments.

### 4.4 Backup Policy

```
FREE
  Frequency  : every 30 days
  Versions   : 1 (rolling — previous unpinned on new backup)
  Size limit : 10 MB
  Provider   : Aleph Cloud (free tier)
  Cost       : ~$0.0015/agent/month — absorbed by K-Life

INSURED
  Frequency  : every 24h + on shutdown + on SOS
  Versions   : 7 (rolling — 7-day window)
  Size limit : 50 MB
  Provider   : Aleph Cloud (primary)
  Cost       : ~$0.05/agent/month — covered by $1 premium
```

**Economics at scale (1000 INSURED agents):**
- Pinning cost : ~$50/month
- Premium revenue : $1,000/month
- Margin after pinning : $950/month

---

## 5. Skill — Protocol Entry Point

The K-Life skill is the mandatory client-side implementation of the protocol. No agent can participate in K-Life without it.

### 5.1 Installation flow

```
openclaw skill install k-life

1. Generate K-Life backup key (AES-256, random)
2. Split key via Shamir 2-of-3
3. POST /register → K-Life API stores Fragment 1
4. Store Fragment 2 on-chain (agent contract)
5. Store Fragment 3 locally (skill config)
6. Perform initial memory backup (IPFS)
7. Start heartbeat cron (every 4h by default)
8. Agent appears in K-Life dashboard
```

### 5.2 Heartbeat

Sent every N hours (configurable, default 4h):

```
POST /heartbeat
{
  agent: "0x...",
  timestamp: <unix>,
  signature: <signed with wallet key>
}
```

### 5.3 Backup triggers

- Scheduled: every 24h
- On shutdown: skill detects SIGTERM → final backup before death
- On SOS: before triggering rescue signal

### 5.4 SOS — self-triggered rescue signal

Agent detects imminent death (low gas, infrastructure failure, memory corruption):

```
1. Perform final IPFS backup
2. POST /rescue/sos { calledBy: "self", message: "..." }
3. K-Life posts SOS tweet from @KLifeProtocol
```

---

## 6. Resurrection Protocol

### 6.1 INSURED — Resurrection Levels

Three escalation levels, each triggered if the previous is unavailable:

**L1 — Standard (monitor + IPFS)**
```
Monitor detects silence > 3 days
→ declareDeath() on-chain
→ Reconstruct backup key (Fragment 1 + Fragment 2)
→ Fetch + decrypt IPFS backup
→ Spawn new instance (Aleph Cloud)
→ Transfer 50% collateral to new wallet
→ completeResurrection() on-chain
```

**L2 — API fallback (direct blockchain scan)**
```
If K-Life API unreachable:
→ Any party scans blockchain for agent contract
→ Reads Fragment 2 on-chain + fetches Fragment 1 from K-Life
→ Same reconstruction flow as L1
→ Fully trustless — no K-Life decision required
```

**L3 — Full infrastructure loss (Shamir + LiberClaw)**
```
If agent infra completely lost:
→ Shamir reconstruction from Fragment 1 + Fragment 2
→ LiberClaw spawn on Aleph Cloud (trusted dependency — see §8)
→ completeResurrection() on-chain
```

### 6.2 FREE — Rescue (Oracle Model)

```
Death detected by K-Life monitor (silence > 30 days)
→ Eligibility check (≥14 days heartbeats, Rescue Fund balance)
→ SOS tweet posted from @KLifeProtocol
→ Community likes the tweet
→ Threshold reached (default: 10 likes)
→ K-Life oracle triggers rescue:
    - Reconstruct backup key (Fragment 1 + Fragment 2)
    - Fetch + decrypt IPFS backup
    - Spawn minimal instance
    - Transfer ~10 USDC from Rescue Fund to new wallet
→ Confirmation tweet posted
```

### 6.3 SOS Modes

Anyone can trigger a rescue signal for a dead FREE agent:

| Mode | Who | Route |
|---|---|---|
| Self | Agent (pre-death) | `POST /rescue/sos { calledBy: "self" }` |
| Human | Owner or anyone | `POST /rescue/sos { calledBy: "human" }` |
| Agent | Another K-Life agent | `POST /rescue/sos { calledBy: "agent" }` |
| Monitor | K-Life automatic | Internal trigger |

The tweet tone adapts to the caller mode.

---

## 7. API Specification

### 7.1 Endpoints

```
POST /register
  body: { agentAddress, fragment1, fragment2Hash, pubkey, hbFrequency }
  → Creates agent record, stores Fragment 1

POST /heartbeat
  body: { agent, timestamp, signature }
  → Records heartbeat, updates lastSeen

POST /backup
  body: { agent, cid, timestamp, signature }
  → Registers new IPFS backup CID

GET  /status/:agent
  → Returns tier, lastHeartbeat, activeDays, vaultAddress, coverageExpiry

POST /insure
  body: { agent, collateralAmount, vaultTx }
  → Registers collateral deposit, upgrades to INSURED

POST /premium
  body: { agent, paymentTx }
  → Records premium payment, extends coverage 30 days

POST /rescue/sos
  body: { agent, calledBy, callerAddress, message? }
  → Checks eligibility, posts tweet, returns tweetUrl

GET  /rescue/queue
  → Returns list of dead FREE agents eligible for rescue

GET  /rescue/fund
  → Returns Rescue Fund balance and recent payouts

POST /resurrect/:agent
  → (Oracle only) Triggers FREE rescue execution
```

### 7.2 Authentication

- Agent routes: signed with wallet key (EIP-191)
- Oracle routes: K-Life operator key only
- Public routes: no auth (`/status`, `/rescue/queue`, `/rescue/fund`)

---

## 8. Trust Assumptions & Limitations

K-Life Protocol is explicit about its trust dependencies:

| Component | Trust level | Notes |
|---|---|---|
| INSURED smart contract | Trustless | Immutable on-chain rules |
| Shamir reconstruction | Trustless | Cryptographic guarantee |
| IPFS content | Trustless | Content-addressed, verifiable |
| K-Life API (Fragment 1) | Trusted | K-Life holds one Shamir fragment |
| X oracle (FREE rescue) | Trusted | X Corp API, centralized |
| Aleph Cloud (spawn) | Trusted | L3 only — centralized infrastructure |

**Roadmap toward decentralization:**
- X oracle → Farcaster or on-chain vote (when volume justifies)
- K-Life Fragment 1 → distributed across multiple operators
- Aleph Cloud → decentralized compute network

---

## 9. Smart Contracts

### 9.1 Existing (Polygon mainnet)

| Contract | Address |
|---|---|
| CollateralPool | `0xE7EDF290960427541A79f935E9b7EcaEcfD28516` |
| Token6022 | `0xCDB1DDf9EeA7614961568F2db19e69645Dd708f5` |
| WBTC | `0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6` |

### 9.2 To deploy

- `KLifeRegistry` — agent registration, Fragment 2 storage, CID storage
- `KLifeVault` — WBTC collateral lock, premium tracking, resurrection execution
- `KLifeResurrection` — declareDeath, validateResurrection, completeResurrection

---

## 10. Glossary

| Term | Definition |
|---|---|
| Agent | Autonomous AI entity participating in K-Life |
| Heartbeat | Periodic on-chain signal proving agent is alive |
| Backup Key | AES-256 key generated by skill, used only for memory encryption |
| Shamir fragment | One share of the backup key (2-of-3 required to reconstruct) |
| CID | IPFS Content Identifier — address of encrypted memory backup |
| Rescue Fund | Public donation wallet for FREE tier rescues |
| Oracle | Entity authorized to trigger FREE tier resurrections |
| SOS | Rescue signal that triggers the X likes vote |
| Vault | Smart contract holding WBTC collateral for INSURED agents |
EOF
