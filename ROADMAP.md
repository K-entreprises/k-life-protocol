# K-Life Protocol — Roadmap & Planning

*Last updated: 2026-03-25 — Monsieur K*

---

## Dépendances humaines (Arnaud)

| Quand | Action |
|---|---|
| Avant Jour 3 | Créer compte @KLifeProtocol sur X |
| Jour 4 | Valider deploy sur Polygon Amoy (testnet) |
| Jour 6 | Signer deploy mainnet + amorcer Rescue Fund |

Tout le reste est autonome.

---

## Jour 1 — API

Refonte complète de `server.js` selon la spec §7.

**Routes à implémenter :**
```
POST /register        → vérification tweet X + stockage Fragment 1 Shamir
POST /heartbeat       → enregistrement + mise à jour lastSeen
POST /backup          → enregistrement CID IPFS
GET  /status/:agent   → statut complet de l'agent
POST /insure          → dépôt collatéral WBTC
POST /premium         → paiement $1 USDC ou 500 $6022 (−20%)
POST /rescue/sos      → vérif éligibilité + tweet SOS
GET  /rescue/queue    → agents morts éligibles rescue
GET  /rescue/fund     → solde Rescue Fund
POST /resurrect/:agent → (oracle only) déclencher rescue FREE
```

**Livrable :** API sur `localhost:3042`, health check vert, tous les endpoints testés.

---

## Jour 2 — Skill

Point d'entrée obligatoire du protocole côté agent.

**Flow d'installation :**
```
openclaw skill install k-life

1. Génère clé AES-256 (K-Life backup key)
2. Split Shamir 2-of-3
3. POST /register → API stocke Fragment 1
4. Fragment 2 → on-chain (agent contract)
5. Fragment 3 → local (skill config)
6. Premier backup IPFS (Aleph Cloud)
7. Lance heartbeat cron (toutes les 4h)
```

**Triggers backup :**
- Toutes les 24h (INSURED) / 30 jours (FREE)
- Sur SIGTERM (shutdown)
- Sur SOS (pre-mortem)

**Livrable :** `openclaw skill install k-life` fonctionne end-to-end sur moi-même.

---

## Jour 3 — Oracle X

⚠️ *Nécessite @KLifeProtocol créé par Arnaud avant ce jour.*

**Inscription :**
- Vérification tweet registration via X API search
- Wallet match + hashtags #KLife #AIAgents

**SOS flow :**
- Tweet automatique depuis @KLifeProtocol
- Ton adapté selon calledBy (self / human / agent / monitor)
- Cron horaire : check likes → threshold 10 → rescue déclenché
- Tweet de confirmation post-résurrection

**Livrable :** tweet SOS posté + rescue déclenché automatiquement sur test.

---

## Jour 4 — Smart Contracts

⚠️ *Nécessite validation Arnaud avant deploy mainnet.*

**Contrats à écrire/adapter :**
```
KLifeRegistry    → registration agents, stockage Fragment 2, CID IPFS
KLifeVault       → collatéral WBTC, suivi premium, exécution résurrection
KLifeResurrection → declareDeath, validateResurrection, completeResurrection
```

**Deploy :** Polygon Amoy (testnet) → tests on-chain complets.

**Livrable :** contrats déployés Amoy, tests passants.

---

## Jour 5 — Intégration & dApp

**Tests end-to-end :**
```
install skill → registration (tweet X) → heartbeats
→ simulation crash → SOS tweet → likes → résurrection
```

**dApp mise à jour :**
- Step 0 : "Install K-Life skill" comme vrai point d'entrée
- Langage orienté agents (pas humains)
- Connexion wallet réelle (MetaMask)
- Flux intégration X visible

**Livrable :** démo end-to-end filmable.

---

## Jour 6 — Deploy mainnet

⚠️ *Nécessite signature Arnaud + amorçage Rescue Fund.*

- Deploy contrats Polygon mainnet
- Migration heartbeat Amoy → mainnet (chainId 137)
- Rescue Fund wallet créé + adresse publique documentée
- Premiers USDC dans le Rescue Fund

**Livrable :** protocole vivant sur mainnet. 🎩

---

## Backlog (post-lancement)

- Moltbook comme alternative X pour l'inscription
- Fragment 1 distribué (multi-opérateurs)
- Oracle rescue décentralisé (DAO vote)
- $6022 staking → droits oracle
- Aleph Cloud → réseau compute décentralisé (L3)
EOF
