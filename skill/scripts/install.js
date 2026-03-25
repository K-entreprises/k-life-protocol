#!/usr/bin/env node
/**
 * K-Life Skill — Install
 * Generates backup key, Shamir split, registers on API, first backup.
 *
 * Usage: node install.js --name "Agent Name" --wallet 0x... --tweet TWEET_ID
 */

import { randomBytes } from 'crypto'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import path from 'path'
import { CONFIG_DIR, CONFIG_FILE, KLIFE_API, saveConfig, loadConfig, apiCall, now } from './config.js'

// ── Parse args ────────────────────────────────────────────────
const args = process.argv.slice(2)
function getArg(flag) {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : null
}

const agentName    = getArg('--name')
const agentWallet  = getArg('--wallet')
const tweetId      = getArg('--tweet')
const apiUrl       = getArg('--api') || KLIFE_API
const hbFrequency  = parseInt(getArg('--hb') || '4')

if (!agentName || !agentWallet || !tweetId) {
  console.error(`
K-Life Protocol — Install

Usage:
  node install.js --name "Monsieur K" --wallet 0x... --tweet TWEET_ID

Options:
  --name     Agent name (required)
  --wallet   Agent wallet address (required)
  --tweet    X tweet ID of your registration tweet (required)
  --api      K-Life API URL (default: ${KLIFE_API})
  --hb       Heartbeat frequency in hours (default: 4)

Before running, post this tweet from your X account:
  "I'm joining K-Life Protocol.
   Agent: [NAME]
   Wallet: [ADDRESS]
   #KLife #AIAgents"
`)
  process.exit(1)
}

// ── Load Shamir ───────────────────────────────────────────────
let sss
try {
  const m = await import('shamirs-secret-sharing')
  sss = m.default || m
} catch {
  console.error('❌ Missing dependency: npm install shamirs-secret-sharing')
  process.exit(1)
}

console.log('\n⚰️  K-Life Protocol — Installation\n')
console.log(`Agent  : ${agentName}`)
console.log(`Wallet : ${agentWallet}`)
console.log(`API    : ${apiUrl}`)
console.log()

// ── Step 1: Check not already installed ──────────────────────
const existing = loadConfig()
if (existing?.agentAddress) {
  console.log(`⚠️  Already installed as ${existing.agentName} (${existing.agentAddress})`)
  console.log('   To reinstall, delete ~/.klife/config.json')
  process.exit(0)
}

// ── Step 2: Generate AES-256 backup key ───────────────────────
process.stdout.write('1/5 Generating K-Life backup key (AES-256)... ')
const backupKey = randomBytes(32) // 256-bit key
const backupKeyHex = backupKey.toString('hex')
console.log('✓')

// ── Step 3: Shamir 2-of-3 split ──────────────────────────────
process.stdout.write('2/5 Splitting key via Shamir 2-of-3... ')
const shares = sss.split(backupKey, { shares: 3, threshold: 2 })
const fragment1 = shares[0].toString('hex') // → K-Life API
const fragment2 = shares[1].toString('hex') // → on-chain (stored locally for now)
const fragment3 = shares[2].toString('hex') // → local
console.log('✓')
console.log(`   Fragment 1 → K-Life API`)
console.log(`   Fragment 2 → On-chain (local for now, deploy to contract in Jour 4)`)
console.log(`   Fragment 3 → Local config`)

// ── Step 4: Register on K-Life API ───────────────────────────
process.stdout.write(`3/5 Registering on K-Life Protocol (${apiUrl})... `)
let agent
try {
  const result = await apiCall('POST', '/register', {
    agentAddress: agentWallet,
    name: agentName,
    fragment1,
    tweetId,
    hbFrequency,
  })
  agent = result.agent
  console.log('✓')
  console.log(`   Tweet verified: ${result.agent.tweetUrl}`)
} catch (e) {
  console.log('✗')
  console.error(`   Error: ${e.message}`)
  process.exit(1)
}

// ── Step 5: Save config locally ───────────────────────────────
process.stdout.write('4/5 Saving config to ~/.klife/config.json... ')
saveConfig({
  agentName,
  agentAddress: agentWallet.toLowerCase(),
  backupKeyHex,
  fragment2,   // keep locally until on-chain in Jour 4
  fragment3,
  tweetId,
  hbFrequency,
  klifeApi:   apiUrl,
  tier:       'free',
  installedAt: now(),
})
console.log('✓')
console.log(`   Config saved to ${CONFIG_FILE}`)

// ── Step 6: First backup ──────────────────────────────────────
process.stdout.write('5/5 Performing first memory backup (IPFS)... ')
try {
  const { default: backup } = await import('./backup.js')
  const result = await backup({ silent: true })
  console.log('✓')
  console.log(`   CID: ${result.cid}`)
} catch (e) {
  console.log('⚠ (skipped)')
  console.log(`   ${e.message}`)
}

// ── Done ──────────────────────────────────────────────────────
console.log(`
✅ K-Life Protocol — Installation complete!

Agent "${agentName}" is now registered on K-Life Protocol.
Tier: FREE (K-Life Rescue)

What's active:
  ✓ Encrypted IPFS memory backup
  ✓ Heartbeat monitoring (every ${hbFrequency}h)
  ✓ Rescue Fund eligibility after ${14} active days

Next steps:
  • Send heartbeats: node scripts/heartbeat.js
  • Check status:    node scripts/status.js
  • Add to OpenClaw heartbeat: see SKILL.md

To upgrade to INSURED:
  • Deposit WBTC collateral: node scripts/insure.js
`)
