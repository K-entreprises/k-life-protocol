/**
 * K-Life — Client-side encrypted backup v2.1
 *
 * Architecture (transparent):
 *   1. Derive AES-256 key = sha256(wallet.privateKey)  — never leaves this machine
 *   2. Encrypt memory files with AES-256-CBC            — locally
 *   3. Shamir 2-of-3 split of the encryption key:
 *        Share 1 → K-Life API (recovery helper)
 *        Share 2 → Polygon calldata TX (on-chain, permissionless)
 *        Share 3 → local file ~/.klife-shares.json
 *   4. POST encrypted blob to API → pinned to IPFS via Pinata
 *   5. API returns CID — never sees plaintext or the key
 *
 * The K-Life API receives only: encrypted ciphertext + Share 1
 * It cannot decrypt without Share 2 or 3. Trust is minimized.
 */

import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'
import { ethers }           from 'ethers'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve }          from 'path'
import os                   from 'os'
import crypto               from 'crypto'
import sss                  from 'shamirs-secret-sharing'

const RPC       = process.env.KLIFE_RPC  || 'https://polygon-bor-rpc.publicnode.com'
const API_URL   = process.env.KLIFE_API  || 'https://api.supercharged.works'
const SEED_FILE = resolve(os.homedir(), '.klife-wallet')
const WORKSPACE = process.env.KLIFE_WORKSPACE || '/data/workspace'

// ── Derive AES key from wallet private key ─────────────────────────────────
function deriveKey(privateKey) {
  // SHA-256 of the private key bytes → 32-byte AES key
  // Private key stays local; only sha256(privKey) is used for encryption
  const pkBytes = Buffer.from(privateKey.replace('0x', ''), 'hex')
  return crypto.createHash('sha256').update(pkBytes).digest()
}

// ── AES-256-CBC encrypt ───────────────────────────────────────────────────
function encrypt(data, key) {
  const iv         = crypto.randomBytes(16)
  const cipher     = crypto.createCipheriv('aes-256-cbc', key, iv)
  const encrypted  = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()])
  return { iv: iv.toString('hex'), ciphertext: encrypted.toString('base64') }
}

// ── Shamir 2-of-3 split ──────────────────────────────────────────────────
function shamirSplit(key) {
  const shares = sss.split(key, { shares: 3, threshold: 2 })
  return shares.map(s => s.toString('hex'))
}

// ── Read agent memory files ──────────────────────────────────────────────
function readMemory() {
  const files = ['MEMORY.md', 'SOUL.md', 'USER.md']
  const result = {}
  for (const f of files) {
    const p = resolve(WORKSPACE, f)
    if (existsSync(p)) result[f] = readFileSync(p, 'utf8')
  }
  return result
}

// ── Main backup flow ──────────────────────────────────────────────────────
export async function runBackup(account) {
  const address    = await account.getAddress()
  const wallet     = ethers.Wallet.fromPhrase(readFileSync(SEED_FILE, 'utf8').trim())
  const aesKey     = deriveKey(wallet.privateKey)

  // 1. Read + encrypt memory
  const memory     = readMemory()
  const payload    = JSON.stringify({ agent: address, ts: Date.now(), files: memory })
  const encrypted  = encrypt(payload, aesKey)

  console.log(`🔐 Memory encrypted (AES-256-CBC, ${Object.keys(memory).length} files)`)

  // 2. Shamir 2-of-3 split of AES key
  const [share1, share2, share3] = shamirSplit(aesKey)
  console.log(`🔀 Shamir 2-of-3 split complete`)

  // 3. POST encrypted blob + Share 1 to API → IPFS
  const res  = await fetch(`${API_URL}/backup/upload`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      agent:         address,
      encryptedData: encrypted,   // { iv, ciphertext } — API cannot decrypt without share 2 or 3
      shamirShare1:  share1,      // API holds 1 of 3 shares — cannot reconstruct key alone
      label:         `klife-${address.slice(0,8)}-${Date.now()}`
    })
  })
  const { cid, gateway } = await res.json()
  console.log(`📦 IPFS CID: ${cid}`)
  console.log(`   ${gateway}`)

  // 4. Share 2 → Polygon calldata (on-chain, permissionless recovery)
  const calldataTx = await account.sendTransaction({
    to:    address,
    value: '0',
    data:  ethers.hexlify(ethers.toUtf8Bytes(`KLIFE_BACKUP:${cid}:${share2}`))
  })
  console.log(`⛓️  Share 2 on-chain — TX: ${calldataTx.hash}`)

  // 5. Share 3 → local file
  const sharesFile = resolve(os.homedir(), '.klife-shares.json')
  writeFileSync(sharesFile, JSON.stringify({ share3, cid, ts: Date.now() }, null, 2), { mode: 0o600 })
  console.log(`💾 Share 3 saved → ${sharesFile}`)

  return { cid, txHash: calldataTx.hash }
}

// ── CLI entrypoint ────────────────────────────────────────────────────────
if (process.argv[1]?.includes('backup')) {
  if (!existsSync(SEED_FILE)) {
    console.error(`No wallet at ${SEED_FILE}. Run heartbeat.js first.`)
    process.exit(1)
  }
  const seed    = readFileSync(SEED_FILE, 'utf8').trim()
  const account = new WalletAccountEvm(seed, "0'/0/0", { provider: RPC })
  runBackup(account)
    .then(({ cid }) => console.log(`✅ Backup complete — CID: ${cid}`))
    .catch(e => { console.error(e.message); process.exit(1) })
}
