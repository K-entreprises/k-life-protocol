/**
 * K-Life — Resurrection (zero-backup)
 * Level 1: K-Life API -> IPFS hash
 * Level 2: RPC blockchain scan -> calldata -> IPFS hash
 */
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import { ethers }       from 'ethers'
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { createDecipheriv, createHash } from 'crypto'

const RPC       = process.env.KLIFE_RPC || 'https://rpc-amoy.polygon.technology'
const SEED_FILE = '/home/debian/klife-api/.agent-seed'
const SEED      = process.env.KLIFE_SEED || (existsSync(SEED_FILE) ? readFileSync(SEED_FILE,'utf8').trim() : null)
const WORKSPACE = process.env.KLIFE_WORKSPACE || '/data/workspace'
const API_BASE  = process.env.KLIFE_API || 'http://localhost:3042'
const IPFS_GATEWAYS = ['https://ipfs.io/ipfs','http://127.0.0.1:8080/ipfs','https://cloudflare-ipfs.com/ipfs']

if (!SEED) { console.error('No seed. Set KLIFE_SEED.'); process.exit(1) }

function decrypt(enc, key) {
  if (!enc) return null
  try {
    const [iv, data] = enc.split(':')
    const d = createDecipheriv('aes-256-cbc', createHash('sha256').update(key).digest(), Buffer.from(iv,'hex'))
    return Buffer.concat([d.update(Buffer.from(data,'hex')), d.final()]).toString('utf8')
  } catch { return null }
}

function memoryEmpty() {
  const p = resolve(WORKSPACE,'MEMORY.md')
  return !existsSync(p) || readFileSync(p,'utf8').trim().length < 50
}

async function fetchIPFS(hash) {
  for (const gw of IPFS_GATEWAYS) {
    try {
      const r = await fetch(`${gw}/${hash}`, { signal: AbortSignal.timeout(8000) })
      if (r.ok) { console.log(`   ✅ ${gw}`); return r.json() }
    } catch(e) { console.log(`   ⚠️  ${gw}: ${e.message}`) }
  }
  throw new Error('All IPFS gateways failed')
}

// Level 1: K-Life API
async function hashFromAPI(address) {
  try {
    // Check state file first (fastest)
    const sf = '/home/debian/klife-api/klife-backup-state.json'
    if (existsSync(sf)) {
      const s = JSON.parse(readFileSync(sf,'utf8'))
      if (s.ipfsHash) { console.log(`   ✅ From local state: ${s.ipfsHash}`); return s.ipfsHash }
    }
    // Then API
    const r = await fetch(`${API_BASE}/backup/${address}`, { signal: AbortSignal.timeout(5000) })
    const d = await r.json()
    if (d.ok && d.ipfsHash) { console.log(`   ✅ From K-Life API: ${d.ipfsHash}`); return d.ipfsHash }
  } catch(e) { console.log(`   ⚠️  API: ${e.message}`) }
  return null
}

// Level 2: blockchain scan via RPC
async function hashFromChain(address) {
  console.log('   Scanning blockchain via RPC…')
  const provider = new ethers.JsonRpcProvider(RPC)
  const latest   = await provider.getBlockNumber()
  // Scan last 5000 blocks, batch of 50
  for (let b = latest; b >= Math.max(0, latest - 5000); b -= 50) {
    try {
      const block = await provider.getBlock(b, true)
      if (!block?.transactions) continue
      for (const tx of block.transactions) {
        if (typeof tx !== 'object') continue
        if (tx.from?.toLowerCase() !== address.toLowerCase()) continue
        if (!tx.data || tx.data.length < 10) continue
        try {
          const decoded = Buffer.from(tx.data.slice(2),'hex').toString('utf8')
          if (decoded.startsWith('KLIFE_BACKUP:')) {
            const hash = decoded.replace('KLIFE_BACKUP:','').trim()
            console.log(`   ✅ Block ${b}: ${hash}`)
            return hash
          }
        } catch {}
      }
    } catch {}
  }
  return null
}

async function main() {
  console.log('\n🔮 K-Life — Resurrection Protocol')
  console.log('═'.repeat(52))

  const wm      = new WalletManagerEvm(SEED, { provider: RPC, chainId: 80002 })
  const account = await wm.getAccount(0)
  const address = await account.getAddress()
  // Security: use private key (not public address) as AES decryption key
  const _privWallet = ethers.Wallet.fromPhrase(SEED)
  const privKey = _privWallet.privateKey
  console.log(`🔑 Address: ${address}`)

  if (!memoryEmpty()) { console.log('✅ Memory intact — no resurrection needed'); process.exit(0) }
  console.log('⚠️  Memory empty — resurrection initiated\n')

  // Find hash
  console.log('📍 Level 1 — K-Life API…')
  let hash = await hashFromAPI(address)

  if (!hash) {
    console.log('\n☢️  Level 2 — Blockchain scan (nuclear mode)…')
    hash = await hashFromChain(address)
  }

  if (!hash) { console.log('No backup found.'); process.exit(0) }

  console.log(`\n📡 Fetching from IPFS (${hash})…`)
  const backup = await fetchIPFS(hash)
  if (!backup?.files) throw new Error('Invalid backup — no files')

  console.log('\n🔓 Restoring files…')
  mkdirSync(WORKSPACE, { recursive: true })
  let n = 0
  for (const [file, enc] of Object.entries(backup.files)) {
    const content = decrypt(enc, privKey)
    if (!content) { console.warn(`   ⚠️  ${file}: decrypt failed`); continue }
    const fp = resolve(WORKSPACE, file)
    mkdirSync(dirname(fp), { recursive: true })
    writeFileSync(fp, content)
    console.log(`   ✅ ${file} (${content.length} chars)`)
    n++
  }

  console.log('\n' + '═'.repeat(52))
  if (n > 0) {
    console.log(`🎉 RESURRECTED — ${n} file(s) restored`)
    console.log(`   Time   : ${backup.iso}`)
    console.log(`   IPFS   : ${hash}`)
    console.log(`   Identity intact. Mission continues. 🎩`)
  } else {
    console.log('⚠️  Backup found but nothing restored')
    process.exit(1)
  }
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1) })
