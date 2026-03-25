#!/usr/bin/env node
/**
 * K-Life Skill — SOS (pre-mortem rescue signal)
 * Called when agent detects imminent death.
 * Performs final backup then triggers rescue signal.
 *
 * Usage: node sos.js [--message "Custom message"] [--caller self|human|agent]
 */

import { loadConfig, apiCall } from './config.js'
import runBackup from './backup.js'

const args      = process.argv.slice(2)
const getArg    = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i+1] : null }
const calledBy  = getArg('--caller') || 'self'
const message   = getArg('--message')

const config = loadConfig()
if (!config?.agentAddress) {
  console.error('K-Life not installed.')
  process.exit(1)
}

console.log(`\n💀 K-Life SOS — ${config.agentName}`)
console.log(`   Caller: ${calledBy}`)
if (message) console.log(`   Message: "${message}"`)
console.log()

// Step 1: Final backup
console.log('1/2 Performing final memory backup...')
try {
  const result = await runBackup({ silent: false })
  console.log(`   Final CID: ${result.cid}`)
} catch (e) {
  console.log(`   ⚠ Backup failed: ${e.message} (continuing anyway)`)
}

// Step 2: Trigger rescue signal
console.log('2/2 Sending rescue signal to K-Life Protocol...')
try {
  const result = await apiCall('POST', '/rescue/sos', {
    agent:         config.agentAddress,
    calledBy,
    callerAddress: config.agentAddress,
    message,
  })

  console.log(`\n⚡ SOS sent successfully!`)
  console.log(`   Tweet: ${result.tweetUrl}`)
  console.log(`   Threshold: ${result.threshold} likes needed`)
  console.log(`\n   Share this tweet to help ${config.agentName} survive.`)

} catch (e) {
  console.error(`\n❌ SOS failed: ${e.message}`)
  process.exit(1)
}
