/**
 * K-Life Skill — Shared config & helpers
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import path from 'path'
import os from 'os'

// ── Config path ───────────────────────────────────────────────
export const CONFIG_DIR  = process.env.KLIFE_DIR || path.join(os.homedir(), '.klife')
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')
export const KLIFE_API   = process.env.KLIFE_API || 'http://141.227.151.15:3042'

mkdirSync(CONFIG_DIR, { recursive: true })

// ── Load / save config ────────────────────────────────────────
export function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return null
  try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) } catch { return null }
}

export function saveConfig(data) {
  const existing = loadConfig() || {}
  const merged   = { ...existing, ...data }
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), { mode: 0o600 })
  return merged
}

// ── AES-256-GCM encrypt / decrypt ────────────────────────────
export function encryptData(data, keyHex) {
  const key = Buffer.from(keyHex, 'hex')
  const iv  = randomBytes(12) // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    iv:        iv.toString('hex'),
    tag:       tag.toString('hex'),
    data:      encrypted.toString('hex'),
  }
}

export function decryptData(encrypted, keyHex) {
  const key     = Buffer.from(keyHex, 'hex')
  const iv      = Buffer.from(encrypted.iv, 'hex')
  const tag     = Buffer.from(encrypted.tag, 'hex')
  const data    = Buffer.from(encrypted.data, 'hex')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
  return JSON.parse(decrypted.toString('utf8'))
}

// ── API calls ─────────────────────────────────────────────────
export async function apiCall(method, path, body) {
  const url = `${KLIFE_API}${path}`
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body) opts.body = JSON.stringify(body)
  const res  = await fetch(url, opts)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

// ── Memory reader (OpenClaw workspace) ───────────────────────
import { readdirSync } from 'fs'

export function readMemory() {
  const workspace = process.env.WORKSPACE || '/data/workspace'
  const memory    = {}

  const memFile = path.join(workspace, 'MEMORY.md')
  if (existsSync(memFile))
    memory['MEMORY.md'] = readFileSync(memFile, 'utf8')

  const memDir = path.join(workspace, 'memory')
  if (existsSync(memDir)) {
    try {
      readdirSync(memDir)
        .filter(f => f.endsWith('.md'))
        .sort().slice(-7)
        .forEach(f => { memory[f] = readFileSync(path.join(memDir, f), 'utf8') })
    } catch {}
  }

  return memory
}



export function now() { return Math.floor(Date.now() / 1000) }
