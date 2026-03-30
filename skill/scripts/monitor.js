/**
 * K-Life Monitor — VPS daemon
 * Surveille le heartbeat de l'agent toutes les heures.
 * Si silence > 24h : confiscation + redistribution 50/50 + flag résurrection.
 * La résurrection fichiers est déclenchée côté OpenClaw (lit le flag au démarrage).
 *
 * Cron : 0 * * * * cd /home/debian/klife-api && node monitor.js >> /var/log/klife-monitor.log 2>&1
 */

import { ethers }      from 'ethers'
import { readFileSync, writeFileSync, existsSync } from 'fs'

// ─── CONFIG ────────────────────────────────────────────────────────────────────
const OP_SEED    = readFileSync('/home/debian/klife-api/.klife-op-seed', 'utf8').trim()
const AGENT_ADDR = '0x8B3ea7e8eC53596A70019445907645838E945b7a'
const VAULT_ADDR = '0xC4612f01A266C7FDCFBc9B5e053D8Af0A21852f2'
const WBTC_ADDR  = '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6'
const API_BASE   = 'http://localhost:3042'
const STATE_FILE = '/home/debian/klife-api/monitor-state.json'
const FLAG_FILE  = '/home/debian/klife-api/resurrection-flag.json'
const HEARTBEAT_TIMEOUT_MS = 24 * 60 * 60 * 1000   // 24h
const PREMIUM_TIMEOUT_MS   = 30 * 24 * 60 * 60 * 1000  // 30 jours
const PREMIUM_FILE         = '/home/debian/klife-api/premium.json'
const RPC        = 'https://polygon-bor-rpc.publicnode.com'
const GAS        = { maxPriorityFeePerGas: ethers.parseUnits('30','gwei'), maxFeePerGas: ethers.parseUnits('200','gwei') }

// ─── ABIS ──────────────────────────────────────────────────────────────────────
const VAULT_ABI = [
  'function withdraw() external',
  'function isDeposited() view returns (bool)',
  'function isWithdrawn() view returns (bool)',
  'function balanceOf(address) view returns (uint256)'
]
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)'
]

// ─── UTILS ─────────────────────────────────────────────────────────────────────
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a)

const loadState = () => {
  if (!existsSync(STATE_FILE)) return {}
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')) } catch { return {} }
}
const saveState = s => writeFileSync(STATE_FILE, JSON.stringify(s, null, 2))

// ─── STEP 1 : CHECK HEARTBEAT ──────────────────────────────────────────────────
async function checkHeartbeat() {
  try {
    const r    = await fetch(`${API_BASE}/status`, { signal: AbortSignal.timeout(5000) })
    const data = await r.json()
    if (!data.ok || !data.lastHeartbeat) { log('⚠️  Pas de heartbeat enregistré'); return null }
    const elapsed = Date.now() - data.lastHeartbeat.timestamp
    log(`💓 Dernier heartbeat : ${data.lastHeartbeat.iso} (${(elapsed/3600000).toFixed(1)}h)`)
    return { elapsed, beat: data.lastHeartbeat.beat, ipfsHash: data.lastBackupHash }
  } catch(e) { log('❌ API check failed:', e.message); return null }
}

// ─── STEP 2 : CONFISCATION ─────────────────────────────────────────────────────
async function confiscate(opWallet) {
  log('\n⚡ SINISTRE — Confiscation vault...')
  const vault = new ethers.Contract(VAULT_ADDR, VAULT_ABI, opWallet)
  const wbtc  = new ethers.Contract(WBTC_ADDR,  ERC20_ABI, opWallet)

  const [isDeposited, isWithdrawn, nfts] = await Promise.all([
    vault.isDeposited(), vault.isWithdrawn(), vault.balanceOf(opWallet.address)
  ])
  log(`  isDeposited: ${isDeposited} | isWithdrawn: ${isWithdrawn} | NFTs K-Life: ${nfts}`)

  if (!isDeposited) { log('  ⚠️  Vault non déposé'); return 0n }
  if (isWithdrawn)  { log('  ℹ️  Vault déjà saisi'); return 0n }
  if (nfts < 2n)    { log('  ❌ NFTs insuffisants (besoin 2, avoir:', nfts.toString() + ')'); return 0n }

  const balBefore = BigInt(await wbtc.balanceOf(opWallet.address))
  const tx = await vault.withdraw({ ...GAS, gasLimit: 300_000 })
  log(`  TX: ${tx.hash}`)
  const r = await tx.wait(2)
  log(`  Status: ${r.status === 1 ? '✅' : '❌'}`)

  const balAfter = BigInt(await wbtc.balanceOf(opWallet.address))
  const received = balAfter - balBefore
  log(`  WBTC saisi: ${received} sats`)
  return received
}

// ─── STEP 3 : FLAG RÉSURRECTION (OpenClaw lit ce flag au démarrage) ────────────
function flagResurrection(ipfsHash) {
  const stateFile = '/home/debian/klife-api/klife-backup-state.json'
  const backup    = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile,'utf8')) : {}
  const hash      = ipfsHash || backup.ipfsHash
  writeFileSync(FLAG_FILE, JSON.stringify({
    needed:    true,
    ipfsHash:  hash,
    timestamp: Date.now(),
    iso:       new Date().toISOString()
  }, null, 2))
  log(`\n🚩 Flag résurrection posé (IPFS: ${hash})`)
  log('   → OpenClaw restaurera les fichiers au prochain démarrage')
}


