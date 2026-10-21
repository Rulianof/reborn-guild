# Site de guilde Rebõrn (Hyjal EU) : étude de faisabilité

**Verdict : faisable.** Chaque fonctionnalité demandée repose sur une API officielle et gratuite : l'API Battle.net de Blizzard et l'API v2 de Warcraft Logs. Raider.IO peut servir en complément. Aucun scraping n'est nécessaire.

---

## 1. Sources de données

| Source | Ce qu'elle fournit | Accès |
|---|---|---|
| **Blizzard Battle.net API** (Profile + Game Data) | Roster de la guilde, rangs, équipement avec enchantements et gemmes, ilvl, spé et talents (loadout code), métiers et paliers, M+, hauts faits, rendu 3D/avatar du perso | OAuth « client credentials » gratuit via develop.battle.net. Limite d'environ 36 000 requêtes/h, largement suffisante |
| **Warcraft Logs API v2** (GraphQL) | Rapports de la guilde, fights, parses par boss et par joueur (zoneRankings), tables de dégâts, soins, morts, interrupts, dispels, dégâts subis par capacité, consommables et buffs au pull (combatantInfo) | OAuth « client credentials » gratuit. Limite en points par heure : il faut un cache |
| **Raider.IO API** (optionnel) | Score M+, progression raid, classement de la guilde | Publique, sans clé |

## 2. Faisabilité par fonctionnalité

| Fonctionnalité | Faisable ? | Comment |
|---|---|---|
| Liste des membres | ✅ Facile | `GET /data/wow/guild/hyjal/rebõrn/roster` |
| Armurerie (stuff, ilvl, avatar) | ✅ Facile | `/profile/wow/character/{realm}/{nom}/equipment`, `/character-media` |
| Talents | ✅ Facile | `/specializations` renvoie les talents et le **loadout code**, qu'on peut afficher ou lier vers un calculateur |
| Métiers | ✅ Facile | `/professions` renvoie les métiers, les paliers d'extension, le niveau et les recettes connues |
| **Enchantements oubliés** | ✅ Facile | Chaque pièce d'équipement a un champ `enchantments`. On compare avec une liste configurable des emplacements enchantables de la saison, et on peut vérifier les gemmes de la même façon |
| Parses Warcraft Logs | ✅ Moyen | `characterData.character.zoneRankings` ou les classements par rapport |
| Tableau des scores | ✅ Moyen | Agrégation en base : parse moyen, meilleur parse, présence, etc. |
| **Hall of Fame par soirée** | ✅ Moyen | Pour chaque rapport de la soirée : meilleur parse, top DPS/HPS, le plus d'interrupts, zéro mort… |
| **Hall of Shame par soirée** | ✅ Moyen | Premier mort du pull, plus de morts, plus de dégâts évitables subis, aucune potion, pas de flask ni de food au pull, enchant manquant pendant le raid |

### Le « Hall of Shame » plus en détail
Warcraft Logs sait ce qui s'est passé pendant le raid. On peut donc calculer :
- **Morts** : qui meurt le plus, qui meurt en premier (table `Deaths`).
- **Dégâts évitables** : dégâts subis sur une liste de capacités « évitables » par boss. Cette liste doit être maintenue à la main, c'est la partie la plus fastidieuse.
- **Consommables** : les `combatantInfo` au pull donnent les auras actives (flask, food, rune) et le stuff porté, enchants inclus. On peut donc dire « X n'avait pas de flask sur 6 pulls ».
- **Potions et healthstones** : leurs utilisations sont visibles dans les casts.

Je recommande de garder un ton humoristique et de permettre de **désactiver le Hall of Shame par joueur**, ou de le réserver aux officiers, pour éviter les tensions.

## 3. Points d'attention et limites

1. **Warcraft Logs en maintenance** : le site doit s'en accommoder. Tout est mis en cache en base, et une panne de WCL n'affiche que des données un peu anciennes, sans rien casser. Le développement peut commencer par la partie Blizzard, qui ne dépend pas de WCL.
2. **Fraîcheur des données Blizzard** : l'armurerie n'est mise à jour qu'à la **déconnexion** du joueur. Un enchant posé en jeu n'apparaît qu'après un relog.
3. **Personnages introuvables (404)** : l'API ne renvoie pas les persos inactifs depuis longtemps, ni ceux de bas niveau. Il faut les afficher proprement plutôt que planter.
4. **Liste des emplacements enchantables** : elle change à chaque extension ou saison. Elle doit être un fichier de config, pas du code en dur.
5. **Nom de guilde avec accent** (`rebõrn`) : il faut bien encoder le slug (`reb%C3%B5rn`). C'est trivial mais ça piège souvent.
6. **Clés API secrètes** : un petit backend est obligatoire. Les clés ne doivent jamais être dans le JavaScript du navigateur.
7. **Conditions d'utilisation** : un site de fans non commercial est autorisé par Blizzard et WCL. Il faut éviter d'utiliser les logos Blizzard comme si le site était officiel.

## 4. Architecture proposée

```
            ┌──────────────┐     cron (toutes les 1-6 h)
            │  Job de sync │──► Blizzard API (roster, stuff, talents, métiers)
            │              │──► Warcraft Logs API (nouveaux rapports, parses)
            └──────┬───────┘
                   ▼
            ┌──────────────┐
            │ Base SQLite/ │  ← cache, historique, scores calculés
            │  PostgreSQL  │
            └──────┬───────┘
                   ▼
            ┌──────────────┐
            │  Site web    │  pages : Roster · Perso · Classement · Soirées (Fame/Shame) · Alertes enchant
            └──────────────┘
```

- **Stack** : Next.js (TypeScript) pour le front et l'API, Prisma, et SQLite au début puis Postgres si besoin. Une alternative est Python (FastAPI) avec un front simple.
- **Hébergement** : un petit VPS à environ 5 €/mois, ou une offre gratuite type Vercel avec une base hébergée (Neon ou Supabase) et une cron.
- **Bonus possibles** :
  - connexion Battle.net pour que chaque membre « réclame » ses persos (main et alts) ;
  - notifications Discord par webhook (« 3 membres sans enchant avant le raid de ce soir », récap Fame/Shame posté automatiquement après la soirée).

## 5. Découpage et estimation

| Phase | Contenu | Effort estimé |
|---|---|---|
| **1. MVP Blizzard** | Roster, fiche perso (stuff, talents, métiers), détection des enchants et gemmes manquants | Quelques jours |
| **2. Warcraft Logs** | Import des rapports de guilde, parses par joueur, tableau des scores | Quelques jours |
| **3. Soirées de raid** | Page par soirée avec Hall of Fame / Hall of Shame automatiques | Quelques jours, plus la maintenance de la liste des capacités évitables |
| **4. Confort** | Connexion Battle.net, mains et alts, webhook Discord, design aux couleurs de la guilde | Variable |

## 6. Ce qu'il faut pour démarrer

1. Créer un client API sur **https://develop.battle.net** pour obtenir un Client ID et un Secret.
2. Créer un client API sur **https://www.warcraftlogs.com/api/clients** quand le site sera de nouveau disponible.
3. Choisir la stack et l'hébergement.
4. Vérifier que la guilde publie bien ses logs sur Warcraft Logs, rattachés à la guilde Rebõrn – Hyjal EU.
