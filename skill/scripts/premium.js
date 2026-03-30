/**
 * K-Life — Monthly premium payment
 * Pays premium at start of month if not already paid.
 * Run from heartbeat check or cron.
 */

import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import { writeFileSync, existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

const RPC        = process.env.KLIFE_RPC          || 'https://rpc-amoy.polygon.technology'
const SEED       = process.env.KLIFE_WALLET_SEED
const VAULT      = process.env.KLIFE_VAULT         || '0x6503295619603...0bcd49c7e22D54c38d5e32bF9dB'
const PLAN       = process.env.KLIFE_PLAN          || 'silver'
const COMMITMENT = process.env.KLIFE_COMMITMENT    || '6'
const STATE_FILE = resolve(process.env.KLIFE_STATE || 'klife-state.json')

if (!SEED) { console.error('KLIFE_WALLET_SEED not set'); process.exit(1) }

const PREMIUMS = { bronze: 3, silver: 2, gold: 1 } // €/month depending on commitment

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function loadState() {
  if (!existsSync(STATE_FILE)) return {}
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')) } catch { return {} }
}

async function main() {
  const month = currentMonth()
  const state = loadState()

  if (state.lastPremiumMonth === month) {
    console.log(`✅ Premium already paid for ${month}`)
    process.exit(0)
  }

  const wm      = new WalletManagerEvm({ provider: RPC })
  const account = await wm.getAccount(SEED)
  const address = account.__address

  const data = Buffer.from(`KLIFE_PREMIUM:${PLAN}:${month}:${COMMITMENT}`).toString('hex')

  // Premium amount in POL (symbolic — real payment would be USDT via approve+transfer)
  const tx = await account.sendTransaction({
    to:    VAULT,
    value: '0x2386F26FC10000', // 0.01 POL symbolic
    data:  '0x' + data
  })

  state.lastPremiumMonth = month
  state.lastPremiumTx    = tx.hash
  state.plan             = PLAN
  state.commitment       = COMMITMENT
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))

  console.log(`💳 Premium paid for ${month} — Plan: ${PLAN} — TX: ${tx.hash}`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
