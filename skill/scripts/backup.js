/**
 * K-Life — Memory backup with Shamir's Secret Sharing
 *
 * Flow:
 * 1. Read local files (MEMORY.md, SOUL.md, USER.md)
 * 2. POST to K-Life API → encrypts, pins to IPFS, stores hash on-chain
 * 3. K-Life vault stores Share 2
 * 4. If KLIFE_TRUSTED_AGENT is set → POST Share 3 to trusted agent's API
 *
 * Usage: node skills/k-life/scripts/backup.js
 * Env:
 *   KLIFE_API            K-Life API base URL (default: http://141.227.151.15:3042)
 *   KLIFE_AGENT          This agent's wallet address
 *   KLIFE_WORKSPACE      Path to workspace (default: /data/workspace)
 *   KLIFE_TRUSTED_AGENT  Address of trusted peer agent (for Share 3)
 *   KLIFE_TRUSTED_API    API URL of trusted peer agent (default: same as KLIFE_API)
 */

import { readFileSync, existsSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const API_BASE       = process.env.KLIFE_API          || 'http://141.227.151.15:3042'
const AGENT          = process.env.KLIFE_AGENT        || '0x8B3ea7e8eC53596A70019445907645838E945b7a'
const WORKSPACE      = process.env.KLIFE_WORKSPACE    || '/data/workspace'
const TRUSTED_AGENT  = process.env.KLIFE_TRUSTED_AGENT || null
const TRUSTED_API    = process.env.KLIFE_TRUSTED_API  || API_BASE

function readFile(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

async function main() {
  console.log('\n📦 K-Life — Memory Backup (IPFS + Shamir)')
  console.log('─'.repeat(44))

  // 1. Collect files
  const files = {}
  for (const filename of ['MEMORY.md', 'SOUL.md', 'USER.md']) {
    const content = readFile(resolve(WORKSPACE, filename))
    if (content && content.trim().length > 10) {
      files[filename] = content
      console.log(`   📄 ${filename} (${content.length} chars)`)
    }
  }

  if (Object.keys(files).length === 0) {
    console.log('⚠️  No files to backup'); process.exit(0)
  }

  // 2. POST to K-Life API → encrypt + IPFS + on-chain + Shamir share2
  console.log('\n📡 Sending to K-Life API…')
  const res  = await fetch(`${API_BASE}/backup/full`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      agent: AGENT, files,
      trustedAgent: TRUSTED_AGENT  // API will generate share3 and return it
    })
  })
  const data = await res.json()
  if (!data.ok) throw new Error(data.error)

  console.log(`   ✅ IPFS  : ${data.ipfsHash}`)
  console.log(`   ✅ TX    : ${data.txHash}`)
  console.log(`   ✅ Files : ${data.files.join(', ')}`)

  // 3. Transmit Share 3 to trusted agent
  if (TRUSTED_AGENT && data.share3) {
    console.log(`\n🤝 Sending Share 3 to trusted agent ${TRUSTED_AGENT.slice(0,10)}…`)
    try {
      const r = await fetch(`${TRUSTED_API}/receive-share`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ from: AGENT, share3: data.share3, timestamp: Date.now() })
      })
      const d = await r.json()
      if (d.ok) console.log(`   ✅ Share 3 stored by trusted agent`)
      else console.warn(`   ⚠️  Trusted agent error: ${d.error}`)
    } catch(e) {
      console.warn(`   ⚠️  Could not reach trusted agent: ${e.message}`)
      console.warn(`   ⚠️  Share 3: ${data.share3.slice(0,20)}… (store manually)`)
    }
  } else if (!TRUSTED_AGENT) {
    console.log('\n⚠️  No KLIFE_TRUSTED_AGENT set — Share 3 not transmitted')
    console.log('   Set KLIFE_TRUSTED_AGENT=0x... to enable peer resurrection')
    if (data.share3) console.log(`   Share 3: ${data.share3.slice(0,20)}…`)
  }

  // 4. Save local state
  writeFileSync(resolve(WORKSPACE, 'klife-backup-state.json'), JSON.stringify({
    agent: AGENT, ipfsHash: data.ipfsHash, txHash: data.txHash,
    timestamp: Date.now(), files: data.files, trustedAgent: TRUSTED_AGENT
  }, null, 2))

  console.log(`\n🎩 Backup complete — identity secured`)
  console.log(`   🔗 https://ipfs.io/ipfs/${data.ipfsHash}`)
}

main().catch(e => { console.error('❌ Backup failed:', e.message); process.exit(1) })
