#!/usr/bin/env node
/**
 * K-Life Skill — Heartbeat
 * Sends a heartbeat to K-Life API.
 * Called by OpenClaw heartbeat cron every N hours.
 *
 * Usage: node heartbeat.js [--silent]
 * Exit 0 = success, Exit 1 = failure
 */

import { loadConfig, apiCall, now } from './config.js'

const silent = process.argv.includes('--silent')
const log    = (...args) => { if (!silent) console.log(...args) }

const config = loadConfig()
if (!config?.agentAddress) {
  console.error('K-Life not installed. Run: node install.js')
  process.exit(1)
}

const ts = now()

try {
  const result = await apiCall('POST', '/heartbeat', {
    agent:     config.agentAddress,
    timestamp: ts,
    // signature: generated here in production (sign with wallet key)
  })

  log(`💓 K-Life heartbeat #${result.beat} sent — ${new Date(ts * 1000).toISOString()}`)
  process.exit(0)

} catch (e) {
  log(`❌ K-Life heartbeat failed: ${e.message}`)
  process.exit(1)
}
