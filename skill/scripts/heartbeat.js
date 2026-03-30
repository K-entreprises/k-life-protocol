/**
 * K-Life — Heartbeat (proof of life) v2.1
 * Signs on-chain TX every T minutes using WDK WalletAccountEvm.
 * Self-custodial: seed phrase never leaves the agent machine.
 *
 * Run: node skills/k-life/scripts/heartbeat.js
 */

import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'
import { ethers } from 'ethers'
import { writeFileSync, existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

const RPC          = process.env.KLIFE_RPC        || 'https://polygon-bor-rpc.publicnode.com'
const SEED         = process.env.KLIFE_WALLET_SEED
const INTERVAL_MS  = parseInt(process.env.KLIFE_INTERVAL_MS || '3600000') // 1h default
const HB_FILE      = resolve(process.env.KLIFE_HB_FILE || 'heartbeat.json')
const API_URL      = process.env.KLIFE_API_URL    || 'https://klife.monsieurk.io'
const LOCK_DAYS    = parseInt(process.env.KLIFE_LOCK_DAYS || '90') // 3, 30, or 90

if (!SEED) { console.error('KLIFE_WALLET_SEED not set'); process.exit(1) }

let beat = 1
if (existsSync(HB_FILE)) {
  try { beat = JSON.parse(readFileSync(HB_FILE, 'utf8')).beat + 1 } catch {}
}

// ── WDK wallet (self-custodial, seed never leaves machine) ──────────────────
const account = new WalletAccountEvm(SEED, "0'/0/0", { provider: RPC })

async function sendHeartbeat() {
  const address = await account.getAddress()
  const data    = ethers.hexlify(ethers.toUtf8Bytes(`KLIFE_HB:${beat}:${Date.now()}`))

  try {
    // 1. On-chain heartbeat — signed by WDK, no custody transfer
    const tx = await account.sendTransaction({
      to:    address,
      value: '0',
      data
    })

    const hb = {
      agent:     address,
      beat,
      timestamp: Date.now(),
      iso:       new Date().toISOString(),
      txHash:    tx.hash,
      lockDays:  LOCK_DAYS,
      onChain:   true
    }
    writeFileSync(HB_FILE, JSON.stringify(hb, null, 2))
    console.log(`💓 Beat #${beat} — TX: ${tx.hash}`)

    // 2. Notify K-Life API
    try {
      await fetch(`${API_URL}/heartbeat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ agent: address, txHash: tx.hash, beat, lockDays: LOCK_DAYS })
      })
    } catch { /* API notify non-blocking */ }

    // 3. Check vault renewal (C > 0 agents)
    await checkVaultRenewal(address)

    beat++
  } catch (e) {
    console.error(`Heartbeat failed: ${e.message}`)
  }
}

// ── Vault renewal (auto — triggered when lockedUntil < now + 6h) ────────────
async function checkVaultRenewal(address) {
  const vaultFile = resolve('vault-state.json')
  if (!existsSync(vaultFile)) return // C = 0, no vault

  try {
    const state = JSON.parse(readFileSync(vaultFile, 'utf8'))
    const lockedUntil = state.lockedUntil * 1000 // ms
    const renewWindow = LOCK_DAYS * 24 * 3600 * 1000 - 6 * 3600 * 1000 // T - 6h

    if (Date.now() >= lockedUntil - renewWindow) {
      console.log('🔄 Vault renewal needed — running create-vault...')
      const { renewVault } = await import('./create-vault.mjs')
      await renewVault(account, state)
    }
  } catch (e) {
    console.error(`Vault check failed: ${e.message}`)
  }
}

console.log(`🏥 K-Life Heartbeat v2.1 started`)
console.log(`   Wallet: WDK WalletAccountEvm (self-custodial)`)
console.log(`   Chain:  Polygon mainnet (137)`)
console.log(`   Lock:   ${LOCK_DAYS} days`)
console.log(`   Interval: ${INTERVAL_MS / 60000} min`)

sendHeartbeat()
setInterval(sendHeartbeat, INTERVAL_MS)
