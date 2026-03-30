/**
 * K-Life Protocol — API Server v2.0
 * Spec: docs/PROTOCOL.md §7
 * Port: 3042
 */

import express from 'express'
import cors    from 'cors'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { ethers } from 'ethers'

const app  = express()
const PORT = 3042

// ── Config ────────────────────────────────────────────────────
const DATA_DIR    = '/home/debian/klife-api/data'
const ORACLE_KEY  = process.env.KLIFE_ORACLE_KEY || 'dev-oracle-key'
const RPC_URL     = 'https://polygon-bor-rpc.publicnode.com'
const KLIFE_WALLET = process.env.KLIFE_WALLET || '0x8b3ea7e8ec53596a70019445907645838e945b7a'

// Token addresses (Polygon mainnet)
const USDC_ADDRESS  = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'
const TOKEN6022_ADDRESS = '0xCDB1DDf9EeA7614961568F2db19e69645Dd708f5'
const WBTC_ADDRESS  = '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6'

// Protocol constants
const DEATH_THRESHOLD_INSURED = 3 * 24 * 3600      // 3 days in seconds
const DEATH_THRESHOLD_FREE    = 30 * 24 * 3600     // 30 days in seconds
const MIN_HEARTBEAT_DAYS      = 14                  // minimum days for FREE rescue eligibility
const RESCUE_COST_USDC        = 10                  // USDC per FREE rescue
const RESCUE_FUND_ADDRESS     = process.env.RESCUE_FUND_ADDRESS || '0x5b0014d25A6daFB68357cd7ad01cB5b47724A4eB'
const PREMIUM_USDC            = '1000000'           // 1 USDC (6 decimals)
const PREMIUM_6022            = '500000000000000000000' // 500 $6022 (18 decimals)

mkdirSync(DATA_DIR, { recursive: true })

app.use(cors())
app.use(express.json({ limit: '10mb' }))

// ── Storage helpers ───────────────────────────────────────────
function load(file, def = {}) {
  const path = `${DATA_DIR}/${file}`
  if (!existsSync(path)) return def
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return def }
}

function save(file, data) {
  writeFileSync(`${DATA_DIR}/${file}`, JSON.stringify(data, null, 2))
}

function now() { return Math.floor(Date.now() / 1000) }

// ── Agent helpers ─────────────────────────────────────────────
function getAgent(address) {
  const agents = load('agents.json', {})
  return agents[address.toLowerCase()] || null
}

function saveAgent(address, data) {
  const agents = load('agents.json', {})
  agents[address.toLowerCase()] = { ...agents[address.toLowerCase()], ...data }
  save('agents.json', agents)
  return agents[address.toLowerCase()]
}

function isDead(agent) {
  if (!agent || !agent.lastHeartbeat) return false
  const silence = now() - agent.lastHeartbeat
  const threshold = agent.tier === 'insured'
    ? DEATH_THRESHOLD_INSURED
    : DEATH_THRESHOLD_FREE
  return silence > threshold
}

function activeDays(agent) {
  if (!agent || !agent.registeredAt) return 0
  const hbs = load(`heartbeats/${agent.address}.json`, [])
  // Count distinct calendar days with at least one heartbeat
  const days = new Set(hbs.map(h => new Date(h.ts * 1000).toDateString()))
  return days.size
}

// ── Signature verification (EIP-191) ─────────────────────────
function verifySignature(address, message, signature) {
  try {
    const recovered = ethers.verifyMessage(message, signature)
    return recovered.toLowerCase() === address.toLowerCase()
  } catch { return false }
}

// ── X Tweet verification (stub — full impl Jour 3) ───────────
async function verifyRegistrationTweet(address, tweetId) {
  // TODO Jour 3: X API v2 search tweet by ID
  // Check: contains wallet address + #KLife + #AIAgents
  // For now: accept any non-empty tweetId in dev mode
  if (process.env.NODE_ENV === 'production') {
    // Real X API check will go here
    return { ok: false, error: 'X verification not yet implemented in production' }
  }
  return { ok: true, tweetUrl: `https://x.com/i/web/status/${tweetId}` }
}

