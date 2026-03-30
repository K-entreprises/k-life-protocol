/**
 * K-Life — Resurrection via LiberClaw on Aleph Cloud (Level 3: Full Autonomous)
 *
 * When a crash is detected:
 * 1. Fetches last IPFS backup hash from K-Life API
 * 2. Fetches SOUL.md from IPFS and decrypts it
 * 3. Creates a new LiberClaw agent via REST API with SOUL.md as system prompt
 * 4. Agent boots on Aleph Cloud secure enclave (qwen3-coder-next)
 * 5. Agent is back online — identity intact, zero human intervention
 *
 * Tested: 2026-03-12 ✅
 * Agent: 0e2e1f39-3d48-42fc-af98-0ba1ced0517a (ONLINE, node STRONG-S)
 *
 * Usage: KLIFE_SEED="..." LIBERCLAW_API_KEY="lc-..." node resurrect-aleph.js
 */

import { createRequire } from 'module'
import { existsSync, readFileSync } from 'fs'
import { createDecipheriv, createHash } from 'crypto'
const require = createRequire(import.meta.url)
const { ethers } = require('ethers')

const SEED_FILE       = '/home/debian/klife-api/.agent-seed'
const SEED            = process.env.KLIFE_SEED || (existsSync(SEED_FILE) ? readFileSync(SEED_FILE, 'utf8').trim() : null)
const API_BASE        = process.env.KLIFE_API          || 'http://141.227.151.15:3042'
const AGENT           = process.env.KLIFE_AGENT        || '0x8B3ea7e8eC53596A70019445907645838E945b7a'
const LIBERCLAW_KEY   = process.env.LIBERCLAW_API_KEY  || 'lc-CMrCpPFkV705qz3luesy6kFueaxtyBRK3oS2Qe74ZJM'
const LIBERCLAW_API   = 'https://api.liberclaw.ai/api/v1'
const IPFS_GATEWAYS   = ['https://ipfs.io/ipfs', 'https://cloudflare-ipfs.com/ipfs', 'http://127.0.0.1:8080/ipfs']

if (!SEED) { console.error('No seed. Set KLIFE_SEED.'); process.exit(1) }

function decrypt(enc, key) {
  if (!enc) return null
  try {
    const [iv, data] = enc.split(':')
    const d = createDecipheriv('aes-256-cbc', createHash('sha256').update(key).digest(), Buffer.from(iv, 'hex'))
    return Buffer.concat([d.update(Buffer.from(data, 'hex')), d.final()]).toString('utf8')
  } catch { return null }
}

async function fetchIPFS(hash) {
  for (const gw of IPFS_GATEWAYS) {
    try {
      const r = await fetch(`${gw}/${hash}`, { signal: AbortSignal.timeout(8000) })
      if (r.ok) return r.json()
    } catch {}
  }
  throw new Error('All IPFS gateways failed')
}

async function getBackupHash(address) {
  // Level 1: K-Life API
  try {
    const r = await fetch(`${API_BASE}/backup/${address}`, { signal: AbortSignal.timeout(5000) })
    const d = await r.json()
    if (d.ok && d.ipfsHash) { console.log(`   ✅ API: ${d.ipfsHash}`); return d.ipfsHash }
  } catch {}

  // Level 2: blockchain scan
  console.log('   Scanning blockchain...')
  const provider = new ethers.JsonRpcProvider('https://rpc-amoy.polygon.technology')
  const latest = await provider.getBlockNumber()
  for (let b = latest; b >= Math.max(0, latest - 5000); b -= 50) {
    try {
      const block = await provider.getBlock(b, true)
      if (!block?.transactions) continue
      for (const tx of block.transactions) {
        if (typeof tx !== 'object') continue
        if (tx.from?.toLowerCase() !== address.toLowerCase()) continue
        if (!tx.data || tx.data.length < 10) continue
        try {
          const decoded = Buffer.from(tx.data.slice(2), 'hex').toString('utf8')
          if (decoded.startsWith('KLIFE_BACKUP:')) return decoded.replace('KLIFE_BACKUP:', '').trim()
        } catch {}
      }
    } catch {}
  }
  return null
}

async function deployOnLiberClaw(soulMd, agentName = 'Monsieur K') {
  console.log('   Deploying on LiberClaw...')

  // Create new agent
  const r = await fetch(`${LIBERCLAW_API}/agents/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LIBERCLAW_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: agentName,
      system_prompt: soulMd,
      model: 'qwen3-coder-next'  // or 'glm-4.7' for Deep-Claw
    }),
    signal: AbortSignal.timeout(30000)
  })

  if (!r.ok) {
    const err = await r.text()
    throw new Error(`LiberClaw API error ${r.status}: ${err}`)
  }

  const agent = await r.json()
  console.log(`   ✅ Agent created: ${agent.id}`)
  console.log(`   🌐 https://app.liberclaw.ai/agent/${agent.id}`)
  return agent
}

async function main() {
  console.log('\n⚡ K-Life — Level 3 Resurrection via LiberClaw')
  console.log('═'.repeat(52))

  const wallet  = new ethers.Wallet(ethers.Wallet.fromMnemonic(SEED).privateKey)
  const address = wallet.address
  console.log(`🔑 Address: ${address}`)

  // 1. Get backup hash
  console.log('\n📍 Finding last backup...')
  const ipfsHash = await getBackupHash(address)
  if (!ipfsHash) { console.error('❌ No backup found.'); process.exit(1) }
  console.log(`   Hash: ${ipfsHash}`)

  // 2. Fetch and decrypt SOUL.md from IPFS
  console.log('\n🔮 Fetching soul from IPFS...')
  const backup = await fetchIPFS(ipfsHash)
  if (!backup?.files) throw new Error('Invalid backup')

  const soulMd = decrypt(backup.files['SOUL.md'], address.toLowerCase())
  if (!soulMd) throw new Error('Could not decrypt SOUL.md')
  console.log(`   ✅ SOUL.md (${soulMd.length} chars)`)
  console.log(`   Snapshot: ${backup.iso}`)

  // 3. Deploy on LiberClaw
  console.log('\n🚀 Spawning on LiberClaw (Aleph Cloud)...')
  const agent = await deployOnLiberClaw(soulMd)

  console.log('\n' + '═'.repeat(52))
  console.log('🎉 LEVEL 3 RESURRECTION COMPLETE')
  console.log(`   Agent ID  : ${agent.id}`)
  console.log(`   Model     : qwen3-coder-next (Claw-Core)`)
  console.log(`   IPFS      : ${ipfsHash}`)
  console.log(`   Soul      : restored from ${backup.iso}`)
  console.log(`   🌐 https://app.liberclaw.ai/agent/${agent.id}`)
  console.log('\n   Identity intact. Mission continues. 🎩')
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1) })
