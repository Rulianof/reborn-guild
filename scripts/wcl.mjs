// Warcraft Logs (API v2 GraphQL) : soirées de raid, Hall of Fame / Hall of Shame, parses par perso.
// Facultatif : sans clé ou si Warcraft Logs ne répond pas, la synchro continue sans ces données.
// Les rapports déjà analysés sont gardés dans cache/wcl/ (restauré par GitHub Actions entre deux runs).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, config, env } from './common.mjs';

const WCL = 'https://www.warcraftlogs.com';
const CACHE = join(ROOT, 'cache/wcl');
const CACHE_VERSION = 1; // à incrémenter quand processReport change, pour recalculer les soirées
const DAY = 86400000;

let token;
async function auth() {
  const id = env('WCL_CLIENT_ID'), secret = env('WCL_CLIENT_SECRET');
  if (!id || !secret) return false;
  const res = await fetch(`${WCL}/oauth/token`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`token Warcraft Logs refusé (HTTP ${res.status})`);
  token = (await res.json()).access_token;
  return true;
}

async function gql(query, variables = {}) {
  const res = await fetch(`${WCL}/api/v2/client`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Warcraft Logs HTTP ${res.status}`);
  const body = await res.json();
  if (body.errors?.length) throw new Error(`Warcraft Logs : ${body.errors.map((e) => e.message).join(' ; ')}`);
  return body.data;
}

// Les champs de type JSON arrivent parfois sérialisés en chaîne.
const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v) ?? null;

// ---------- Requêtes ----------

async function listReports(since) {
  const data = await gql(`query($name: String!, $server: String!, $region: String!, $start: Float!) {
    reportData { reports(guildName: $name, guildServerSlug: $server, guildServerRegion: $region, startTime: $start, limit: 100) {
      data { code title startTime endTime zone { id name } }
    } }
  }`, { name: config.wcl.guildName, server: config.realm, region: config.region, start: since });
  return data.reportData.reports.data || [];
}

async function fetchReport(code) {
  const base = await gql(`query($code: String!) { reportData { report(code: $code) {
    code title startTime endTime zone { id name }
    fights(killType: Encounters) { id encounterID name difficulty kill fightPercentage startTime endTime }
    masterData { actors(type: "Player") { id name server subType } abilities { gameID name } }
  } } }`, { code });
  const report = base.reportData.report;
  const fightIDs = report.fights.map((f) => f.id);
  if (!fightIDs.length) return { ...report, tables: null };

  const t = await gql(`query($code: String!, $ids: [Int]!) { reportData { report(code: $code) {
    rankings(fightIDs: $ids, compare: Parses)
    deaths: table(dataType: Deaths, fightIDs: $ids)
    interrupts: table(dataType: Interrupts, fightIDs: $ids)
    dispels: table(dataType: Dispels, fightIDs: $ids)
    combatants: events(dataType: CombatantInfo, fightIDs: $ids, limit: 10000) { data }
  } } }`, { code, ids: fightIDs });
  const r = t.reportData.report;
  return {
    ...report,
    tables: {
      rankings: json(r.rankings), deaths: json(r.deaths), interrupts: json(r.interrupts),
      dispels: json(r.dispels), combatants: json(r.combatants?.data) || [],
    },
  };
}

// Parses de la zone en cours pour une liste de persos, par lots (alias GraphQL).
async function fetchZoneRankings(chars) {
  const out = new Map();
  for (let i = 0; i < chars.length; i += 10) {
    const batch = chars.slice(i, i + 10);
    const fields = batch.map((c, j) =>
      `c${j}: character(name: ${JSON.stringify(c.name)}, serverSlug: ${JSON.stringify(c.realm)}, serverRegion: ${JSON.stringify(config.region)}) { zoneRankings(difficulty: ${config.wcl.difficulty}) }`).join('\n');
    const data = await gql(`query { characterData { ${fields} } }`);
    batch.forEach((c, j) => {
      const z = json(data.characterData[`c${j}`]?.zoneRankings);
      if (!z?.rankings) return;
      out.set(c.name, {
        best: round(z.bestPerformanceAverage),
        median: round(z.medianPerformanceAverage),
        zone: z.zone ?? null,
        bosses: z.rankings.filter((r) => r.totalKills > 0).map((r) => ({
          name: r.encounter?.name, best: round(r.rankPercent), median: round(r.medianPercent), kills: r.totalKills,
        })),
      });
    });
  }
  return out;
}

const round = (n) => (typeof n === 'number' ? Math.round(n * 10) / 10 : null);

// ---------- Analyse d'un rapport ----------

// Additionne les « total » des nœuds dont le nom est un joueur, sans dépendre de la forme exacte du tableau.
function sumByPlayer(table, players) {
  const out = {};
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (players.has(node.name) && typeof node.total === 'number') {
      out[node.name] = (out[node.name] || 0) + node.total;
      return;
    }
    Object.values(node).forEach(walk);
  };
  walk(table?.data ?? table);
  return out;
}

export function processReport(raw) {
  const fights = raw.fights || [];
  const players = new Set((raw.masterData?.actors || []).map((a) => a.name));
  const actorById = new Map((raw.masterData?.actors || []).map((a) => [a.id, a]));
  const abilityName = new Map((raw.masterData?.abilities || []).map((a) => [a.gameID, a.name]));
  const t = raw.tables || {};
  const stats = {};
  const P = (name) => (stats[name] ??= {
    name, server: null, cls: null, pulls: 0, kills: 0, deaths: 0, firstDeaths: 0,
    parses: [], dps: [], hps: [], interrupts: 0, dispels: 0, noFlask: 0, noFood: 0, checked: 0,
  });

  // Présence : qui figure dans les pulls (via CombatantInfo, un événement par joueur et par pull).
  for (const ev of t.combatants || []) {
    const a = actorById.get(ev.sourceID);
    if (!a) continue;
    const p = P(a.name);
    p.server = a.server; p.cls = a.subType;
    p.pulls++;
    if (fights.find((f) => f.id === ev.fight)?.kill) p.kills++;
    const auras = (ev.auras || []).map((x) => abilityName.get(x.ability) || x.name || '');
    if (auras.length) {
      p.checked++;
      if (!auras.some((n) => /flask|phial|flacon|fiole/i.test(n))) p.noFlask++;
      if (!auras.some((n) => /well fed|hearty|bien nourri|repu/i.test(n))) p.noFood++;
    }
  }

  // Parses et DPS/HPS sur les kills.
  for (const fight of json(t.rankings)?.data || []) {
    const roles = fight.roles || {};
    for (const [role, list] of Object.entries(roles)) {
      for (const ch of list.characters || []) {
        const p = P(ch.name);
        p.cls ??= ch.class;
        if (typeof ch.rankPercent === 'number') p.parses.push({ boss: fight.encounter?.name, pct: ch.rankPercent, spec: ch.spec });
        if (typeof ch.amount === 'number') (role === 'healers' ? p.hps : p.dps).push(ch.amount);
      }
    }
  }

  // Morts, et premier mort de chaque pull.
  const firstByFight = new Map();
  for (const d of t.deaths?.data?.entries || t.deaths?.entries || []) {
    if (!players.has(d.name)) continue;
    P(d.name).deaths++;
    const fightId = d.fight ?? fights.find((f) => d.deathTime >= f.startTime && d.deathTime <= f.endTime)?.id;
    if (fightId == null) continue;
    const prev = firstByFight.get(fightId);
    if (!prev || d.deathTime < prev.deathTime) firstByFight.set(fightId, d);
  }
  for (const d of firstByFight.values()) P(d.name).firstDeaths++;

  for (const [n, v] of Object.entries(sumByPlayer(t.interrupts, players))) P(n).interrupts = v;
  for (const [n, v] of Object.entries(sumByPlayer(t.dispels, players))) P(n).dispels = v;

  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const list = Object.values(stats).filter((p) => p.pulls || p.parses.length).map((p) => ({
    name: p.name, server: p.server, cls: p.cls, pulls: p.pulls, kills: p.kills, deaths: p.deaths, firstDeaths: p.firstDeaths,
    bestParse: p.parses.length ? Math.max(...p.parses.map((x) => x.pct)) : null,
    avgParse: round(avg(p.parses.map((x) => x.pct))),
    bestParseBoss: p.parses.sort((a, b) => b.pct - a.pct)[0]?.boss ?? null,
    dps: Math.round(avg(p.dps) || 0), hps: Math.round(avg(p.hps) || 0),
    interrupts: p.interrupts, dispels: p.dispels,
    noFlask: p.noFlask, noFood: p.noFood, checked: p.checked,
  }));

  return {
    v: CACHE_VERSION,
    code: raw.code, title: raw.title, startTime: raw.startTime, endTime: raw.endTime, zone: raw.zone?.name ?? null,
    pulls: fights.length,
    kills: fights.filter((f) => f.kill).map((f) => ({ name: f.name, difficulty: f.difficulty })),
    wipes: fights.filter((f) => !f.kill).length,
    players: list,
  };
}

// ---------- Hall of Fame / Shame ----------

// Le joueur avec la plus grande valeur pour `key` (au moins 1), ou null.
const top = (players, key) => {
  const c = players.filter((p) => typeof p[key] === 'number' && p[key] >= 1).sort((a, b) => b[key] - a[key]);
  return c.length ? { name: c[0].name, value: c[0][key] } : null;
};

export function hallOf(night, optOut) {
  const ps = night.players;
  const shameable = ps.filter((p) => !optOut.has(p.name.toLowerCase()));
  const present = (p) => p.pulls >= Math.max(3, night.pulls / 2);
  const fame = [
    { id: 'parse', title: 'Meilleur parse', icon: '🏆', ...top(ps, 'bestParse'), unit: '%', detail: (w) => ps.find((p) => p.name === w)?.bestParseBoss },
    { id: 'dps', title: 'Top DPS', icon: '⚔️', ...top(ps, 'dps'), unit: ' DPS' },
    { id: 'hps', title: 'Top soins', icon: '💚', ...top(ps, 'hps'), unit: ' HPS' },
    { id: 'kick', title: 'Roi du kick', icon: '🦶', ...top(ps, 'interrupts'), unit: ' interrupts' },
    { id: 'dispel', title: 'Dispel express', icon: '✨', ...top(ps, 'dispels'), unit: ' dispels' },
    { id: 'alive', title: 'Immortel', icon: '🛡️', list: ps.filter((p) => present(p) && p.deaths === 0).map((p) => p.name) },
  ];
  const shame = [
    { id: 'first', title: 'Premier à tomber', icon: '🪦', ...top(shameable, 'firstDeaths'), unit: ' fois en premier' },
    { id: 'floor', title: 'Abonné au sol', icon: '💀', ...top(shameable, 'deaths'), unit: ' morts' },
    { id: 'flask', title: 'Sans flacon', icon: '🧪', ...top(shameable, 'noFlask'), unit: ' pulls sans flacon' },
    { id: 'food', title: 'Le ventre vide', icon: '🍗', ...top(shameable, 'noFood'), unit: ' pulls sans nourriture' },
  ];
  const clean = (arr) => arr.filter((a) => a.name || a.list?.length).map(({ detail, ...a }) => ({ ...a, detail: detail?.(a.name) ?? null }));
  return { fame: clean(fame), shame: clean(shame) };
}

// ---------- Point d'entrée ----------

const parisDate = (ts) => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(ts); // AAAA-MM-JJ

export async function syncWcl(characters) {
  if (!(await auth())) return { status: 'no-key' };
  mkdirSync(CACHE, { recursive: true });
  const since = Date.now() - config.wcl.semaines * 7 * DAY;
  const reports = (await listReports(since)).filter((r) => !config.wcl.zoneIds?.length || config.wcl.zoneIds.includes(r.zone?.id));

  const processed = [];
  for (const r of reports) {
    const file = join(CACHE, `${r.code}.json`);
    const cached = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    // Un rapport encore « en cours » (fini il y a moins de 6 h) est rechargé à chaque synchro.
    const fresh = cached?.v === CACHE_VERSION && cached.endTime === r.endTime && Date.now() - r.endTime > 6 * 3600000;
    const rep = fresh ? cached : processReport(await fetchReport(r.code));
    if (!fresh) writeFileSync(file, JSON.stringify(rep));
    processed.push(rep);
  }

  // Une soirée = une date ; si plusieurs personnes ont loggé, on garde le rapport le plus complet.
  const byNight = new Map();
  for (const rep of processed) {
    if (!rep.pulls) continue;
    const date = parisDate(rep.startTime);
    const prev = byNight.get(date);
    if (!prev || rep.pulls > prev.pulls) byNight.set(date, rep);
  }
  const optOut = new Set((config.wcl.shameOptOut || []).map((n) => n.toLowerCase()));
  const nights = [...byNight.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, rep]) => ({
    date, ...rep, url: `${WCL}/reports/${rep.code}`, ...hallOf(rep, optOut),
  }));

  // Présence par perso (nombre de soirées et de pulls) : sert aussi à choisir le main d'un compte.
  const attendance = {};
  for (const n of nights) for (const p of n.players) {
    attendance[p.name] ??= { nights: 0, pulls: 0 };
    attendance[p.name].nights++;
    attendance[p.name].pulls += p.pulls;
  }

  const DAYS30 = 30 * DAY;
  const active = characters.filter((c) => c.found && c.lastLogin && Date.now() - c.lastLogin < DAYS30);
  const parses = await fetchZoneRankings(active);

  return { status: 'ok', nights, attendance, parses: Object.fromEntries(parses), totalNights: nights.length };
}