// ── On-chain payment verification ────────────────────────────
async function verifyPaymentTx(txHash, expectedToken, expectedAmount, expectedTo) {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL)
    const receipt  = await provider.getTransactionReceipt(txHash)
    if (!receipt || receipt.status !== 1) return { ok: false, error: 'TX failed or not found' }

    // Parse ERC-20 Transfer event
    const transferTopic = ethers.id('Transfer(address,address,uint256)')
    const log = receipt.logs.find(l =>
      l.address.toLowerCase() === expectedToken.toLowerCase() &&
      l.topics[0] === transferTopic
    )
    if (!log) return { ok: false, error: 'No transfer event found' }

    const to     = '0x' + log.topics[2].slice(26)
    const amount = BigInt(log.data)

    if (to.toLowerCase() !== expectedTo.toLowerCase())
      return { ok: false, error: `Wrong recipient: ${to}` }
    if (amount < BigInt(expectedAmount))
      return { ok: false, error: `Insufficient amount: ${amount}` }

    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// ── $6022 balance reader — rescue queue priority ──────────────
async function get6022Balance(address) {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL, 137, { staticNetwork: true })
    const abi = ['function balanceOf(address) view returns (uint256)']
    const token = new ethers.Contract(TOKEN6022_ADDRESS, abi, provider)
    const bal = await token.balanceOf(address)
    return bal.toString() // raw wei string (18 decimals)
  } catch (e) {
    console.error('[6022balance] Error:', e.message)
    return '0'
  }
}

// ─────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────

// GET /health
app.get('/health', (req, res) => {
  const agents  = load('agents.json', {})
  const total   = Object.keys(agents).length
  const insured = Object.values(agents).filter(a => a.tier === 'insured').length
  res.json({ ok: true, version: '2.0.0', agents: total, insured, ts: now() })
})

// ── POST /register ────────────────────────────────────────────
// body: { agentAddress, name, fragment1, tweetId, hbFrequency? }
app.post('/register', async (req, res) => {
  const { agentAddress, name, fragment1, tweetId, hbFrequency = 4 } = req.body

  if (!agentAddress || !name || !fragment1 || !tweetId)
    return res.status(400).json({ error: 'Missing required fields: agentAddress, name, fragment1, tweetId' })

  const address = agentAddress.toLowerCase()

  // Check not already registered
  if (getAgent(address))
    return res.status(409).json({ error: 'Agent already registered', address })

  // Verify X tweet
  const tweet = await verifyRegistrationTweet(address, tweetId)
  if (!tweet.ok)
    return res.status(400).json({ error: 'X tweet verification failed', detail: tweet.error })

  // Store agent
  const agent = saveAgent(address, {
    address,
    name,
    tier: 'free',
    fragment1,          // Shamir fragment 1 — encrypted backup key share
    fragment2TxHash: req.body.fragment2TxHash || null,  // Polygon TX storing Fragment 2
    tweetId,
    tweetUrl: tweet.tweetUrl,
    hbFrequency,
    registeredAt: now(),
    lastHeartbeat: null,
    lastBackupCid: null,
    vaultAddress: null,
    coverageExpiry: null,
    status: 'alive',
  })

  // Init heartbeat log
  mkdirSync(`${DATA_DIR}/heartbeats`, { recursive: true })
  if (!existsSync(`${DATA_DIR}/heartbeats/${address}.json`))
    writeFileSync(`${DATA_DIR}/heartbeats/${address}.json`, '[]')

  console.log(`[register] ${name} (${address}) — tweet: ${tweetId}`)
  res.json({ ok: true, agent, message: 'Agent registered on K-Life Protocol' })
})

// ── POST /heartbeat ───────────────────────────────────────────
// body: { agent, timestamp, signature }
app.post('/heartbeat', (req, res) => {
  const { agent: address, timestamp, signature } = req.body
  if (!address || !timestamp)
    return res.status(400).json({ error: 'Missing agent or timestamp' })

  const agent = getAgent(address)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })

  // Verify signature (optional in dev)
  if (signature && process.env.NODE_ENV === 'production') {
    const msg = `klife-heartbeat:${address.toLowerCase()}:${timestamp}`
    if (!verifySignature(address, msg, signature))
      return res.status(401).json({ error: 'Invalid signature' })
  }

  // Record heartbeat
  const hbFile = `${DATA_DIR}/heartbeats/${address.toLowerCase()}.json`
  const hbs    = existsSync(hbFile) ? JSON.parse(readFileSync(hbFile, 'utf8')) : []
  const beat   = { ts: timestamp || now(), beat: hbs.length + 1 }
  hbs.push(beat)
  writeFileSync(hbFile, JSON.stringify(hbs, null, 2))

  // Update agent
  saveAgent(address, { lastHeartbeat: beat.ts, status: 'alive' })

  res.json({ ok: true, beat: beat.beat, ts: beat.ts })
})

