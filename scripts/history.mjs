// Historique de la guilde, gardé d'une synchro à l'autre (cache/history.json, comme les rapports) :
// un résumé compact de chaque soirée, même quand son rapport sort de la période Warcraft Logs suivie,
// et l'ilvl de chaque perso jour après jour. Sert au classement de saison, aux succès et aux courbes
// d'évolution. Rien n'est supprimé : une soirée déjà connue est seulement remplacée par sa version à jour.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './common.mjs';

const FILE = join(ROOT, 'cache', 'history.json');
const parisDate = (ts) => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(ts);

const PLAYER_KEYS = ['name', 'guest', 'cls', 'role', 'pulls', 'kills', 'deaths', 'firstDeaths', 'bestParse', 'avgParse',
  'activity', 'avoidablePerPull', 'interrupts', 'dispels', 'noFlask', 'noFood', 'checked', 'deathsNoDef', 'healItems'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] != null).map((k) => [k, o[k]]));

function compactNight(n) {
  return {
    date: n.date, zone: n.zone, pulls: n.pulls,
    kills: (n.encounters || []).filter((e) => e.pulls.some((p) => p.kill)).map((e) => e.name),
    // Wipes par boss : distingue un kill de progression d'un boss déjà farmé.
    wipes: Object.fromEntries((n.encounters || []).map((e) => [e.name, e.pulls.filter((p) => !p.kill).length])),
    players: n.players.map((p) => pick(p, PLAYER_KEYS)),
    fame: n.fame.map((f) => (f.list ? { id: f.id, list: f.list } : { id: f.id, name: f.name, value: f.value })),
    shame: n.shame.map((f) => ({ id: f.id, name: f.name, value: f.value })),
    medians: n.medians,
  };
}

export function updateHistory(nights, characters) {
  const h = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { nights: {}, ilvl: {} };
  for (const n of nights || []) h.nights[n.date] = compactNight(n);
  const today = parisDate(Date.now());
  for (const c of characters.filter((c) => c.found && c.ilvl)) {
    const id = `${c.realm}/${c.name.toLowerCase()}`;
    const list = (h.ilvl[id] ??= []);
    // Un point par jour, et seulement quand l'ilvl change (le fichier reste petit).
    if (list.at(-1)?.[0] === today) list.at(-1)[1] = c.ilvl;
    else if (list.at(-1)?.[1] !== c.ilvl) list.push([today, c.ilvl]);
  }
  mkdirSync(join(ROOT, 'cache'), { recursive: true });
  writeFileSync(FILE, JSON.stringify(h));
  return {
    nights: Object.values(h.nights).sort((a, b) => a.date.localeCompare(b.date)),
    ilvl: h.ilvl,
  };
}
