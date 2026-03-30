/**
 * K-Life — Étape 1 : Création de la RewardPool K-Life sur Protocol 6022
 *
 * À exécuter une seule fois. K-Life devient un insurer reconnu sur le protocole.
 *
 * Prérequis :
 *   - Wallet K-Life avec des tokens $6022 (pour _lifetimeVaultAmount)
 *   - MATIC pour le gas
 *
 * Usage : KLIFE_SEED="..." LIFETIME_AMOUNT=1000 node init-klife-pool.mjs
 *
 * Polygon mainnet addresses:
 *   Controller : 0xf6643c07f03a7a8c98aac2ab3d08c03e47b5731c
 *   Factory    : 0xbbd5e4d3178376fdfa02e6cf4200b136c4348c32
 *   Token $6022: 0xCDB1DDf9EeA7614961568F2db19e69645Dd708f5
 */

import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { ethers } = require('ethers')

// ── Config ────────────────────────────────────────────────────────────────────
const SEED             = process.env.KLIFE_SEED
const RPC              = process.env.POLYGON_RPC   || 'https://polygon-bor-rpc.publicnode.com'
const LIFETIME_AMOUNT  = process.env.LIFETIME_AMOUNT || '1000' // $6022 tokens

const CONTROLLER = '0xf6643c07f03a7a8c98aac2ab3d08c03e47b5731c'
const FACTORY    = '0xbbd5e4d3178376fdfa02e6cf4200b136c4348c32'
const TOKEN_6022 = '0xCDB1DDf9EeA7614961568F2db19e69645Dd708f5'

const FACTORY_ABI = [
  'function createRewardPool(uint256 _lifetimeVaultAmount) external',
  'event RewardPoolCreated(address indexed rewardPool)'
]

const CONTROLLER_ABI = [
  'function getRewardPoolsByCreator(address creator) view returns (address[])',
  'function allRewardPoolsLength() view returns (uint256)'
]

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)'
]

if (!SEED) { console.error('❌ KLIFE_SEED manquant'); process.exit(1) }

// ── Main ──────────────────────────────────────────────────────────────────────
const provider = new ethers.providers.JsonRpcProvider(RPC)
const wallet   = ethers.Wallet.fromMnemonic(SEED).connect(provider)

// Polygon mainnet nécessite un gas tip minimum de 30 gwei
const GAS_OVERRIDES = {
  maxPriorityFeePerGas: ethers.utils.parseUnits('30', 'gwei'),
  maxFeePerGas:         ethers.utils.parseUnits('200', 'gwei')
}

console.log('\n🏦 K-Life RewardPool Init — Protocol 6022')
console.log('═'.repeat(52))
console.log('Wallet :', wallet.address)

// Vérifier si on a déjà une pool
const ctrl = new ethers.Contract(CONTROLLER, CONTROLLER_ABI, provider)
const existing = await ctrl.getRewardPoolsByCreator(wallet.address)
if (existing.length > 0) {
  console.log('\n✅ RewardPool K-Life déjà existante :', existing[0])
  console.log('   Rien à faire.')
  process.exit(0)
}

// Lire les decimals du token $6022
const token = new ethers.Contract(TOKEN_6022, ERC20_ABI, wallet)
const decimals = await token.decimals()
const amount   = ethers.utils.parseUnits(LIFETIME_AMOUNT, decimals)

// Vérifier le solde
const balance = await token.balanceOf(wallet.address)
console.log('\n$6022 solde    :', ethers.utils.formatUnits(balance, decimals))
console.log('$6022 requis   :', LIFETIME_AMOUNT, '(lifetime vault stake)')
if (balance.lt(amount)) {
  console.error('\n❌ Solde $6022 insuffisant. Acquiers des tokens via Uniswap.')
  process.exit(1)
}

// Étape 1 : Approve $6022 → Factory
console.log('\n📝 Approve $6022 → Factory...')
const approveTx = await token.approve(FACTORY, amount, GAS_OVERRIDES)
console.log('   TX:', approveTx.hash)
await approveTx.wait()
console.log('   ✅ Approuvé')

// Étape 2 : createRewardPool
console.log('\n🚀 Création de la RewardPool K-Life...')
const factory  = new ethers.Contract(FACTORY, FACTORY_ABI, wallet)
const createTx = await factory.createRewardPool(amount, GAS_OVERRIDES)
console.log('   TX:', createTx.hash)
const receipt  = await createTx.wait()

// Récupérer l'adresse de la pool depuis l'event
const iface    = new ethers.utils.Interface(FACTORY_ABI)
let poolAddr   = null
for (const log of receipt.logs) {
  try {
    const parsed = iface.parseLog(log)
    if (parsed.name === 'RewardPoolCreated') {
      poolAddr = parsed.args.rewardPool
    }
  } catch {}
}

if (!poolAddr) {
  // Fallback : interroger le controller
  const pools = await ctrl.getRewardPoolsByCreator(wallet.address)
  poolAddr = pools[0]
}

console.log('\n' + '═'.repeat(52))
console.log('🎉 REWARD POOL K-LIFE CRÉÉE')
console.log('   Adresse  :', poolAddr)
console.log('   Owner    :', wallet.address)
console.log('   Stake    :', LIFETIME_AMOUNT, '$6022')
console.log('\n   ➜ Enregistre cette adresse dans TOOLS.md !')
console.log('   ➜ Elle sera utilisée par create-vault.mjs')