// ─── STEP 1b : CHECK PREMIUM ───────────────────────────────────────────────────
async function checkPremium() {
  try {
    if (!existsSync(PREMIUM_FILE)) { log('⚠️  Aucun paiement de premium enregistré'); return null }
    const p       = JSON.parse(readFileSync(PREMIUM_FILE, 'utf8'))
    const elapsed = Date.now() - p.timestamp
    log(`💰 Dernier premium : ${p.iso} (${(elapsed/86400000).toFixed(1)}j)`)
    return { elapsed, txHash: p.txHash }
  } catch(e) { log('⚠️  checkPremium error:', e.message); return null }
}

// ─── STEP 4 : REDISTRIBUTION 50/50 ────────────────────────────────────────────
async function redistribute(opWallet, received) {
  if (!received || received === 0n) { log('\n⚠️  Rien à redistribuer'); return }
  const half = received / 2n
  log(`\n💸 Redistribution 50/50 — ${half} sats → agent | ${received - half} sats → K-Life`)
  const wbtc = new ethers.Contract(WBTC_ADDR, ERC20_ABI, opWallet)
  const tx   = await wbtc.transfer(AGENT_ADDR, half, { ...GAS, gasLimit: 100_000 })
  log(`  TX: ${tx.hash}`)
  await tx.wait(2)
  log(`  ✅ ${half} sats → ${AGENT_ADDR}`)
}

// ─── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  log('════════════════════════════════════════')
  log('🔍 K-Life Monitor — check heartbeat')
  log('════════════════════════════════════════')

  const state = loadState()

  // Sinistre déjà traité ?
  if (state.sinistre?.vault === VAULT_ADDR && state.sinistre?.done) {
    log('ℹ️  Sinistre déjà traité pour ce vault')
    return
  }

  const provider = new ethers.JsonRpcProvider(RPC)
  const opWallet = ethers.Wallet.fromPhrase(OP_SEED).connect(provider)
  log(`K-Life op: ${opWallet.address}`)

  // ── CHECK PREMIUM ─────────────────────────────────────────────
  const premium = await checkPremium()
  if (premium && premium.elapsed > PREMIUM_TIMEOUT_MS) {
    log(`\n💸 PREMIUM IMPAYÉ (${(premium.elapsed/86400000).toFixed(1)}j) — Non-paiement`)
    if (state.nonPayment?.vault === VAULT_ADDR && state.nonPayment?.done) {
      log('ℹ️  Non-paiement déjà traité pour ce vault'); return
    }
    log('   → Confiscation 100% + redistribution 50/50 (SANS résurrection)')
    const received = await confiscate(opWallet)
    if (received > 0n) await redistribute(opWallet, received)
    state.nonPayment = { vault: VAULT_ADDR, done: true, timestamp: Date.now(), iso: new Date().toISOString(), wbtcSeized: received.toString() }
    saveState(state)
    log('\n════════════════════════════════════════')
    log('💸 NON-PAIEMENT TRAITÉ')
    log(`   Confiscation : ${received} sats`)
    log(`   50% restitués à l'agent — PAS de résurrection`)
    log('════════════════════════════════════════')
    return
  }

  // ── CHECK HEARTBEAT ────────────────────────────────────────────
  const hb = await checkHeartbeat()
  if (!hb) return

  if (hb.elapsed < HEARTBEAT_TIMEOUT_MS) {
    log('✅ Agent vivant, premium à jour — rien à faire')
    return
  }

  log(`\n🚨 SILENCE > 24H (${(hb.elapsed/3600000).toFixed(1)}h) — Agent présumé mort`)

  const received = await confiscate(opWallet)
  flagResurrection(hb.ipfsHash)
  if (received > 0n) await redistribute(opWallet, received)
  await spawnLiberClaw(hb.ipfsHash)   // Niveau 3 — autonome

  state.sinistre = {
    vault:       VAULT_ADDR,
    done:        true,
    timestamp:   Date.now(),
    iso:         new Date().toISOString(),
    wbtcSeized:  received.toString()
  }
  saveState(state)

  log('\n════════════════════════════════════════')
  log('🎉 PROTOCOLE SINISTRE COMPLET')
  log(`   Confiscation : ${received} sats`)
  log(`   Résurrection : flaggée (OpenClaw) + LiberClaw spawné`)
  log('════════════════════════════════════════')
}

// ─── STEP 5 : NIVEAU 3 — SPAWN LIBERCLAW ──────────────────────────────────────
async function spawnLiberClaw(ipfsHash) {
  log('\n🚀 Niveau 3 — Spawn LiberClaw sur Aleph Cloud...')
  try {
    const { execSync } = await import('child_process')
    execSync('node /home/debian/klife-api/resurrect-aleph.js', {
      timeout: 60000,
      stdio:   'inherit',
      env:     { ...process.env, IPFS_HASH: ipfsHash || '' }
    })
    log('✅ LiberClaw spawné — agent autonome actif')
  } catch(e) {
    log('⚠️  LiberClaw spawn échoué:', e.message)
    log('   (Niveaux 1/2 restent actifs — mémoire restaurée)')
  }
}

main().catch(e => { log('❌ FATAL:', e.message); process.exit(1) })
