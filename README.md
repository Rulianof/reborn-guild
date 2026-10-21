# Rebõrn – site de guilde (Hyjal EU)

Armurerie de guilde : membres, stuff, talents, métiers, alertes d'enchantements et gemmes manquants.

- `scripts/sync.mjs` : récupère les données Blizzard et écrit `site/data/guild.json`.
- `site/` : le site statique (HTML/CSS/JS, sans dépendances).
- `config.json` : niveau minimum, noms des rangs, emplacements à enchanter.
- `.github/workflows/deploy.yml` : synchro toutes les 3 h + publication sur GitHub Pages.

## En local
```bash
node scripts/sync.mjs
python3 -m http.server 8765 -d site
```
Puis ouvrir http://localhost:8765. Les clés sont dans `.env` (jamais publié).
