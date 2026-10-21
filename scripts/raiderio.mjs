// Données Raider.IO (API publique, sans clé) : progression raid de la guilde, score M+ et raids par perso.
// Tout est facultatif : si Raider.IO ne répond pas, la synchro continue sans ces données.
import { config } from './common.mjs';

const RIO = 'https://raider.io/api/v1';

async function rio(path, params, tries = 3) {
  const url = `${RIO}${path}?${new URLSearchParams(params)}`;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
      if (res.status === 400 || res.status === 404) return null;
    } catch { /* réseau : on réessaie */ }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  return null;
}

// Raids de la saison en cours, le plus gros en premier (le raid « principal »).
export async function currentRaids() {
  const data = await rio('/raiding/static-data', { expansion_id: config.raiderio.expansionId });
  const now = Date.now();
  return (data?.raids || [])
    .filter((r) => Date.parse(r.starts[config.region]) <= now && now < Date.parse(r.ends[config.region]))
    .map((r) => ({ slug: r.slug, name: r.name, bosses: r.encounters.length }))
    .sort((a, b) => b.bosses - a.bosses);
}

export async function guildProgression(raids) {
  const g = await rio('/guilds/profile', { region: config.region, realm: config.realm, name: config.guild, fields: 'raid_progression,raid_rankings' });
  if (!g) return null;
  return {
    url: g.profile_url,
    raids: raids.map((r) => {
      const prog = pickProgress(g.raid_progression?.[r.slug]);
      // Classement serveur dans la plus haute difficulté où la guilde a tué au moins un boss.
      const diff = prog.mythic ? 'mythic' : prog.heroic ? 'heroic' : 'normal';
      return { ...r, ...prog, rankRealm: g.raid_rankings?.[r.slug]?.[diff]?.realm || null };
    }),
  };
}

const pickProgress = (p) => (p ? { summary: p.summary, normal: p.normal_bosses_killed, heroic: p.heroic_bosses_killed, mythic: p.mythic_bosses_killed } : { summary: null });

export async function characterData(c, raids) {
  const p = await rio('/characters/profile', {
    region: config.region, realm: c.realm, name: c.name,
    fields: 'mythic_plus_scores_by_season:current,mythic_plus_best_runs,mythic_plus_weekly_highest_level_runs,raid_progression',
  });
  if (!p) return null;
  const season = p.mythic_plus_scores_by_season?.[0];
  return {
    url: p.profile_url,
    score: Math.round(season?.scores?.all || 0),
    color: season?.segments?.all?.color || null,
    bestRuns: (p.mythic_plus_best_runs || []).map((r) => ({
      dungeon: r.dungeon, short: r.short_name, level: r.mythic_level, upgrades: r.num_keystone_upgrades, score: Math.round(r.score || 0),
    })).sort((a, b) => b.level - a.level),
    // Clés faites depuis la réinitialisation hebdomadaire (pour le coffre).
    weekRuns: (p.mythic_plus_weekly_highest_level_runs || []).map((r) => ({ short: r.short_name, dungeon: r.dungeon, level: r.mythic_level, upgrades: r.num_keystone_upgrades })),
    raids: Object.fromEntries(raids.map((r) => [r.slug, pickProgress(p.raid_progression?.[r.slug])])),
  };
}
