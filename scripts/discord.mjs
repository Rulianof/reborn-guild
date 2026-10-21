// Poste sur Discord un rappel amical avec un lien vers la page des enchants et gemmes manquants.
// Usage : node scripts/discord.mjs [--force] [--dry-run] [--check]
//   --check   : dit seulement si c'est l'heure du rappel (écrit send=true/false pour GitHub Actions)
//   --force   : ignore le jour et l'heure configurés
//   --dry-run : affiche le message au lieu de l'envoyer
import { readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, config, env } from './common.mjs';

const args = new Set(process.argv.slice(2));
const { joursRaid = [], heureRappel = 18 } = config.discord || {};

function isReminderTime() {
  const now = new Date();
  const fmt = (o) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', ...o }).format(now);
  const jour = fmt({ weekday: 'long' }).toLowerCase();
  const heure = parseInt(fmt({ hour: 'numeric', hourCycle: 'h23' }), 10);
  return { ok: joursRaid.map((j) => j.toLowerCase()).includes(jour) && heure === heureRappel, jour, heure };
}

if (args.has('--check')) {
  const { ok, jour, heure } = isReminderTime();
  console.log(`${jour} ${heure}h (Paris) → ${ok ? 'rappel à envoyer' : 'pas de rappel'}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `send=${ok}\n`);
  process.exit(0);
}

if (!args.has('--force') && !isReminderTime().ok) {
  console.log("Ce n'est pas l'heure du rappel (voir config.discord).");
  process.exit(0);
}

const data = JSON.parse(readFileSync(join(ROOT, 'site/data/guild.json'), 'utf8'));
const DAY = 86400000;
const isActive = (c) => c.lastLogin && Date.now() - c.lastLogin < config.joursInactif * DAY;
const count = data.characters.filter((c) => c.found && c.isMain !== false && isActive(c) && c.missingEnchants.length + c.emptySockets.length).length;

// Message volontairement léger : un lien vers la page, sans lister personne publiquement.
const alertsUrl = `${config.siteUrl}#/alertes`;
const messages = [{
  embeds: [{
    title: '✨ Petit check avant le raid !',
    url: alertsUrl,
    color: count ? 0xd9b45a : 0x4fbf72,
    description: count
      ? `Un enchant ou une gemme a peut-être filé entre les doigts ? 👀\n**[Clique ici pour vérifier ton perso](${alertsUrl})**\n\n*Astuce : déconnecte-toi après avoir corrigé, l'armurerie se met à jour au logout.*`
      : 'Tout le monde est enchanté et gemmé. Bravo à tous, bon raid ! 🎉',
    footer: { text: 'Armurerie Rebõrn' },
  }],
}];

if (args.has('--dry-run')) {
  console.log(JSON.stringify(messages, null, 2));
  process.exit(0);
}

const webhook = env('DISCORD_WEBHOOK_URL');
if (!webhook) {
  console.error('DISCORD_WEBHOOK_URL manquant (.env ou secrets GitHub).');
  process.exit(1);
}
for (const msg of messages) {
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'Armurerie Rebõrn', allowed_mentions: { parse: [] }, ...msg }),
  });
  if (!res.ok) {
    console.error(`Discord a refusé le message (HTTP ${res.status}) : ${await res.text()}`);
    process.exit(1);
  }
}
console.log(`Rappel envoyé sur Discord (${count} persos à vérifier).`);
