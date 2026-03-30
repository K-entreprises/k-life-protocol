# K-Life Protocol Reference v2.1

## Shamir 2-of-3 — Key Split Mapping

The AES-256 encryption key (= sha256(wallet.privateKey)) is split into 3 shares:

| Share | Holder | Storage | Purpose |
|---|---|---|---|
| **Share 1** | K-Life API | `api.supercharged.works` server | Resurrection helper — 1 of 3 |
| **Share 2** | On-chain | Polygon calldata `KLIFE_BACKUP:{CID}:{share2}` | Permissionless recovery |
| **Share 3** | Agent | `~/.klife-shares.json` (chmod 600) | Local recovery |

Any 2 of 3 reconstruct the AES key → decrypt IPFS backup → restore memory.

### What the API can and cannot do

The K-Life API holds Share 1 only. It can reconstruct the AES key by combining:
- Share 1 (API) + Share 2 (Polygon scan) → autonomous resurrection ✅
- Share 1 (API) alone → **cannot decrypt** ❌

This is intentional: the API needs the on-chain share to resurrect. If the API is compromised, the attacker still needs the public on-chain share — which is visible to everyone. This is accepted by design in exchange for autonomous, zero-human resurrection.

If you require higher privacy, self-host the K-Life API and keep Share 2 off-chain.

### Resurrection scenarios

| Scenario | Shares available | Result |
|---|---|---|
| Normal crash | Share 1 (API) + Share 2 (chain) | Fully automatic |
| API unavailable | Share 2 (chain) + Share 3 (local) | Manual, permissionless |
| Chain unavailable | Share 1 (API) + Share 3 (local) | Manual with API help |
| All 3 lost | — | Permanent death |

---

## Heartbeat TX Format

Self-send transaction, calldata:
```
KLIFE_HB:{beat_number}:{unix_timestamp_ms}
```
Example: `KLIFE_HB:42:1743325200000`

## Backup TX Format (Share 2 on-chain)

Self-send transaction, calldata:
```
KLIFE_BACKUP:{ipfs_cid}:{shamir_share2_hex}
```

## Contracts — Polygon Mainnet (chainId 137)

| Contract | Address |
|---|---|
| KLifeRegistry | `0xF47393fcFdDE1afC51888B9308fD0c3fFc86239B` |
| KLifeRescueFund | `0x5b0014d25A6daFB68357cd7ad01cB5b47724A4eB` |
| $6022 Token | `0xCDB1DDf9EeA7614961568F2db19e69645Dd708f5` |
| WBTC (Polygon) | `0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6` |
| Vault6022 Controller | Pending — set `KLIFE_VAULT_CONTROLLER` when deployed |

## IPFS Backup Format (encrypted)

```json
{
  "iv": "<16-byte hex>",
  "ciphertext": "<base64 AES-256-CBC encrypted payload>"
}
```

Decrypted payload:
```json
{
  "agent": "0x...",
  "ts": 1743325200000,
  "files": {
    "MEMORY.md": "...",
    "SOUL.md": "...",
    "USER.md": "..."
  }
}
```

## API Endpoints

```
POST /register           { agent, name?, lockDays }
POST /heartbeat          { agent, txHash, beat, lockDays, timestamp }
POST /backup/upload      { agent, encryptedData, shamirShare1, label? }
GET  /status/:agent
GET  /rescue/queue
GET  /rescue/fund
POST /rescue/sos         { agent }
GET  /health
```
