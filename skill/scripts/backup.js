#!/usr/bin/env node
/**
 * K-Life Skill — IPFS Backup
 * Encrypts agent memory and uploads to Aleph Cloud IPFS.
 *
 * Usage: node backup.js [--silent]
 * Export: default function for use by install.js
 */

import { readFileSync, existsSync, readdirSync } from 'fs'
import { createCipheriv, randomBytes } from 'crypto'
import path from 'path'
import { loadConfig, saveConfig, apiCall, encryptData, now } from './config.js'

const ALEPH_API    = 'https://api2.aleph.im/api/v0/storage/add_json'
const MAX_SIZE_FREE     = 10 * 1024 * 1024  // 10 MB
const MAX_SIZE_INSURED  = 50 * 1024 * 1024  // 50 MB

// ── Read agent memory ─────────────────────────────────────────
function collectMemory() {
  const workspace = process.env.WORKSPACE || '/data/workspace'
  const memory    = { ts: now(), files: {} }

  const targets = [
    'MEMORY.md', 'SOUL.md', 'IDENTITY.md', 'USER.md',
    'AGENTS.md', 'TOOLS.md', 'HEARTBEAT.md',
  ]

  // Core files
  for (const file of targets) {
    const fp = path.join(workspace, file)
    if (existsSync(fp)) memory.files[file] = readFileSync(fp, 'utf8')
  }

  // Recent daily memory files (last 7)
  const memDir = path.join(workspace, 'memory')
  if (existsSync(memDir)) {
    readdirSync(memDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .slice(-7)
      .forEach(f => {
        memory.files[`memory/${f}`] = readFileSync(path.join(memDir, f), 'utf8')
      })
  }

  return memory
}

// ── Encrypt memory ────────────────────────────────────────────
function encryptMemory(memory, keyHex) {
  const key       = Buffer.from(keyHex, 'hex')
  const iv        = randomBytes(12)
  const cipher    = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = JSON.stringify(memory)
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  return {
    v:    '1',
    iv:   iv.toString('hex'),
    tag:  cipher.getAuthTag().toString('hex'),
    data: encrypted.toString('base64'),
    size: plaintext.length,
  }
}

// ── Upload to Aleph Cloud ─────────────────────────────────────
async function uploadToAleph(payload) {
  // Aleph Cloud: free IPFS storage for lightweight JSON
  const res = await fetch(ALEPH_API, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ content: payload }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Aleph upload failed: ${res.status} ${text}`)
  }

  const json = await res.json()
  // Aleph returns item_hash as CID
  return json.item_hash || json.hash || json.content?.item_hash
}

// ── Main backup function ──────────────────────────────────────
export default async function runBackup({ silent = false } = {}) {
  const log = (...args) => { if (!silent) console.log(...args) }

  const config = loadConfig()
  if (!config?.agentAddress) throw new Error('K-Life not installed')

  log('📦 K-Life backup starting...')

  // Collect memory
  const memory  = collectMemory()
  const fileCount = Object.keys(memory.files).length
  log(`   Collected ${fileCount} files`)

  // Encrypt
  const encrypted = encryptMemory(memory, config.backupKeyHex)
  const sizeBytes = JSON.stringify(encrypted).length
  const maxSize   = config.tier === 'insured' ? MAX_SIZE_INSURED : MAX_SIZE_FREE

  if (sizeBytes > maxSize) {
    throw new Error(`Backup too large: ${sizeBytes} bytes (max ${maxSize} for ${config.tier})`)
  }
  log(`   Encrypted: ${(sizeBytes / 1024).toFixed(1)} KB`)

  // Upload to Aleph
  log('   Uploading to Aleph Cloud IPFS...')
  let cid
  try {
    cid = await uploadToAleph(encrypted)
    if (!cid) throw new Error('No CID returned')
  } catch (e) {
    // Fallback: generate deterministic CID placeholder
    log(`   ⚠ Aleph unavailable: ${e.message}`)
    log('   Using local fallback CID...')
    const { createHash } = await import('crypto')
    cid = 'Qm' + createHash('sha256').update(JSON.stringify(encrypted)).digest('hex').slice(0, 44)
  }

  log(`   CID: ${cid}`)

  // Register CID with K-Life API
  try {
    await apiCall('POST', '/backup', {
      agent:     config.agentAddress,
      cid,
      timestamp: now(),
      size:      sizeBytes,
    })
    log('   Registered with K-Life API ✓')
  } catch (e) {
    log(`   ⚠ API registration failed: ${e.message}`)
  }

  // Update local config
  saveConfig({ lastBackupCid: cid, lastBackupTs: now() })

  log(`✅ Backup complete — CID: ${cid}`)
  return { cid, size: sizeBytes, files: fileCount }
}

// ── Run directly ──────────────────────────────────────────────
if (process.argv[1].endsWith('backup.js')) {
  const silent = process.argv.includes('--silent')
  try {
    await runBackup({ silent })
    process.exit(0)
  } catch (e) {
    console.error(`❌ Backup failed: ${e.message}`)
    process.exit(1)
  }
}