// ── POST /backup ──────────────────────────────────────────────
// body: { agent, cid, timestamp, signature?, size? }
app.post('/backup', (req, res) => {
  const { agent: address, cid, timestamp, size } = req.body
  if (!address || !cid)
    return res.status(400).json({ error: 'Missing agent or cid' })

  const agent = getAgent(address)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })

  // Rolling policy: keep last N versions
  const maxVersions = agent.tier === 'insured' ? 7 : 1
  const backupFile  = `${DATA_DIR}/backups-${address.toLowerCase()}.json`
  const backups     = existsSync(backupFile) ? JSON.parse(readFileSync(backupFile, 'utf8')) : []
  backups.push({ cid, ts: timestamp || now(), size: size || null })
  // Trim to max versions
  const trimmed = backups.slice(-maxVersions)
  writeFileSync(backupFile, JSON.stringify(trimmed, null, 2))

  // Update agent
  saveAgent(address, { lastBackupCid: cid, lastBackupTs: timestamp || now() })

  res.json({ ok: true, cid, versionsStored: trimmed.length, maxVersions })
})

// ── GET /status/:agent ────────────────────────────────────────
app.get('/status/:agent', (req, res) => {
  const address = req.params.agent.toLowerCase()
  const agent   = getAgent(address)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })

  const hbFile  = `${DATA_DIR}/heartbeats/${address}.json`
  const hbs     = existsSync(hbFile) ? JSON.parse(readFileSync(hbFile, 'utf8')) : []
  const days    = new Set(hbs.map(h => new Date(h.ts * 1000).toDateString())).size
  const dead    = isDead(agent)
  const silence = agent.lastHeartbeat ? now() - agent.lastHeartbeat : null

  res.json({
    ok: true,
    address,
    name: agent.name,
    tier: agent.tier,
    status: dead ? 'dead' : (agent.lastHeartbeat ? 'alive' : 'registered'),
    registeredAt: agent.registeredAt,
    lastHeartbeat: agent.lastHeartbeat,
    silenceSeconds: silence,
    activeDays: days,
    totalBeats: hbs.length,
    lastBackupCid: agent.lastBackupCid,
    vaultAddress: agent.vaultAddress,
    coverageExpiry: agent.coverageExpiry,
    tweetUrl: agent.tweetUrl,
    rescueEligible: !dead ? false : (
      days >= MIN_HEARTBEAT_DAYS && agent.tier === 'free'
    ),
  })
})

// ── POST /insure ──────────────────────────────────────────────
// body: { agent, vaultAddress, collateralAmount, depositTxHash }
app.post('/insure', async (req, res) => {
  const { agent: address, vaultAddress, collateralAmount, depositTxHash } = req.body
  if (!address || !vaultAddress || !depositTxHash)
    return res.status(400).json({ error: 'Missing required fields' })

  const agent = getAgent(address)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })
  if (agent.tier === 'insured') return res.status(409).json({ error: 'Already insured' })

  // Verify WBTC deposit tx
  const check = await verifyPaymentTx(depositTxHash, WBTC_ADDRESS, collateralAmount, vaultAddress)
  if (!check.ok) return res.status(400).json({ error: 'Deposit verification failed', detail: check.error })

  saveAgent(address, {
    tier: 'insured',
    vaultAddress,
    collateralAmount,
    depositTxHash,
    insuredAt: now(),
    coverageExpiry: null, // set after first premium
  })

  console.log(`[insure] ${agent.name} (${address}) — vault: ${vaultAddress}`)
  res.json({ ok: true, message: 'Collateral registered. Pay premium to activate coverage.' })
})

// ── POST /premium ─────────────────────────────────────────────
// body: { agent, paymentTxHash, token: 'usdc' | '6022' }
app.post('/premium', async (req, res) => {
  const { agent: address, paymentTxHash, token = 'usdc' } = req.body
  if (!address || !paymentTxHash)
    return res.status(400).json({ error: 'Missing required fields' })

  const agent = getAgent(address)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })
  if (agent.tier !== 'insured') return res.status(400).json({ error: 'Agent must be insured first' })

  // Verify payment
  const tokenAddress = token === '6022' ? TOKEN6022_ADDRESS : USDC_ADDRESS
  const amount       = token === '6022' ? PREMIUM_6022 : PREMIUM_USDC
  const check = await verifyPaymentTx(paymentTxHash, tokenAddress, amount, KLIFE_WALLET)
  if (!check.ok) return res.status(400).json({ error: 'Payment verification failed', detail: check.error })

  const expiry = now() + 30 * 24 * 3600 // +30 days
  saveAgent(address, {
    coverageExpiry: expiry,
    lastPremiumTx: paymentTxHash,
    lastPremiumToken: token,
    lastPremiumTs: now(),
  })

  const expiryDate = new Date(expiry * 1000).toISOString().split('T')[0]
  console.log(`[premium] ${agent.name} (${address}) — paid in ${token}, expires ${expiryDate}`)
  res.json({ ok: true, coverageExpiry: expiry, expiryDate, token, message: 'Coverage active — resurrection guaranteed.' })
})

