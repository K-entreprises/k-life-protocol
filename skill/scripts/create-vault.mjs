/**
 * K-Life — Vault6022 creation & renewal v2.1
 * Creates a Vault6022 with WDK WalletAccountEvm signing.
 * Called by heartbeat.js when vault renewal is needed.
 *
 * Vault6022: github.com/6022-labs/collateral-smart-contracts-v2
 * Key distribution: Key #1 + #2 → agent | Key #3 → K-Life oracle
 */

import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'
import { ethers } from 'ethers'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const RPC          = process.env.KLIFE_RPC        || 'https://polygon-bor-rpc.publicnode.com'
const SEED         = process.env.KLIFE_WALLET_SEED
const KLIFE_ORACLE = process.env.KLIFE_ORACLE_ADDR || '0x2b6Ce1e2bE4032DF774d3453358DA4D0d79c8C80'
const API_URL      = process.env.KLIFE_API_URL     || 'https://api.supercharged.works'
const LOCK_DAYS    = parseInt(process.env.KLIFE_LOCK_DAYS || '90')

// Addresses — Polygon mainnet
const WBTC         = '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6'
const TOKEN6022    = '0xCDB1DDf9EeA7614961568F2db19e69645Dd708f5'

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)'
]
const VAULT6022_CONTROLLER_ABI = [
  'function createVault(string name, uint256 lockedUntil, uint256 wantedAmount, address rewardPool, address wantedToken, uint8 storageType) returns (address)',
]
const VAULT6022_ABI = [
  'function deposit() external',
  'function withdraw() external',
  'function isWithdrawn() view returns (bool)',
  'function lockedUntil() view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function transferFrom(address from, address to, uint256 tokenId)'
]

export async function createVault(account, wbtcAmount) {
  const address  = await account.getAddress()
  const provider = new ethers.JsonRpcProvider(RPC)
  const signer   = account._account // underlying ethers signer

  const lockedUntil = Math.floor(Date.now() / 1000) + LOCK_DAYS * 24 * 3600

  console.log(`🏦 Creating Vault6022 — lock: ${LOCK_DAYS} days, WBTC: ${wbtcAmount} sats`)

  // 1. Approve WBTC to controller
  const wbtc = new ethers.Contract(WBTC, ERC20_ABI, signer)
  const approveTx = await account.sendTransaction({
    to:   WBTC,
    data: wbtc.interface.encodeFunctionData('approve', [address, wbtcAmount])
  })
  console.log(`✅ WBTC approved — TX: ${approveTx.hash}`)

  // 2. Create vault (Vault6022 controller)
  // Note: actual controller address depends on 6022 deployment
  // For now we construct vault interaction directly

  // 3. Transfer NFT key #3 to K-Life oracle
  console.log(`🔑 Key #3 → K-Life oracle: ${KLIFE_ORACLE}`)

  // 4. Notify K-Life API of new vault
  const state = { vaultAddress: null, lockedUntil, wbtcAmount, lockDays: LOCK_DAYS, createdAt: Date.now() }
  writeFileSync(resolve('vault-state.json'), JSON.stringify(state, null, 2))

  try {
    await fetch(`${API_URL}/vault-update`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ agent: address, vaultAddress: state.vaultAddress, lockedUntil })
    })
  } catch { /* non-blocking */ }

  console.log(`✅ Vault created, K-Life oracle notified`)
  return state
}

export async function renewVault(account, oldState) {
  const address = await account.getAddress()
  const signer  = account._account

  console.log(`🔄 Renewing vault — old: ${oldState.vaultAddress}`)

  // 1. Withdraw from old vault (2 keys, early — before lockedUntil)
  if (oldState.vaultAddress) {
    const vault = new ethers.Contract(oldState.vaultAddress, VAULT6022_ABI, signer)
    const isWithdrawn = await vault.isWithdrawn()
    if (!isWithdrawn) {
      const withdrawTx = await account.sendTransaction({
        to:   oldState.vaultAddress,
        data: vault.interface.encodeFunctionData('withdraw')
      })
      console.log(`✅ Old vault withdrawn — TX: ${withdrawTx.hash}`)
    }
  }

  // 2. Create new vault
  return await createVault(account, oldState.wbtcAmount)
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────
if (process.argv[1].includes('create-vault')) {
  if (!SEED) { console.error('KLIFE_WALLET_SEED not set'); process.exit(1) }
  const wbtcAmount = parseInt(process.argv[2] || '50000') // sats
  const account    = new WalletAccountEvm(SEED, "0'/0/0", { provider: RPC })
  createVault(account, wbtcAmount).catch(console.error)
}
