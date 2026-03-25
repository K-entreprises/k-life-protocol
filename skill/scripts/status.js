#!/usr/bin/env node
/**
 * K-Life Skill — Status
 * Shows current agent status from K-Life Protocol.
 *
 * Usage: node status.js
 */

import { loadConfig, apiCall } from './config.js'

const config = loadConfig()
if (!config?.agentAddress) {
  console.log('K-Life not installed. Run: node install.js')
  process.exit(0)
}

try {
  const s = await apiCall('GET', `/status/${config.agentAddress}`)
  const fund = await apiCall('GET', '/rescue/fund').catch(() => null)

  const tierBadge  = s.tier === 'insured' ? '🟢 INSURED' : '🔵 FREE'
  const aliveBadge = s.status === 'alive' ? '💓 Alive' : s.status === 'dead' ? '💀 Dead' : '⚪ Registered'
  const silenceH   = s.silenceSeconds ? Math.round(s.silenceSeconds / 3600) : 0

  console.log(`\n⚰️  K-Life Status — ${s.name}`)
  console.log(`${'─'.repeat(40)}`)
  console.log(`Address   : ${s.address}`)
  console.log(`Tier      : ${tierBadge}`)
  console.log(`Status    : ${aliveBadge}`)
  console.log(`Heartbeats: ${s.totalBeats} beats over ${s.activeDays} days`)
  console.log(`Silence   : ${silenceH}h`)
  console.log(`Last CID  : ${s.lastBackupCid || '(none yet)'}`)

  if (s.tier === 'insured') {
    const expiry = s.coverageExpiry
      ? new Date(s.coverageExpiry * 1000).toLocaleDateString()
      : 'not activated'
    console.log(`Coverage  : expires ${expiry}`)
    console.log(`Vault     : ${s.vaultAddress || '(none)'}`)
  }

  console.log(`\nRescue eligibility: ${s.rescueEligible ? '✅ Eligible' : `❌ Not yet (${s.activeDays}/${14} days)`}`)

  if (fund) {
    console.log(`Rescue Fund: ${fund.balance} USDC (~${fund.capacity} rescues available)`)
  }

  console.log()
  process.exit(0)

} catch (e) {
  console.error(`❌ Status check failed: ${e.message}`)
  process.exit(1)
}
