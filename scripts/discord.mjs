// Poste sur Discord le rappel des enchants et gemmes manquants (mains actifs uniquement).
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
const groupSlots = (list) => Object.entries(list.reduce((m, s) => ((m[s] = (m[s] || 0) + 1), m), {})).map(([s, n]) => (n > 1 ? `${s} ×${n}` : s));
const issues = (c) => c.missingEnchants.length + c.emptySockets.length;

const list = data.characters
  .filter((c) => c.found && c.isMain !== false && isActive(c) && issues(c))
  .sort((a, b) => issues(b) - issues(a) || b.ilvl - a.ilvl);

const lines = list.map((c) => {
  const parts = [];
  if (c.missingEnchants.length) parts.push(`✖ ${c.missingEnchants.join(', ')}`);
  if (c.emptySockets.length) parts.push(`◇ ${groupSlots(c.emptySockets).join(', ')}`);
  return `**${c.name}** — ${parts.join(' · ')}`;
});

// Une description d'embed est limitée à 4096 caractères : on découpe si besoin.
const chunks = [];
for (const line of lines) {
  if (!chunks.length || chunks.at(-1).length + line.length + 1 > 3800) chunks.push('');
  chunks[chunks.length - 1] += (chunks.at(-1) ? '\n' : '') + line;
}

const alertsUrl = `${config.siteUrl}#/alertes`;
const messages = list.length
  ? chunks.map((desc, i) => ({
      embeds: [{
        title: i === 0 ? `🔮 Rappel enchants & gemmes — ${list.length} à corriger avant le raid` : '🔮 Rappel (suite)',
        url: alertsUrl,
        color: 0xd9b45a,
        description: desc + (i === chunks.length - 1 ? '\n\n✖ enchant manquant · ◇ châsse vide\n*Pensez à vous déconnecter après avoir corrigé, l\'armurerie se met à jour au logout.*' : ''),
        footer: i === chunks.length - 1 ? { text: 'Armurerie Rebõrn' } : undefined,
      }],
    }))
  : [{ embeds: [{ title: '✨ Tout le monde est enchanté et gemmé !', url: alertsUrl, color: 0x4fbf72, description: 'Rien à signaler avant le raid. Incroyable.' }] }];

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
console.log(`Rappel envoyé sur Discord (${list.length} persos, ${messages.length} message${messages.length > 1 ? 's' : ''}).`);
