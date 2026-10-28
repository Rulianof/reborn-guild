// Analyses « coaching » d'un rapport Warcraft Logs, à partir des données supplémentaires (raw.extra) :
// activité (Always Be Casting), dégâts probablement évitables, défensifs et soins avant les morts,
// progression par boss et kicks manqués. Tout est calculé ici, sans requête : un changement de règle
// se teste sur le cache local sans toucher au quota.
import { config } from './common.mjs';

// Défensifs personnels par classe (noms anglais, tels que Warcraft Logs les donne).
export const DEFENSIFS = {
  DeathKnight: ['Icebound Fortitude', 'Anti-Magic Shell', 'Vampiric Blood', 'Lichborne'],
  DemonHunter: ['Blur', 'Netherwalk', 'Darkness', 'Fiery Brand'],
  Druid: ['Barkskin', 'Survival Instincts', 'Renewal', 'Frenzied Regeneration'],
  Evoker: ['Obsidian Scales', 'Renewing Blaze'],
  Hunter: ['Aspect of the Turtle', 'Survival of the Fittest', 'Exhilaration'],
  Mage: ['Ice Block', 'Ice Barrier', 'Blazing Barrier', 'Prismatic Barrier', 'Mirror Image', 'Greater Invisibility', 'Ice Cold'],
  Monk: ['Fortifying Brew', 'Diffuse Magic', 'Dampen Harm', 'Touch of Karma'],
  Paladin: ['Divine Shield', 'Divine Protection', 'Shield of Vengeance', 'Lay on Hands', 'Ardent Defender', 'Guardian of Ancient Kings'],
  Priest: ['Desperate Prayer', 'Dispersion', 'Fade'],
  Rogue: ['Cloak of Shadows', 'Evasion', 'Feint', 'Crimson Vial'],
  Shaman: ['Astral Shift', 'Stone Bulwark Totem'],
  Warlock: ['Unending Resolve', 'Dark Pact'],
  Warrior: ['Die by the Sword', 'Enraged Regeneration', 'Shield Wall', 'Spell Reflection', 'Impending Victory'],
};
export const SOINS = () => config.wcl.soins || ['Healthstone', 'Demonic Healthstone', 'Silvermoon Health Potion', 'Concentrated Silvermoon Health Potion', 'Potent Healing Potion'];
export const surveilles = () => [...new Set([...Object.values(DEFENSIFS).flat(), ...SOINS()])];

const FENETRE_MORT = 20000; // ms avant la mort où un défensif ou un soin « compte »

// Une capacité est « probablement évitable » sur un boss quand les dégâts qu'elle inflige sont très
// inégaux : les 10 % les plus touchés en prennent au moins 3× plus que le joueur médian (par pull),
// alors que des dégâts de raid inévitables se répartissent à peu près pareil sur tout le monde.
// Exclus : mêlée, capacités qui visent surtout les tanks, et celles qui pèsent trop peu.
// config.wcl.mecaniques force le classement : { "Nom": "evitable" | "inevitable" }.
function classify(entry, perPull, ctx) {
  const forced = config.wcl.mecaniques?.[entry.name];
  if (forced) return forced === 'evitable';
  if (ctx.pulls < 2 || ctx.present < 8 || entry.name === 'Melee') return false;
  const total = entry.targets.reduce((s, t) => s + (ctx.presentSet.has(t.name) ? t.total : 0), 0);
  if (!total || total < ctx.encTotal * 0.01) return false;
  const tanks = entry.targets.filter((t) => ctx.presentSet.has(t.name) && ctx.roleOf(t.name) === 'tanks').reduce((s, t) => s + t.total, 0);
  if (tanks / total >= 0.5) return false;
  const values = [...perPull.values()].sort((x, y) => x - y);
  const med = values[Math.floor(values.length / 2)];
  const p90 = values[Math.floor(values.length * 0.9)];
  return p90 > 0 && (med === 0 || p90 / med >= 3);
}

