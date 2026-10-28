// Poste sur Discord un rappel amical avec un lien vers la page des enchants et gemmes manquants.
// Usage : node scripts/discord.mjs [--force] [--dry-run] [--check]
//   --check   : dit seulement si on est dans la fenêtre du rappel (écrit send et date pour GitHub Actions)
//   --force   : ignore le jour et l'heure configurés
//   --dry-run : affiche le message au lieu de l'envoyer
import { readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, config, env } from './common.mjs';

const args = new Set(process.argv.slice(2));
const { joursRaid = [], heureRappel = 18, debutRaid = '20:45' } = config.discord || {};

// GitHub ne lance pas les tâches planifiées à l'heure pile (souvent avec des heures de retard) :
// on envoie au premier passage entre heureRappel et le début du raid, une seule fois par jour
// (le workflow se souvient du jour envoyé grâce à son cache).
function isReminderTime() {
  const now = new Date();
  const fmt = (o) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', ...o }).format(now);
  const jour = fmt({ weekday: 'long' }).toLowerCase();
  const [h, m] = fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number);
  const [rh, rm] = debutRaid.split(':').map(Number);
  const minutes = h * 60 + m;
  const ok = joursRaid.map((j) => j.toLowerCase()).includes(jour) && minutes >= heureRappel * 60 && minutes < rh * 60 + rm;
  const date = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(now);
  return { ok, jour, heure: `${h}h${String(m).padStart(2, '0')}`, date };
}

if (args.has('--check')) {
  const { ok, jour, heure, date } = isReminderTime();
  console.log(`${jour} ${heure} (Paris) → ${ok ? 'dans la fenêtre du rappel' : 'pas de rappel'}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `send=${ok}\ndate=${date}\n`);
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