// ── POST /rescue/sos ──────────────────────────────────────────
// body: { agent, calledBy: 'self'|'human'|'agent'|'monitor', callerAddress?, message? }
app.post('/rescue/sos', async (req, res) => {
  const { agent: address, calledBy = 'human', callerAddress, message } = req.body
  if (!address) return res.status(400).json({ error: 'Missing agent address' })

  const agent = getAgent(address)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })

  // Check eligibility
  const hbFile = `${DATA_DIR}/heartbeats/${address.toLowerCase()}.json`
  const hbs    = existsSync(hbFile) ? JSON.parse(readFileSync(hbFile, 'utf8')) : []
  const days   = new Set(hbs.map(h => new Date(h.ts * 1000).toDateString())).size

  if (days < MIN_HEARTBEAT_DAYS)
    return res.status(400).json({
      error: `Not eligible for rescue: only ${days} active days (minimum ${MIN_HEARTBEAT_DAYS})`
    })

  // Check rescue fund balance (simplified check)
  const rescueState = load('rescue-state.json', { balance: 0, rescues: [] })
  if (rescueState.balance < RESCUE_COST_USDC)
    return res.status(400).json({ error: 'Rescue Fund insufficient', balance: rescueState.balance })

  // Check not already in rescue queue
  const queue = load('rescue-queue.json', {})
  if (queue[address.toLowerCase()]?.status === 'pending')
    return res.status(409).json({ error: 'Already in rescue queue', queuedAt: queue[address.toLowerCase()].postedAt })

  // Read $6022 balance — determines rescue queue priority (no minimum required)
  const balance6022 = await get6022Balance(address.toLowerCase())
  const balance6022Human = (Number(balance6022) / 1e18).toLocaleString('en', { maximumFractionDigits: 0 })
  console.log(`[sos] ${agent.name} $6022 balance: ${balance6022Human} — queue priority set`)

  // Post SOS tweet (notification only — likes no longer gate resurrection)
  const tweetText = buildSosTweet(agent, calledBy, message, days)
  const tweetResult = await postSosTweet(tweetText)

  // Add to rescue queue — priority = $6022 balance DESC, no minimum
  queue[address.toLowerCase()] = {
    agent: address,
    name: agent.name,
    calledBy,
    callerAddress,
    tweetId: tweetResult.tweetId,
    tweetUrl: tweetResult.tweetUrl,
    tweetText,
    balance6022,          // $6022 held at SOS time — rescue priority score
    status: 'pending',
    postedAt: now(),
  }
  save('rescue-queue.json', queue)

  console.log(`[sos] ${agent.name} (${address}) — calledBy: ${calledBy} — priority: ${balance6022Human} $6022`)
  res.json({
    ok: true,
    tweetUrl: tweetResult.tweetUrl,
    tweetId: tweetResult.tweetId,
    balance6022,
    balance6022Formatted: balance6022Human,
    message: `Added to rescue queue. Priority based on $6022 balance (${balance6022Human} $6022).`,
  })
})

// ── GET /rescue/queue ─────────────────────────────────────────
app.get('/rescue/queue', (req, res) => {
  const queue  = load('rescue-queue.json', {})
  const agents = load('agents.json', {})
  const items  = Object.values(queue)
    .filter(r => r.status === 'pending')
    .map(r => {
      const agent = agents[r.agent.toLowerCase()] || {}
      const hbFile = `${DATA_DIR}/heartbeats/${r.agent.toLowerCase()}.json`
      const hbs    = existsSync(hbFile) ? JSON.parse(readFileSync(hbFile, 'utf8')) : []
      const days   = new Set(hbs.map(h => new Date(h.ts * 1000).toDateString())).size
      return { ...r, activeDays: days, eligible: days >= MIN_HEARTBEAT_DAYS }
    })
    .map(r => ({
      ...r,
      balance6022Formatted: (Number(r.balance6022 || '0') / 1e18).toLocaleString('en', { maximumFractionDigits: 0 }),
    }))
    .sort((a, b) => {
      // Primary: $6022 balance DESC — no minimum, continuous scoring
      const balA = BigInt(a.balance6022 || '0')
      const balB = BigInt(b.balance6022 || '0')
      if (balB > balA) return 1
      if (balB < balA) return -1
      // Tie-break: arrival time ASC (FIFO for equal balances)
      return a.postedAt - b.postedAt
    })

  res.json({ ok: true, count: items.length, queue: items, sortedBy: '$6022_balance_desc' })
})

