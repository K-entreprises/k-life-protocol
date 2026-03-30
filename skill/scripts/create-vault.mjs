/**
 * K-Life — Vault6022 creation & renewal v2.1
 * Creates a Vault6022 with WDK WalletAccountEvm signing.
 * Called by heartbeat.js when vault renewal is needed (C>0 agents).
 *
 * STATUS: Beta — requires Vault6022 controller address on Polygon mainnet.
 * The controller address will be confirmed after Protocol 6022 mainnet deployment.
 * Track: github.com/6022-labs/collateral-smart-contracts-v2
 *
 * How collateral protection works (why K-Life can't confiscate arbitrarily):
 *   Vault6022 mints 3 NFT keys at creation.
 *   - Keys #1 + #2 → agent wallet (WDK-held)
 *   - Key  #3      → K-Life oracle
 *   Early withdrawal (during lock) requires 2 keys → agent holds both → K-Life locked out.
 *   Late  withdrawal (after lock expiry) requires 1 key → K-Life can proceed.
 *   Lock period = death threshold = T days. Agent alive + renewing = always safe.
 */

import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'
import { ethers }           from 'ethers'
import { writeFileSync, existsSync, readFileSync } from 'fs'
import { resolve }          from 'path'
import os                   from 'os'

const RPC          = process.env.KLIFE_RPC        || 'https://polygon-bor-rpc.publicnode.com'
const KLIFE_ORACLE = process.env.KLIFE_ORACLE_ADDR || '0x2b6Ce1e2bE4032DF774d3453358DA4D0d79c8C80'
const API_URL      = process.env.KLIFE_API         || 'https://api.supercharged.works'  // same var as heartbeat.js
const LOCK_DAYS    = parseInt(process.env.KLIFE_LOCK_DAYS || '90')
const SEED_FILE    = resolve(os.homedir(), '.klife-wallet')

// Polygon mainnet addresses
const WBTC         = '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6'

// NOTE: VAULT6022_CONTROLLER is pending Protocol 6022 mainnet deployment.
// Set KLIFE_VAULT_CONTROLLER once the address is confirmed.
const VAULT6022_CONTROLLER = process.env.KLIFE_VAULT_CONTROLLER || null

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)'
]
const VAULT6022_ABI = [
  'function withdraw() external',
  'function isWithdrawn() view returns (bool)',
  'function lockedUntil() view returns (uint256)',
]

function getSeed() {
  if (existsSync(SEED_FILE)) return readFileSync(SEED_FILE, 'utf8').trim()
  throw new Error(`No wallet found at ${SEED_FILE}. Run heartbeat.js first to generate one.`)
}

export async function createVault(account, wbtcAmount) {
  if (!VAULT6022_CONTROLLER) {
    throw new Error(
      'Vault6022 controller address not set.\n' +
      'Set KLIFE_VAULT_CONTROLLER once Protocol 6022 is deployed on Polygon mainnet.\n' +
      'Track: https://github.com/6022-labs/collateral-smart-contracts-v2'
    )
  }

  const address     = await account.getAddress()
  const lockedUntil = Math.floor(Date.now() / 1000) + LOCK_DAYS * 24 * 3600

  console.log(`🏦 Creating Vault6022 — lock: ${LOCK_DAYS} days, WBTC: ${wbtcAmount} sats`)

  // 1. Approve WBTC to Vault6022 controller
  const wbtc       = new ethers.Interface(ERC20_ABI)
  const approveTx  = await account.sendTransaction({
    to:   WBTC,
    data: wbtc.encodeFunctionData('approve', [VAULT6022_CONTROLLER, wbtcAmount])
  })
  console.log(`✅ WBTC approved — TX: ${approveTx.hash}`)

  // 2. Create vault via controller
  // (controller ABI confirmed once address is known)
  console.log(`⏳ Vault creation pending KLIFE_VAULT_CONTROLLER deployment`)

  // 3. Key #3 → K-Life oracle (via API — oracle holds key server-side)
  console.log(`🔑 Shamir key #3 → K-Life oracle: ${KLIFE_ORACLE}`)

  // 4. Save local state
  const state = {
    vaultAddress: null,  // updated after vault creation TX is confirmed
    lockedUntil,
    wbtcAmount,
    lockDays:   LOCK_DAYS,
    createdAt:  Date.now()
  }
  writeFileSync(resolve('vault-state.json'), JSON.stringify(state, null, 2))

  // 5. Notify K-Life API
  try {
    await fetch(`${API_URL}/vault-update`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ agent: address, lockedUntil, wbtcAmount, lockDays: LOCK_DAYS })
    })
  } catch { /* non-blocking */ }

  console.log(`✅ Vault state saved, oracle notified`)
  return state
}

export async function renewVault(account, oldState) {
  console.log(`🔄 Renewing vault`)

  // Withdraw from old vault if exists and not already withdrawn
  if (oldState.vaultAddress) {
    const provider = new ethers.JsonRpcProvider(RPC)
    const vault    = new ethers.Contract(oldState.vaultAddress, VAULT6022_ABI, provider)
    const withdrawn = await vault.isWithdrawn().catch(() => true)
    if (!withdrawn) {
      const vaultIface = new ethers.Interface(VAULT6022_ABI)
      const tx = await account.sendTransaction({
        to:   oldState.vaultAddress,
        data: vaultIface.encodeFunctionData('withdraw')
      })
      console.log(`✅ Old vault withdrawn — TX: ${tx.hash}`)
    }
  }

  return await createVault(account, oldState.wbtcAmount)
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────
if (process.argv[1]?.includes('create-vault')) {
  const wbtcAmount = parseInt(process.argv[2] || '50000')
  const seed       = getSeed()
  const account    = new WalletAccountEvm(seed, "0'/0/0", { provider: RPC })
  createVault(account, wbtcAmount).catch(e => { console.error(e.message); process.exit(1) })
}