const median = (a) => {
  const s = a.filter((x) => typeof x === 'number').sort((x, y) => x - y);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

// fights : combats gardés ; fightPlayers : id → noms présents ; deaths : id → [{ name, time, killer, counted }].
export function analyse(raw, { fights, fightPlayers, deaths, roleOf, players }) {
  const extra = raw.extra;
  if (!extra) return null;
  const out = {};
  const P = (n) => (out[n] ??= { active: 0, alive: 0, avoidable: 0, avoidPulls: 0, worst: null, defensives: 0, healItems: 0, deathsChecked: 0, deathsNoDef: 0 });

  // Événements de défensifs / soins, par joueur.
  const defsBy = new Map();
  for (const e of extra.defs || []) {
    if (!defsBy.has(e.src)) defsBy.set(e.src, []);
    defsBy.get(e.src).push(e);
  }
  const isHeal = new Set(SOINS());
  for (const [name, list] of defsBy) {
    if (!players.has(name)) continue;
    for (const e of list) (isHeal.has(e.ability) ? P(name).healItems++ : P(name).defensives++);
  }
  for (const list of Object.values(deaths)) {
    for (const d of list.filter((x) => x.counted)) {
      const p = P(d.name);
      p.deathsChecked++;
      const used = (defsBy.get(d.name) || []).some((e) => e.t <= d.time && e.t >= d.time - FENETRE_MORT);
      if (!used) p.deathsNoDef++;
    }
  }

  const encounters = [];
  const byEnc = new Map();
  for (const f of fights) {
    if (!byEnc.has(f.encounterID)) byEnc.set(f.encounterID, []);
    byEnc.get(f.encounterID).push(f);
  }
  for (const [enc, fs] of byEnc) {
    const presentSet = new Set(fs.flatMap((f) => fightPlayers.get(f.id) || []).filter((n) => players.has(n)));
    // Activité : temps passé à lancer des sorts / temps vivant pendant les pulls.
    for (const f of fs) {
      for (const n of fightPlayers.get(f.id) || []) {
        const died = (deaths[f.id] || []).find((d) => d.name === n);
        P(n).alive += (died ? died.time : f.endTime) - f.startTime;
        P(n).avoidPulls++;
      }
    }
    for (const c of extra.casts?.[enc]?.entries || []) if (presentSet.has(c.name)) P(c.name).active += c.activeTime || 0;

    // Pulls de présence par joueur sur ce boss (pour ramener les dégâts « par pull »).
    const pullsOf = new Map([...presentSet].map((n) => [n, fs.filter((f) => (fightPlayers.get(f.id) || []).includes(n)).length]));
    // Une même capacité peut apparaître plusieurs fois (coup direct, dégâts sur la durée…) : on fusionne par nom.
    const merged = new Map();
    for (const e of extra.taken?.[enc] || []) {
      if (!merged.has(e.name)) merged.set(e.name, { name: e.name, targets: new Map() });
      const m = merged.get(e.name);
      // Côté joueur, les parties d'une même capacité s'additionnent ; entre doublons du boss, la liste est la même.
      const sums = new Map();
      for (const t of e.targets) sums.set(t.name, (sums.get(t.name) || 0) + t.total);
      for (const [n, v] of sums) m.targets.set(n, Math.max(m.targets.get(n) || 0, v));
    }
    const taken = [...merged.values()].map((m) => ({ name: m.name, targets: [...m.targets].map(([name, total]) => ({ name, total })) }));
    const encTotal = taken.reduce((s, e) => s + e.targets.reduce((x, t) => x + (presentSet.has(t.name) ? t.total : 0), 0), 0);
    const ctx = { pulls: fs.length, present: presentSet.size, presentSet, encTotal, roleOf };
    const avoidable = [];
    for (const e of taken) {
      const perPull = new Map([...presentSet].map((n) => [n, 0]));
      for (const t of e.targets) if (presentSet.has(t.name)) perPull.set(t.name, t.total / Math.max(1, pullsOf.get(t.name)));
      if (!classify(e, perPull, ctx)) continue;
      const values = [...perPull.values()].sort((x, y) => x - y);
      const med = values[Math.floor(values.length / 2)];
      avoidable.push({ name: e.name, total: Math.round(e.targets.reduce((s, t) => s + (presentSet.has(t.name) ? t.total : 0), 0)), medianPerPull: Math.round(med) });
      for (const [n, v] of perPull) {
        const p = P(n);
        p.avoidable += v * pullsOf.get(n);
        // Écart au joueur médian : « tu en prends X fois plus que la plupart du raid ».
        const ratio = med > 0 ? v / med : v > 0 ? Infinity : 0;
        if (v > 0 && ratio >= 2 && (!p.worst || v - med > p.worst.excess)) p.worst = { name: e.name, boss: fs[0].name, ratio: Number.isFinite(ratio) ? Math.round(ratio * 10) / 10 : null, excess: v - med };
      }
    }

    const killers = {};
    for (const f of fs) for (const d of (deaths[f.id] || []).filter((x) => x.counted && x.killer)) killers[d.killer] = (killers[d.killer] || 0) + 1;
    encounters.push({
      id: enc, name: fs[0].name, difficulty: fs[0].difficulty,
      pulls: fs.map((f) => ({ kill: !!f.kill, pct: extra.fights?.[f.id]?.pct ?? f.fightPercentage, phase: extra.fights?.[f.id]?.phase ?? null, dur: f.endTime - f.startTime })),
      killers: Object.entries(killers).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count })),
      avoidable: avoidable.sort((a, b) => b.total - a.total).slice(0, 8),
    });
  }

  // Kicks manqués : sorts ennemis que la guilde interrompt souvent mais pas toujours.
  const missedKicks = [];
  for (const group of raw.tables?.interrupts?.data?.entries || []) {
    for (const s of group.entries || []) {
      const done = s.spellsCompleted || 0, kicked = s.spellsInterrupted || 0;
      if (kicked >= 3 && done > 0 && kicked / (kicked + done) >= 0.3) missedKicks.push({ name: s.name, done, kicked });
    }
  }

  const perPlayer = {};
  for (const [n, p] of Object.entries(out)) {
    perPlayer[n] = {
      activity: p.alive ? Math.min(100, Math.round((100 * p.active) / p.alive)) : null,
      avoidable: Math.round(p.avoidable),
      avoidablePerPull: p.avoidPulls ? Math.round(p.avoidable / p.avoidPulls) : 0,
      topAvoidable: p.worst ? { name: p.worst.name, boss: p.worst.boss, ratio: p.worst.ratio } : null,
      defensives: p.defensives, healItems: p.healItems, deathsChecked: p.deathsChecked, deathsNoDef: p.deathsNoDef,
    };
  }
  return { encounters, perPlayer, missedKicks: missedKicks.sort((a, b) => b.done - a.done).slice(0, 6), median };
}

// Médianes par rôle (tanks, soigneurs, DPS) : sert de point de comparaison « par rapport à la guilde ».
export function roleMedians(list) {
  const out = {};
  for (const role of ['tanks', 'healers', 'dps']) {
    const ps = list.filter((p) => !p.guest && p.role === role);
    out[role] = {
      activity: median(ps.map((p) => p.activity)),
      avoidablePerPull: median(ps.map((p) => p.avoidablePerPull)),
      deaths: median(ps.map((p) => p.deaths)),
      avgParse: median(ps.map((p) => p.avgParse)),
    };
  }
  return out;
}
