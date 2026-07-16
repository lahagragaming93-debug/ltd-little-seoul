# Bot Discord — LTD Little Seoul

Ce bot lit les embeds postés sur les canaux de logs de votre serveur
Discord LTD SandyShores et les relaie vers Firebase via la Cloud Function
`botIngest`.

## Installation

```bash
cd discord-bot
npm install
cp .env.example .env
# Renseigner toutes les variables dans .env
npm start
```

Bot Discord en service (parse FaabHook → Firestore). Voir `discord-bot/index.js` et `discord-bot/parsers/` pour le détail.

## Architecture

```
discord-bot/
├── index.js                Connexion Discord + dispatch par canal (multi-parser supporté)
├── parsers/
│   ├── _helpers.js         Helpers communs (firstEmbed, getField, getMoney…)
│   │
│   │ ── PHASE 1 (parsers initiaux) ──
│   ├── inventory.js        #logs-ig — inventory-add / -remove
│   ├── service.js          #logs-services + #suivi-service-vendeur
│   ├── facture.js          #suivi-facture
│   ├── essence.js          #suivi-achat-essence (redistributions)
│   ├── depense.js          #depenses (avec soldeAvant/Apres)
│   ├── paie.js             #paie
│   ├── coffre.js           #suivi-coffre
│   │
│   │ ── PHASE 2 (parsers avancés ajoutés sur logs réels) ──
│   ├── xbankaccount.js     #logs-ig (banque LTDSEOUL) — entrées d'argent + solde temps réel
│   ├── autoRh.js           #auto-rh — embauches / exclusions / DÉPARTS
│   ├── autorankup.js       #autorankup — promotions de rôle
│   ├── statsbank.js        #statsbank — récap hebdo officiel + impôt + top vendeurs
│   ├── rapportPompiste.js  #pompiste — rapport quotidien stations
│   └── venteAuto.js        #ventes — distributeur LTD automatique
│
├── package.json
└── .env.example
```

### Multi-parser par canal

Le canal `#logs-ig` héberge 2 types d'embeds (inventory + xbankaccount). `index.js`
gère ça via une **liste ordonnée de parsers** : chaque parser est essayé dans
l'ordre, le premier qui retourne un payload non-null gagne.

```js
[process.env.CH_LOGS_IG]: [
  { type: 'bankAccount', parser: parseXbankaccountEmbed }, // testé en 1er (filtre IBAN)
  { type: 'inventory',   parser: parseInventoryEmbed     }
]
```

## Hébergement recommandé

- **Local** : tourne sur votre PC tant qu'il est allumé
- **Raspberry Pi** : faible coût, idéal en 24/7
- **VPS** (OVH, Hetzner ~3 €/mois) : recommandé pour la production
- **Railway / Fly.io** : déploiement gratuit avec quota suffisant

Le bot se reconnecte automatiquement en cas de coupure réseau.