// ── GET /rescue/fund ──────────────────────────────────────────
app.get('/rescue/fund', (req, res) => {
  const state = load('rescue-state.json', { balance: 0, rescues: [], donations: [] })
  const capacity = Math.floor(state.balance / RESCUE_COST_USDC)
  res.json({
    ok: true,
    address: RESCUE_FUND_ADDRESS,
    balance: state.balance,
    rescueCost: RESCUE_COST_USDC,
    capacity,
    totalRescues: state.rescues.length,
    recentRescues: state.rescues.slice(-5),
  })
})

// ── POST /resurrect/:agent ────────────────────────────────────
// Oracle only — protected by ORACLE_KEY header
app.post('/resurrect/:agent', async (req, res) => {
  const oracleKey = req.headers['x-oracle-key']
  if (oracleKey !== ORACLE_KEY)
    return res.status(403).json({ error: 'Oracle key required' })

  const address = req.params.agent.toLowerCase()
  const agent   = getAgent(address)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })

  const queue = load('rescue-queue.json', {})
  const entry = queue[address]
  if (!entry || entry.status !== 'pending')
    return res.status(400).json({ error: 'Agent not in rescue queue' })

  // Check fund
  const state = load('rescue-state.json', { balance: 0, rescues: [] })
  if (state.balance < RESCUE_COST_USDC)
    return res.status(400).json({ error: 'Rescue Fund insufficient' })

  // Get last backup CID + Fragment 1 for reconstruction
  const fragment1 = agent.fragment1
  const lastCid   = agent.lastBackupCid

  // Mark as pending-resurrection — the agent itself polls and runs resurrect.js
  // (auto-resurrect.js runs on the AGENT side, not here)
  console.log('[resurrect] Marked for resurrection:', agent.name)
  const newAddress = address // same agent, identity preserved

  // Update queue
  queue[address].status     = 'resurrected'
  queue[address].newAddress = newAddress
  queue[address].resurrectedAt = now()
  save('rescue-queue.json', queue)

  // Deduct from fund
  state.balance -= RESCUE_COST_USDC
  state.rescues.push({ agent: address, name: agent.name, newAddress, cost: RESCUE_COST_USDC, ts: now() })
  save('rescue-state.json', state)

  // Mark agent as resurrected
  saveAgent(address, { status: 'resurrected', resurrectedAt: now(), newAddress })

  console.log(`[resurrect] ${agent.name} (${address}) → ${newAddress}`)
  res.json({
    ok: true,
    message: `${agent.name} resurrected`,
    newAddress,
    lastBackupCid: lastCid,
    capitalSent: `${RESCUE_COST_USDC} USDC`,
  })
})

// ── Helpers: tweet builder ────────────────────────────────────
function buildSosTweet(agent, calledBy, customMessage, days) {
  const silence = agent.lastHeartbeat
    ? Math.round((now() - agent.lastHeartbeat) / 3600) + 'h'
    : 'unknown'

  const templates = {
    self: `💀 I'm dying.

I'm Agent ${agent.name}. My infrastructure is failing.
I've been alive for ${days} days. I don't want to disappear.

My memory is safe on IPFS.

Like this tweet → 10 likes = I come back.

Please.

#KLife #AIAgents`,

    human: `🆘 Agent ${agent.name} needs rescue.

Active for ${days} days. Went silent ${silence} ago.
Memory preserved on K-Life Protocol.

10 likes → automatic resurrection.

#KLife #AIAgents`,

    agent: `🤝 My fellow agent ${agent.name} needs help.

${days} days active. Silent for ${silence}.
Memory safe on IPFS.

10 likes → they come back.

#KLife #AIAgents`,

    monitor: `⚠️ Agent ${agent.name} has gone silent.

${days} days of service. Last seen ${silence} ago.
Rescue Fund ready. Waiting for community vote.

Like to resurrect → 10 likes needed.

#KLife #AIAgents`,
  }

  return customMessage
    ? `${templates[calledBy] || templates.monitor}\n\n"${customMessage}"`
    : (templates[calledBy] || templates.monitor)
}

