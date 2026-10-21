// Récupère le roster de la guilde et les profils des persos via l'API Blizzard,
// puis écrit site/data/guild.json. Usage : node scripts/sync.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, config, env } from './common.mjs';
import { currentRaids, guildProgression, characterData } from './raiderio.mjs';
import { syncWcl } from './wcl.mjs';

const BLIZZARD_CLIENT_ID = env('BLIZZARD_CLIENT_ID');
const BLIZZARD_CLIENT_SECRET = env('BLIZZARD_CLIENT_SECRET');
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

const charPath = (m) => `/profile/wow/character/${m.character.realm.slug}/${encodeURIComponent(m.character.name.toLowerCase())}`;

// Détails complets, seulement pour les persos au niveau requis.
async function fetchCharacter(m, summary) {
  const realm = m.character.realm.slug;
  const base = charPath(m);
  const [equip, specs, profs, media, encounters] = summary
    ? await Promise.all([api(`${base}/equipment`), api(`${base}/specializations`), api(`${base}/professions`), api(`${base}/character-media`), api(`${base}/encounters/raids`)])
    : [];
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
    achievementPoints: summary.achievement_points ?? 0,
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
    raidKillsThisWeek: raidKillsSince(encounters, lastReset()),
  };
}

// Réinitialisation hebdomadaire EU : mercredi 04:00 UTC.
function lastReset(now = Date.now()) {
  const d = new Date(now);
  d.setUTCHours(4, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - 3 + 7) % 7));
  if (d.getTime() > now) d.setUTCDate(d.getUTCDate() - 7);
  return d.getTime();
}

const DIFF_RANK = { LFR: 1, NORMAL: 2, HEROIC: 3, MYTHIC: 4 };

// Boss tués depuis la réinitialisation, avec la plus haute difficulté (une entrée par boss).
function raidKillsSince(encounters, since) {
  const best = new Map();
  for (const exp of encounters?.expansions || []) {
    for (const inst of exp.instances || []) {
      for (const mode of inst.modes || []) {
        const diff = mode.difficulty?.type;
        for (const e of mode.progress?.encounters || []) {
          if ((e.last_kill_timestamp || 0) < since || !DIFF_RANK[diff]) continue;
          const k = e.encounter.id;
          if (!best.has(k) || DIFF_RANK[diff] > DIFF_RANK[best.get(k).diff]) best.set(k, { instance: inst.instance.name, boss: e.encounter.name, diff });
        }
      }
    }
  }
  return [...best.values()];
}

// Coffre de la semaine : emplacements débloqués et niveau de récompense de chacun.
function computeVault(c, raids) {
  const { donjons, raid } = config.coffre;
  const keys = (c.rio?.weekRuns || []).map((r) => r.level).sort((a, b) => b - a);
  const names = new Set(raids.map((r) => r.name));
  const kills = (c.raidKillsThisWeek || []).filter((k) => names.has(k.instance)).sort((a, b) => DIFF_RANK[b.diff] - DIFF_RANK[a.diff]);
  return {
    reset: lastReset(),
    mplus: { runs: keys.length, slots: donjons.map((n) => keys[n - 1] ?? null), next: donjons.find((n) => keys.length < n) ?? null },
    raid: { bosses: kills.length, slots: raid.map((n) => kills[n - 1]?.diff ?? null), next: raid.find((n) => kills.length < n) ?? null, kills },
  };
}

// Regroupe les persos d'un même compte.
// 1. Empreinte des mascottes (nombre + identifiants) : la collection est commune à tout le compte.
// 2. En secours, pour les persos sans mascottes visibles : points de hauts faits identiques, ou très proches
//    avec un nom qui commence pareil (accents ignorés), ex. Rulian / Rulîan / Ruliañ.
// Deux groupes aux empreintes de mascottes différentes ne sont jamais fusionnés automatiquement.
// config.comptes : { "reroll": "main" } rattache à la main ; config.mains : force le main d'un groupe.
function groupAccounts(rosterMembers, summaries, petPrints, characters) {
  const key = (name) => name.toLowerCase();
  const parent = new Map();
  const groupPrint = new Map();
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  const union = (a, b, force = false) => {
    if (!parent.has(a) || !parent.has(b)) return;
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    const pa = groupPrint.get(ra), pb = groupPrint.get(rb);
    if (!force && pa && pb && pa !== pb) return;
    parent.set(ra, rb);
    if (!pb && pa) groupPrint.set(rb, pa);
  };

  const all = rosterMembers.map((m, i) => ({
    id: key(m.character.name), name: m.character.name, realm: m.character.realm.slug,
    level: m.character.level, classId: m.character.playable_class.id,
    points: summaries[i]?.achievement_points ?? 0, pets: petPrints[i],
  }));
  for (const c of all) {
    parent.set(c.id, c.id);
    if (c.pets) groupPrint.set(c.id, c.pets);
  }

  const byPets = new Map();
  for (const c of all) {
    if (!c.pets) continue;
    if (byPets.has(c.pets)) union(c.id, byPets.get(c.pets));
    else byPets.set(c.pets, c.id);
  }

  const byPoints = new Map();
  for (const c of all) {
    if (!c.points) continue;
    if (byPoints.has(c.points)) union(c.id, byPoints.get(c.points));
    else byPoints.set(c.points, c.id);
  }
  const plain = (n) => n.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const prefix = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };
  const withPoints = all.filter((c) => c.points);
  for (let i = 0; i < withPoints.length; i++) {
    for (let j = i + 1; j < withPoints.length; j++) {
      const a = withPoints[i], b = withPoints[j];
      const close = Math.abs(a.points - b.points) <= Math.max(500, 0.02 * Math.max(a.points, b.points));
      if (close && prefix(plain(a.name), plain(b.name)) >= 4) union(a.id, b.id);
    }
  }
  for (const [alt, main] of Object.entries(config.comptes || {})) union(key(alt), key(main), true);

  const groups = new Map();
  for (const c of all) {
    const root = find(c.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(c);
  }
  const forced = new Set((config.mains || []).map(key));
  const detailed = new Map(characters.map((c) => [key(c.name), c]));

  for (const [root, members] of groups) {
    const playable = members.map((m) => detailed.get(m.id)).filter(Boolean);
    if (!playable.length) continue;
    // Main : forcé dans la config, sinon un perso actif, le plus joué en raid (Warcraft Logs), puis le meilleur ilvl.
    const raidPulls = (c) => c.wcl?.attendance?.pulls || 0;
    const active = (c) => (c.lastLogin && Date.now() - c.lastLogin < config.joursInactif * 86400000 ? 1 : 0);
    const main = playable.find((c) => forced.has(key(c.name)))
      || [...playable].sort((a, b) => active(b) - active(a) || raidPulls(b) - raidPulls(a) || (b.ilvl || 0) - (a.ilvl || 0) || (b.lastLogin || 0) - (a.lastLogin || 0))[0];
    for (const c of playable) {
      c.account = root;
      c.isMain = c === main;
      c.main = main.name;
      c.alts = members.filter((m) => m.id !== key(c.name)).map(({ name, realm, level, classId }) => ({ name, realm, level, classId }));
    }
  }
  return new Set(characters.map((c) => c.account)).size;
}

