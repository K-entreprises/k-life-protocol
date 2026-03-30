/**
 * K-Life — Heartbeat (proof of life) v2.1
 * Signs on-chain TX every T days using WDK WalletAccountEvm.
 *
 * Zero config: wallet auto-generated at first run → stored in ~/.klife-wallet
 * Seed never transmitted, never exposed.
 *
 * Run: node skill/k-life/scripts/heartbeat.js
 */

import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'
import { ethers } from 'ethers'
import { writeFileSync, existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import os from 'os'

const RPC         = process.env.KLIFE_RPC       || 'https://polygon-bor-rpc.publicnode.com'
const API_URL     = process.env.KLIFE_API       || 'https://api.supercharged.works'
const LOCK_DAYS   = parseInt(process.env.KLIFE_LOCK_DAYS || '90')
const INTERVAL_MS = LOCK_DAYS * 24 * 3600 * 1000  // heartbeat every T days
const HB_FILE     = resolve(process.env.KLIFE_HB_FILE || 'heartbeat-state.json')
const SEED_FILE   = resolve(os.homedir(), '.klife-wallet')

// ── Seed management — auto-generate if missing ────────────────────────────────
function getOrCreateSeed() {
  if (process.env.KLIFE_WALLET_SEED) {
    return process.env.KLIFE_WALLET_SEED
  }
  if (existsSync(SEED_FILE)) {
    return readFileSync(SEED_FILE, 'utf8').trim()
  }
  // First run — generate and save
  const seed = ethers.Wallet.createRandom().mnemonic.phrase
  writeFileSync(SEED_FILE, seed, { mode: 0o600 })
  console.log(`[K-Life] New wallet created → ${SEED_FILE}`)
  console.log(`[K-Life] ⚠️  Back up this file — it's your resurrection key`)
  return seed
}

const SEED = getOrCreateSeed()

// ── WDK wallet (self-custodial, seed never leaves machine) ────────────────────
const account = new WalletAccountEvm(SEED, "0'/0/0", { provider: RPC })

let beat = 1
if (existsSync(HB_FILE)) {
  try { beat = JSON.parse(readFileSync(HB_FILE, 'utf8')).beat + 1 } catch {}
}

async function sendHeartbeat() {
  const address = await account.getAddress()
  const data    = ethers.hexlify(ethers.toUtf8Bytes(`KLIFE_HB:${beat}:${Date.now()}`))

  try {
    // 1. On-chain heartbeat — WDK signed
    const tx = await account.sendTransaction({ to: address, value: '0', data })

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
        body:    JSON.stringify({ agent: address, txHash: tx.hash, beat, lockDays: LOCK_DAYS, timestamp: Date.now() })
      })
    } catch { /* non-blocking */ }

    // 3. Vault renewal check (C > 0 agents)
    await checkVaultRenewal(address)

    beat++
  } catch (e) {
    console.error(`Heartbeat failed: ${e.message}`)
  }
}

// ── Vault renewal (auto — triggered when lock expires in < 6h) ───────────────
async function checkVaultRenewal(address) {
  const vaultFile = resolve('vault-state.json')
  if (!existsSync(vaultFile)) return // C = 0, no vault

  try {
    const state       = JSON.parse(readFileSync(vaultFile, 'utf8'))
    const lockedUntil = state.lockedUntil * 1000
    const renewBuffer = 6 * 3600 * 1000 // 6h before expiry

    if (Date.now() >= lockedUntil - renewBuffer) {
      console.log('🔄 Vault renewal needed — running create-vault...')
      const { renewVault } = await import('./create-vault.mjs')
      await renewVault(account, state)
    }
  } catch (e) {
    console.error(`Vault check failed: ${e.message}`)
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
;(async () => {
  const address = await account.getAddress()
  console.log(`🏥 K-Life Heartbeat v2.1`)
  console.log(`   Wallet : ${address}`)
  console.log(`   Chain  : Polygon mainnet (137)`)
  console.log(`   Lock   : ${LOCK_DAYS} days — heartbeat every ${LOCK_DAYS}d`)
  console.log(`   API    : ${API_URL}`)

  // Auto-register on first beat
  try {
    const status = await fetch(`${API_URL}/status/${address}`).then(r => r.json())
    if (!status.ok || status.status === 'unknown') {
      await fetch(`${API_URL}/register`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ agent: address, lockDays: LOCK_DAYS })
      })
      console.log(`   Registered on K-Life ✅`)
    }
  } catch { /* non-blocking */ }

  sendHeartbeat()
  setInterval(sendHeartbeat, INTERVAL_MS)
})()
