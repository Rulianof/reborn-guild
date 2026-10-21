// Récupère le roster de la guilde et les profils des persos via l'API Blizzard,
// puis écrit site/data/guild.json. Usage : node scripts/sync.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));

// En local on lit .env ; sur GitHub Actions les variables viennent des secrets.
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const { BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET } = process.env;
if (!BLIZZARD_CLIENT_ID || !BLIZZARD_CLIENT_SECRET) {
  console.error('BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET manquants (.env ou secrets GitHub).');
  process.exit(1);
}

const API = `https://${config.region}.api.blizzard.com`;
const NS = `profile-${config.region}`;

// Les noms de métiers ne sont pas traduits par l'API.
const METIERS = {
  164: 'Forge', 165: 'Travail du cuir', 171: 'Alchimie', 182: 'Herboristerie', 186: 'Minage',
  197: 'Couture', 202: 'Ingénierie', 333: 'Enchantement', 393: 'Dépeçage', 755: 'Joaillerie',
  773: 'Calligraphie', 185: 'Cuisine', 356: 'Pêche', 794: 'Archéologie',
};

async function getToken() {
  const res = await fetch('https://oauth.battle.net/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${BLIZZARD_CLIENT_ID}:${BLIZZARD_CLIENT_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Token Blizzard refusé (HTTP ${res.status})`);
  return (await res.json()).access_token;
}

let token;
async function api(path, tries = 4) {
  const url = `${API}${path}${path.includes('?') ? '&' : '?'}namespace=${NS}&locale=${config.locale}`;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) return res.json();
    if (res.status === 404 || res.status === 403) return null;
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      continue;
    }
    throw new Error(`HTTP ${res.status} sur ${path}`);
  }
  return null;
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

const cleanEnchant = (s) => (s || '').replace(/^Enchanté\s*:\s*/u, '').replace(/\|A:[^|]*\|a/g, '').trim();

function simplifyItem(it) {
  return {
    slot: it.slot.type,
    slotName: it.slot.name,
    invType: it.inventory_type?.type,
    id: it.item.id,
    name: it.name,
    ilvl: it.level?.value ?? 0,
    quality: it.quality?.type,
    bonus: it.bonus_list || [],
    enchants: (it.enchantments || [])
      .filter((e) => e.enchantment_slot?.type === 'PERMANENT')
      .map((e) => ({ id: e.enchantment_id, name: cleanEnchant(e.display_string) })),
    sockets: (it.sockets || []).map((s) => ({ type: s.socket_type?.type, gem: s.item?.id ?? null, gemName: s.item?.name ?? null })),
  };
}

// Off-hand : seules les armes s'enchantent (pas les boucliers ni les objets tenus en main gauche).
function isEnchantable(item) {
  if (!config.slotsEnchantables.includes(item.slot)) return false;
  if (item.slot === 'OFF_HAND') return ['WEAPON', 'WEAPONOFFHAND', 'WEAPONMAINHAND'].includes(item.invType);
  return true;
}

function checks(items) {
  const missingEnchants = items.filter((i) => isEnchantable(i) && i.enchants.length === 0).map((i) => i.slotName);
  const emptySockets = items.flatMap((i) => i.sockets.filter((s) => !s.gem).map(() => i.slotName));
  return { missingEnchants, emptySockets };
}

async function fetchCharacter(m) {
  const realm = m.character.realm.slug;
  const name = m.character.name.toLowerCase();
  const base = `/profile/wow/character/${realm}/${encodeURIComponent(name)}`;
  const [summary, equip, specs, profs, media] = await Promise.all([
    api(base), api(`${base}/equipment`), api(`${base}/specializations`),
    api(`${base}/professions`), api(`${base}/character-media`),
  ]);
  const char = {
    name: m.character.name,
    realm,
    level: m.character.level,
    classId: m.character.playable_class.id,
    rank: m.rank,
    found: !!summary,
  };
  if (!summary) return char;

  const items = (equip?.equipped_items || []).filter((i) => !['SHIRT', 'TABARD'].includes(i.slot.type)).map(simplifyItem);
  const activeLoadout = specs?.specializations
    ?.find((s) => s.specialization.id === specs.active_specialization?.id)
    ?.loadouts?.find((l) => l.is_active);
  const asset = (k) => media?.assets?.find((a) => a.key === k)?.value ?? null;

  return {
    ...char,
    className: summary.character_class?.name,
    race: summary.race?.name,
    spec: summary.active_spec?.name ?? null,
    hero: activeLoadout?.selected_hero_talent_tree?.name ?? null,
    talentCode: activeLoadout?.talent_loadout_code ?? null,
    ilvl: summary.equipped_item_level ?? 0,
    lastLogin: summary.last_login_timestamp ?? null,
    avatar: asset('avatar'),
    render: asset('main-raw'),
    professions: (profs?.primaries || []).map((p) => {
      const tier = p.tiers?.at(-1);
      return { id: p.profession.id, name: METIERS[p.profession.id] || p.profession.name, skill: tier?.skill_points ?? 0, max: tier?.max_skill_points ?? 0 };
    }),
    cooking: (() => {
      const c = profs?.secondaries?.find((p) => p.profession.id === 185)?.tiers?.at(-1);
      return c ? { skill: c.skill_points, max: c.max_skill_points } : null;
    })(),
    items,
    ...checks(items),
  };
}

async function main() {
  token = await getToken();
  const guildSlug = encodeURIComponent(config.guild.toLowerCase());
  const roster = await api(`/data/wow/guild/${config.realm}/${guildSlug}/roster`);
  if (!roster) throw new Error('Roster introuvable : vérifie realm/guild dans config.json');

  const members = roster.members.filter((m) => m.character.level >= config.niveauMin);
  console.log(`${roster.members.length} membres, ${members.length} au niveau ${config.niveauMin}+ → synchronisation…`);

  let done = 0;
  const characters = await pool(members, 8, async (m) => {
    const c = await fetchCharacter(m);
    if (++done % 25 === 0) console.log(`  ${done}/${members.length}`);
    return c;
  });

  // Statistiques d'enchantement par emplacement : utile pour valider config.slotsEnchantables.
  const stats = {};
  for (const c of characters.filter((c) => c.items)) {
    for (const i of c.items) {
      stats[i.slot] ??= { total: 0, enchanted: 0 };
      stats[i.slot].total++;
      if (i.enchants.length) stats[i.slot].enchanted++;
    }
  }

  const data = {
    generatedAt: new Date().toISOString(),
    guild: { name: roster.guild.name, realm: roster.guild.realm.name, faction: roster.guild.faction?.name, memberCount: roster.members.length },
    config: { niveauMin: config.niveauMin, joursInactif: config.joursInactif, rangs: config.rangs },
    enchantStats: stats,
    characters,
  };
  mkdirSync(join(ROOT, 'site/data'), { recursive: true });
  writeFileSync(join(ROOT, 'site/data/guild.json'), JSON.stringify(data));

  const missing = characters.filter((c) => c.found).length;
  console.log(`OK : ${missing} profils récupérés, ${characters.length - missing} introuvables (inactifs/cachés).`);
  console.log('Taux d\'enchantement par emplacement :');
  for (const [slot, s] of Object.entries(stats).sort()) console.log(`  ${slot.padEnd(10)} ${String(Math.round((100 * s.enchanted) / s.total)).padStart(3)} %`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