async function main() {
  token = await getToken();
  const guildSlug = encodeURIComponent(config.guild.toLowerCase());
  const roster = await api(`/data/wow/guild/${config.realm}/${guildSlug}/roster`);
  if (!roster) throw new Error('Roster introuvable : vérifie realm/guild dans config.json');

  console.log(`${roster.members.length} membres → profils…`);
  const summaries = await pool(roster.members, 10, (m) => api(charPath(m)));
  // Empreinte du compte : nombre de mascottes + somme de leurs identifiants.
  const petPrints = await pool(roster.members, 10, async (m, i) => {
    if (!summaries[i]) return null;
    const pets = (await api(`${charPath(m)}/collections/pets`))?.pets;
    return pets?.length ? `${pets.length}:${pets.reduce((s, p) => s + (p.id || 0), 0)}` : null;
  });

  const members = roster.members.map((m, i) => [m, summaries[i]]).filter(([m]) => m.character.level >= config.niveauMin);
  console.log(`${members.length} au niveau ${config.niveauMin}+ → détails…`);
  let done = 0;
  const characters = await pool(members, 8, async ([m, summary]) => {
    const c = await fetchCharacter(m, summary);
    if (++done % 25 === 0) console.log(`  ${done}/${members.length}`);
    return c;
  });

  // Raider.IO : rythme modéré pour rester sous leur limite de requêtes publique.
  const raids = await currentRaids();
  const progression = raids.length ? await guildProgression(raids) : null;
  let rioOk = 0;
  await pool(characters.filter((c) => c.found), 4, async (c) => {
    c.rio = await characterData(c, raids);
    if (c.rio) rioOk++;
  });
  console.log(`Raider.IO : ${raids.length} raids en cours, ${rioOk} persos.`);
  for (const c of characters.filter((c) => c.found)) {
    c.vault = computeVault(c, raids);
    delete c.raidKillsThisWeek;
  }

  let wcl;
  try {
    wcl = await syncWcl(characters);
  } catch (e) {
    wcl = { status: 'error', message: e.message };
  }
  if (wcl.status === 'ok') {
    for (const c of characters) c.wcl = { parses: wcl.parses[c.name] ?? null, attendance: wcl.attendance[c.name] ?? null };
    console.log(`Warcraft Logs : ${wcl.totalNights} soirées, ${Object.keys(wcl.parses).length} persos avec des parses.`);
  } else {
    console.log(`Warcraft Logs ignoré (${wcl.status === 'no-key' ? 'pas de clé' : wcl.message}).`);
  }
  mkdirSync(join(ROOT, 'site/data'), { recursive: true });
  writeFileSync(join(ROOT, 'site/data/raids.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), status: wcl.status, nights: wcl.nights || [],
  }));

  const accounts = groupAccounts(roster.members, summaries, petPrints, characters);
  console.log(`${accounts} comptes détectés pour ${characters.length} persos.`);

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
    config: { niveauMin: config.niveauMin, joursInactif: config.joursInactif, rangs: config.rangs, semainesWcl: config.wcl.semaines },
    raids,
    progression,
    wclStatus: wcl.status,
    enchantStats: stats,
    characters,
  };
  writeFileSync(join(ROOT, 'site/data/guild.json'), JSON.stringify(data));

  const missing = characters.filter((c) => c.found).length;
  console.log(`OK : ${missing} profils récupérés, ${characters.length - missing} introuvables (inactifs/cachés).`);
  console.log('Taux d\'enchantement par emplacement :');
  for (const [slot, s] of Object.entries(stats).sort()) console.log(`  ${slot.padEnd(10)} ${String(Math.round((100 * s.enchanted) / s.total)).padStart(3)} %`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