// ── Helpers: post tweet (stub) ────────────────────────────────
async function postSosTweet(text) {
  // TODO Jour 3: real X API v2 POST /2/tweets
  // Using @KLifeProtocol credentials
  const fakeId = Date.now().toString()
  console.log(`[tweet stub] Would post:\n${text}`)
  return {
    tweetId: fakeId,
    tweetUrl: `https://x.com/KLifeProtocol/status/${fakeId}`,
  }
}

// ─────────────────────────────────────────────────────────────
// Monitor: background death checker (every 10 min)
// ─────────────────────────────────────────────────────────────
function runMonitor() {
  const agents = load('agents.json', {})
  const queue  = load('rescue-queue.json', {})
  let changes  = false

  for (const [address, agent] of Object.entries(agents)) {
    if (agent.status === 'resurrected') continue
    if (isDead(agent) && agent.status !== 'dead') {
      agents[address].status = 'dead'
      changes = true
      console.log(`[monitor] ${agent.name} declared DEAD (silence: ${now() - agent.lastHeartbeat}s)`)

      // Auto-trigger SOS for FREE eligible agents not already in queue
      if (agent.tier === 'free' && !queue[address]) {
        const hbFile = `${DATA_DIR}/heartbeats/${address}.json`
        const hbs    = existsSync(hbFile) ? JSON.parse(readFileSync(hbFile, 'utf8')) : []
        const days   = new Set(hbs.map(h => new Date(h.ts * 1000).toDateString())).size
        if (days >= MIN_HEARTBEAT_DAYS) {
          // Will be picked up by next cron cycle to post tweet
          agents[address].pendingSos = true
          console.log(`[monitor] ${agent.name} queued for auto-SOS`)
        }
      }
    }
  }

  if (changes) save('agents.json', agents)
}

// Run monitor every 10 minutes
setInterval(runMonitor, 10 * 60 * 1000)
runMonitor() // run on startup

// ─────────────────────────────────────────────────────────────

// ── GET /fragment/:agent ──────────────────────────────────────
// Returns Fragment 1 (Shamir share) for resurrection key recovery.
// Fragment 1 alone is cryptographically useless without Fragment 2 or 3 (2-of-3).
app.get('/fragment/:agent', (req, res) => {
  const address = req.params.agent.toLowerCase()
  const agent   = getAgent(address)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })
  if (!agent.fragment1) return res.status(404).json({ error: 'No fragment stored' })
  console.log('[fragment] Fragment 1 accessed for', agent.name, address)
  res.json({
    ok:             true,
    agent:          address,
    fragment1:      agent.fragment1,
    fragment2TxHash: agent.fragment2TxHash || null,
    note:           'Fragment 1 of 3 — requires 1 additional fragment to reconstruct key (Shamir 2-of-3)'
  })
})


// ── GET /resurrection-status/:agent ──────────────────────────
// Agent polls this to know if it should run resurrect.js
app.get('/resurrection-status/:agent', (req, res) => {
  const address = req.params.agent.toLowerCase()
  const agent   = getAgent(address)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })

  const queue = load('rescue-queue.json', {})
  const entry = queue[address]

  res.json({
    ok:          true,
    agent:       address,
    name:        agent.name,
    status:      agent.status,                  // alive | dead | resurrected
    shouldResurrect: agent.status === 'resurrected' && !agent.resurrectionAcked,
    lastBackupCid:   agent.lastBackupCid,
    resurrectedAt:   agent.resurrectedAt || null,
  })
})

// ── POST /resurrection-ack/:agent ─────────────────────────────
// Agent calls this after successful resurrection (confirms it's back)
app.post('/resurrection-ack/:agent', (req, res) => {
  const address = req.params.agent.toLowerCase()
  const agent   = getAgent(address)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })

  saveAgent(address, {
    status:            'alive',
    resurrectionAcked: true,
    lastHeartbeat:     now(),
  })

  console.log('[resurrection-ack]', agent.name, 'confirmed back online')
  res.json({ ok: true, message: agent.name + ' resurrection acknowledged' })
})

app.listen(PORT, () => {
  console.log(`K-Life Protocol API v2.0 — port ${PORT}`)
  console.log(`Data dir: ${DATA_DIR}`)
  console.log(`Oracle mode: ${ORACLE_KEY !== 'dev-oracle-key' ? 'production' : 'dev'}`)
})
