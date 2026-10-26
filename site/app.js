const CLASS_COLORS = {
  1: '#C69B6D', 2: '#F48CBA', 3: '#AAD372', 4: '#FFF468', 5: '#FFFFFF', 6: '#C41E3A', 7: '#0070DD',
  8: '#3FC7EB', 9: '#8788EE', 10: '#00FF98', 11: '#FF7C0A', 12: '#A330C9', 13: '#33937F',
};
const DAY = 86400000;

const state = { data: null, raids: null, sort: { key: 'ilvl', dir: -1 }, q: '', cls: '', rank: '', inactifs: false, mainsOnly: true, view: 'tous' };
const $app = document.getElementById('app');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const color = (c) => CLASS_COLORS[c.classId] || '#ccc';
const isActive = (c) => c.lastLogin && Date.now() - c.lastLogin < state.data.config.joursInactif * DAY;
const rankName = (r) => state.data.config.rangs[r] ?? `Rang ${r}`;
const issues = (c) => (c.missingEnchants?.length || 0) + (c.emptySockets?.length || 0);
const groupSlots = (list) => Object.entries(list.reduce((m, s) => ((m[s] = (m[s] || 0) + 1), m), {})).map(([s, n]) => (n > 1 ? `${s} ×${n}` : s));
const mplus = (c) => c.rio?.score || 0;
const scoreCell = (c) => (mplus(c) ? `<b style="color:${esc(c.rio.color || 'inherit')}">${mplus(c)}</b>` : '<span class="muted">—</span>');
const mainRaid = () => state.data.raids?.[0];
const parseColor = (p) => (p >= 100 ? '#e5cc80' : p >= 99 ? '#e268a8' : p >= 95 ? '#ff8000' : p >= 75 ? '#a335ee' : p >= 50 ? '#0070ff' : p >= 25 ? '#1eff00' : '#888');
const parseCell = (p) => (typeof p === 'number' ? `<b style="color:${parseColor(p)}">${Math.round(p)}</b>` : '<span class="muted">—</span>');
const fmtNum = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n));
const fmtDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const charUrl = (c) => `#/perso/${c.realm}/${encodeURIComponent(c.name.toLowerCase())}`;
const ago = (ts) => {
  if (!ts) return '?';
  const d = Math.floor((Date.now() - ts) / DAY);
  return d <= 0 ? "aujourd'hui" : d === 1 ? 'hier' : `il y a ${d} j`;
};

function statusPill(c) {
  if (!c.found) return '<span class="pill">introuvable</span>';
  const n = c.missingEnchants.length, g = c.emptySockets.length;
  if (!n && !g) return '<span class="pill ok">✓ complet</span>';
  const parts = [];
  if (n) parts.push(`${n} enchant${n > 1 ? 's' : ''}`);
  if (g) parts.push(`${g} gemme${g > 1 ? 's' : ''}`);
  return `<span class="pill ${n ? 'bad' : 'warn'}">⚠ ${parts.join(' · ')}</span>`;
}

function charCell(c) {
  return `<div class="char">${favButton(c)}${c.avatar ? `<img src="${esc(c.avatar)}" alt="" loading="lazy">` : ''}
    <div><b style="color:${color(c)}">${esc(c.name)}</b> ${c.raider ? '<span class="pill raid" title="Roster raid">⚔</span> ' : ''}${altsChip(c)}${c.realm !== 'hyjal' ? `<div class="small">${esc(c.realm)}</div>` : ''}${rerollTag(c)}</div></div>`;
}

// Favoris personnels (navigateur) et vue choisie : tous, roster raid ou favoris.
const FAV_KEY = 'reborn.favoris';
const favs = new Set((() => { try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch { return []; } })());
const favId = (c) => `${c.realm}/${c.name.toLowerCase()}`;
const isFav = (c) => favs.has(favId(c));
function toggleFav(id) {
  favs.has(id) ? favs.delete(id) : favs.add(id);
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...favs])); } catch { /* navigation privée */ }
}
try { state.view = localStorage.getItem('reborn.vue') || 'tous'; } catch { /* idem */ }
const favButton = (c) => `<button class="fav ${isFav(c) ? 'on' : ''}" data-fav="${esc(favId(c))}" title="${isFav(c) ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${isFav(c) ? '★' : '☆'}</button>`;

function visibleChars({ withAlts = false } = {}) {
  return state.data.characters
    .filter((c) => state.inactifs || isActive(c) || (state.view === 'favoris' && isFav(c)))
    .filter((c) => withAlts || state.view === 'favoris' || !state.mainsOnly || c.isMain !== false)
    .filter((c) => state.view === 'tous' || (state.view === 'raid' ? c.raider : isFav(c)));
}

const findChar = (name, realm) => state.data.characters.find((x) => x.name === name && (!realm || x.realm === realm));
const altsChip = (c) => (c.isMain && c.alts?.length ? `<span class="pill" title="${esc(c.alts.map((a) => a.name).join(', '))}">+${c.alts.length} reroll${c.alts.length > 1 ? 's' : ''}</span>` : '');
const rerollTag = (c) => (c.isMain === false ? `<div class="small">reroll de ${esc(c.main)}</div>` : '');

function filters({ mains = true } = {}) {
  const views = [['tous', 'Tous'], ['raid', '⚔ Roster raid'], ['favoris', '★ Favoris']];
  return `<span class="seg">${views.map(([v, l]) => `<button data-view="${v}" class="${state.view === v ? 'on' : ''}">${l}${v === 'favoris' && favs.size ? ` (${favs.size})` : ''}</button>`).join('')}</span>
    ${mains ? `<label><input type="checkbox" id="mainsOnly" ${state.mainsOnly ? 'checked' : ''}> Mains uniquement</label>` : ''}
    <label><input type="checkbox" id="inactifs" ${state.inactifs ? 'checked' : ''}> Inclure les inactifs (+${state.data.config.joursInactif} j)</label>`;
}
function bindFilters(redraw) {
  const m = $app.querySelector('#mainsOnly'), i = $app.querySelector('#inactifs');
  if (m) m.onchange = (e) => { state.mainsOnly = e.target.checked; redraw(); };
  if (i) i.onchange = (e) => { state.inactifs = e.target.checked; redraw(); };
  $app.querySelectorAll('.seg button').forEach((b) => b.onclick = () => {
    state.view = b.dataset.view;
    try { localStorage.setItem('reborn.vue', state.view); } catch { /* navigation privée */ }
    route({ keepScroll: true });
  });
}

// Étoile de favori : bascule sans ouvrir la fiche, puis redessine la page.
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-fav]');
  if (!b) return;
  e.stopPropagation();
  e.preventDefault();
  toggleFav(b.dataset.fav);
  route({ keepScroll: true });
}, true);

function renderKpis() {
  const d = state.data;
  const active = d.characters.filter((c) => isActive(c) && c.isMain !== false);
  const avg = active.length ? Math.round(active.reduce((s, c) => s + (c.ilvl || 0), 0) / active.length) : 0;
  const clean = active.filter((c) => c.found && !issues(c)).length;
  document.getElementById('kpis').innerHTML = [
    [d.guild.memberCount, 'membres'],
    [active.length, 'joueurs actifs'],
    [avg, 'ilvl moyen'],
    [`${active.length ? Math.round((100 * clean) / active.length) : 0} %`, 'stuff complet'],
    ...(d.progression?.raids?.[0]?.summary ? [[d.progression.raids[0].summary, esc(d.progression.raids[0].name)]] : []),
  ].map(([v, l]) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join('');
  document.getElementById('guild-sub').textContent = `${d.guild.realm} · EU · ${d.guild.faction ?? ''}`;
  document.getElementById('updated').textContent = `Mis à jour le ${new Date(d.generatedAt).toLocaleString('fr-FR')}`;
}

// ---------- Membres ----------
function renderMembres() {
  const chars = state.data.characters;
  const classes = [...new Map(chars.filter((c) => c.className).map((c) => [c.classId, c.className])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const ranks = [...new Set(chars.map((c) => c.rank))].sort((a, b) => a - b);

  $app.innerHTML = `
    <div class="toolbar">
      <input type="search" id="q" placeholder="Rechercher un perso…" value="${esc(state.q)}">
      <select id="cls"><option value="">Toutes les classes</option>${classes.map(([id, n]) => `<option value="${id}" ${state.cls == id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <select id="rank"><option value="">Tous les rangs</option>${ranks.map((r) => `<option value="${r}" ${state.rank === String(r) ? 'selected' : ''}>${esc(rankName(r))}</option>`).join('')}</select>
      ${filters()}
    </div>
    <div class="table-wrap"><table>
      <thead><tr>
        ${[['name', 'Perso'], ['spec', 'Spé'], ['ilvl', 'ilvl'], ['mplus', 'M+'], ['rank', 'Rang'], ['prof', 'Métiers'], ['issues', 'État'], ['lastLogin', 'Vu']]
          .map(([k, l]) => `<th data-k="${k}" class="${state.sort.key === k ? 'sorted' : ''}">${l}${state.sort.key === k ? (state.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}
      </tr></thead>
      <tbody id="rows"></tbody>
    </table></div>`;

  const draw = () => {
    const q = state.q.toLowerCase();
    const list = visibleChars()
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .filter((c) => !state.cls || c.classId == state.cls)
      .filter((c) => state.rank === '' || String(c.rank) === state.rank);
    const val = {
      name: (c) => c.name, spec: (c) => c.spec || '', ilvl: (c) => c.ilvl || 0, mplus, rank: (c) => c.rank,
      prof: (c) => c.professions?.map((p) => p.name).join() || '', issues: issues, lastLogin: (c) => c.lastLogin || 0,
    }[state.sort.key];
    list.sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * state.sort.dir; });
    document.getElementById('rows').innerHTML = list.map((c) => `
      <tr data-href="${charUrl(c)}" class="${isActive(c) ? '' : 'inactive'}">
        <td>${charCell(c)}</td>
        <td>${esc(c.spec ?? '—')}${c.hero ? `<div class="small">${esc(c.hero)}</div>` : ''}</td>
        <td class="num">${c.ilvl || '—'}</td>
        <td class="num">${scoreCell(c)}</td>
        <td>${esc(rankName(c.rank))}</td>
        <td class="small">${(c.professions || []).map((p) => esc(p.name)).join(' · ') || '—'}</td>
        <td>${statusPill(c)}</td>
        <td class="small">${ago(c.lastLogin)}</td>
      </tr>`).join('') || '<tr><td colspan="8" class="muted">Aucun perso.</td></tr>';
  };
  draw();

  $app.querySelector('#q').oninput = (e) => { state.q = e.target.value; draw(); };
  $app.querySelector('#cls').onchange = (e) => { state.cls = e.target.value; draw(); };
  $app.querySelector('#rank').onchange = (e) => { state.rank = e.target.value; draw(); };
  bindFilters(draw);
  $app.querySelectorAll('th').forEach((th) => th.onclick = () => {
    const k = th.dataset.k;
    state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (k === 'name' || k === 'rank' ? 1 : -1) };
    renderMembres();
  });
  $app.querySelector('#rows').onclick = (e) => { if (e.target.closest('.fav')) return; const tr = e.target.closest('tr[data-href]'); if (tr) location.hash = tr.dataset.href; };
}

// ---------- Classement ----------
function progressBars(r) {
  const row = (label, n, cls) => `<div class="bar-row"><span>${label}</span><div class="bar"><i class="${cls}" style="width:${(100 * (n || 0)) / r.bosses}%"></i></div><b>${n || 0}/${r.bosses}</b></div>`;
  return row('Normal', r.normal, 'n') + row('Héroïque', r.heroic, 'h') + row('Mythique', r.mythic, 'm');
}

function renderClassement() {
  const prog = state.data.progression;
  const raid = mainRaid();
  const list = visibleChars().filter((c) => mplus(c) > 0).sort((a, b) => mplus(b) - mplus(a));
  const medal = (i) => ['🥇', '🥈', '🥉'][i] || `<span class="muted">${i + 1}</span>`;

  $app.innerHTML = `
    ${prog ? `<div class="section-title" style="margin-top:0">Progression de la guilde</div>
    <div class="grid">${prog.raids.map((r) => `
      <div class="card"><h3>${esc(r.name)}<small>${esc(r.summary || '—')}</small></h3>
        ${progressBars(r)}
        ${r.rankRealm ? `<p class="small" style="margin:8px 0 0">${r.rankRealm}<sup>e</sup> guilde de ${esc(state.data.guild.realm)}</p>` : ''}
      </div>`).join('')}
    </div>
    <p class="small"><a href="${esc(prog.url)}" target="_blank" rel="noopener">Voir la guilde sur Raider.IO</a></p>` : ''}

    <div class="toolbar" style="margin-top:24px">
      <h2 class="section-title" style="margin:0">Classement Mythique+</h2><span style="flex:1"></span>
      ${filters()}
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Perso</th><th>Spé</th><th>Score M+</th><th>Meilleure clé</th>${raid ? `<th>${esc(raid.name)}</th>` : ''}<th>ilvl</th></tr></thead>
      <tbody id="rows">${list.map((c, i) => {
        const best = c.rio.bestRuns[0];
        return `<tr data-href="${charUrl(c)}">
          <td class="num">${medal(i)}</td>
          <td>${charCell(c)}</td>
          <td>${esc(c.spec ?? '—')}</td>
          <td class="num">${scoreCell(c)}</td>
          <td>${best ? `<b>+${best.level}</b> <span class="small">${esc(best.dungeon)}</span>` : '—'}</td>
          ${raid ? `<td>${esc(c.rio.raids?.[raid.slug]?.summary || '—')}</td>` : ''}
          <td class="num">${c.ilvl}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="7" class="muted">Aucun score M+ cette saison.</td></tr>'}</tbody>
    </table></div>
    <p class="small">Scores de la saison en cours, via Raider.IO (mis à jour à chaque synchro).</p>
    ${parsesTable()}`;
  bindFilters(renderClassement);
  $app.querySelector('#rows').onclick = (e) => { if (e.target.closest('.fav')) return; const tr = e.target.closest('tr[data-href]'); if (tr) location.hash = tr.dataset.href; };
}

function parsesTable() {
  const list = visibleChars().filter((c) => c.wcl?.parses?.best != null).sort((a, b) => b.wcl.parses.best - a.wcl.parses.best);
  if (!list.length) return '';
  const nights = state.raids?.nights?.length || 0;
  return `<h2 class="section-title" style="margin-top:28px">Classement des parses</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Perso</th><th>Spé</th><th>Parse moyen</th><th>Parse médian</th><th>Boss tués</th><th>Présence</th></tr></thead>
      <tbody class="rows">${list.map((c, i) => `<tr data-href="${charUrl(c)}">
        <td class="num">${['🥇', '🥈', '🥉'][i] || `<span class="muted">${i + 1}</span>`}</td>
        <td>${charCell(c)}</td><td>${esc(c.spec ?? '—')}</td>
        <td class="num">${parseCell(c.wcl.parses.best)} <span class="small">${c.wcl.parses.metric === 'hps' ? 'HPS' : 'DPS'}</span></td>
        <td class="num">${parseCell(c.wcl.parses.median)}</td>
        <td class="num">${c.wcl.parses.bosses.length}</td>
        <td class="num">${nights ? `${c.wcl.attendance?.nights || 0}/${nights}` : '—'}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="small">Calculé sur les raids de la guilde des ${state.data.config.semainesWcl || 4} dernières semaines : parse moyen = moyenne du meilleur parse sur chaque boss tué ; médiane = de tous les parses. Soigneurs classés en HPS.</p>`;
}

// ---------- Soirées (Warcraft Logs) ----------
function wclPlaceholder() {
  const st = state.raids?.status;
  const msg = st === 'error' ? 'Warcraft Logs ne répond pas pour le moment (maintenance ?). Les soirées reviendront à la prochaine synchro.'
    : 'Warcraft Logs n’est pas encore connecté. Dès que la clé sera ajoutée, chaque soirée de raid aura sa page avec son Hall of Fame et son Hall of Shame.';
  return `<div class="card"><h3>Soirées de raid</h3><p class="muted" style="margin:0">${msg}</p></div>`;
}

function renderSoirees() {
  const nights = state.raids?.nights || [];
  if (!nights.length) { $app.innerHTML = wclPlaceholder(); return; }
  $app.innerHTML = `
    ${state.raids.mock ? '<p class="pill warn">Données de démonstration</p>' : ''}
    <div class="grid">${nights.map((n) => {
      const mvp = n.fame.find((f) => f.id === 'parse');
      const shame = n.shame.find((f) => f.id === 'floor');
      return `<a class="card night" href="#/soiree/${n.date}" style="text-decoration:none">
        <h3 style="text-transform:capitalize">${esc(fmtDate(n.date))}<small>${n.players.filter((p) => !p.guest).length} de la guilde</small></h3>
        <p class="muted" style="margin:0 0 8px">${esc(n.zone || '')} · ${n.kills.length} boss tués · ${n.wipes} wipe${n.wipes > 1 ? 's' : ''}</p>
        ${mvp ? `<div>🏆 <b>${esc(mvp.name)}</b> <span class="small">${mvp.value}% sur ${esc(mvp.detail || '')}</span></div>` : ''}
        ${shame ? `<div>💀 <b>${esc(shame.name)}</b> <span class="small">${shame.value} morts</span></div>` : ''}
      </a>`;
    }).join('')}</div>`;
}

function hallCards(items, kind) {
  return items.map((a) => {
    const who = a.list ? a.list.map(esc).join(', ') : `<b>${esc(a.name)}</b>`;
    const val = a.list ? `${a.list.length} joueur${a.list.length > 1 ? 's' : ''} sans mourir` : `${kind === 'fame' && a.id !== 'parse' && a.id !== 'kick' && a.id !== 'dispel' ? fmtNum(a.value) : a.value}${a.unit || ''}${a.detail ? ` · ${esc(a.detail)}` : ''}`;
    return `<div class="hall ${kind}"><span class="hall-icon">${a.icon}</span><div><div class="hall-title">${esc(a.title)}</div><div class="hall-who">${who}</div><div class="small">${val}</div></div></div>`;
  }).join('');
}

function renderSoiree(date) {
  const n = state.raids?.nights?.find((x) => x.date === date);
  if (!n) { $app.innerHTML = '<p class="muted">Soirée introuvable. <a href="#/soirees">Retour</a></p>'; return; }
  const byName = new Map(state.data.characters.map((c) => [c.name, c]));
  const players = [...n.players].sort((a, b) => (b.bestParse ?? -1) - (a.bestParse ?? -1));
  $app.innerHTML = `
    <p><a href="#/soirees" class="small">← Toutes les soirées</a></p>
    <div class="toolbar"><div>
      <h2 class="section-title" style="margin:0;text-transform:capitalize">${esc(fmtDate(n.date))}</h2>
      <span class="muted">${esc(n.zone || '')} · ${n.kills.map((k) => esc(k.name)).join(', ') || 'aucun kill'} · ${n.wipes} wipes · ${n.pulls} pulls</span>
    </div><span style="flex:1"></span><a class="btn" href="${esc(n.url)}" target="_blank" rel="noopener">Voir le log</a></div>

    <div class="section-title">🌟 Hall of Fame</div>
    <div class="hall-grid">${hallCards(n.fame, 'fame')}</div>
    <div class="section-title">🙈 Hall of Shame</div>
    <div class="hall-grid">${hallCards(n.shame, 'shame') || '<p class="muted">Rien à signaler, soirée parfaite.</p>'}</div>
    <p class="small">Pour le fun ! Un joueur peut demander à être retiré du Hall of Shame (config.json → wcl.shameOptOut). Sur un wipe, seules les 3 premières morts comptent.</p>

    ${n.killers?.length ? `<div class="section-title">💀 Ce qui nous a tués</div>
    <div class="card"><ul>${n.killers.map((k) => `<li><span>${esc(k.name)}</span><b>${k.count} mort${k.count > 1 ? 's' : ''}</b></li>`).join('')}</ul>
    <p class="small" style="margin:8px 0 0">Coups fataux de la soirée (kills + 3 premières morts de chaque wipe).</p></div>` : ''}

    <div class="section-title">Détail par joueur</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Joueur</th><th>Pulls</th><th>Meilleur parse</th><th>Parse moyen</th><th>DPS / HPS</th><th>Morts</th><th>Souvent tué par</th><th>1er mort</th><th>Interrupts</th><th>Sans flacon</th><th>Sans food</th></tr></thead>
      <tbody class="rows">${players.map((p) => {
        const c = byName.get(p.name);
        return `<tr ${c ? `data-href="${charUrl(c)}"` : ''}>
          <td>${c ? charCell(c) : `<b>${esc(p.name)}</b>`}${p.guest ? ' <span class="pill">invité</span>' : ''}</td>
          <td class="num">${p.pulls}</td>
          <td class="num">${parseCell(p.bestParse)}</td>
          <td class="num">${parseCell(p.avgParse)}</td>
          <td class="num">${p.hps > p.dps ? `${fmtNum(p.hps)} <span class="small">HPS</span>` : p.dps ? fmtNum(p.dps) : '—'}</td>
          <td class="num">${p.deaths}</td><td class="small">${p.topKiller ? `${esc(p.topKiller[0])} ×${p.topKiller[1]}` : ''}</td><td class="num">${p.firstDeaths || ''}</td><td class="num">${p.interrupts || ''}</td>
          <td class="num">${p.noFlask ? `<span style="color:var(--warn)">${p.noFlask}</span>` : ''}</td>
          <td class="num">${p.noFood ? `<span style="color:var(--warn)">${p.noFood}</span>` : ''}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
}

// ---------- Coffre de la semaine ----------
const DIFF_LABEL = { LFR: 'LFR', NORMAL: 'N', HEROIC: 'H', MYTHIC: 'M' };
const DIFF_NAME = { LFR: 'Outil raids', NORMAL: 'Normal', HEROIC: 'Héroïque', MYTHIC: 'Mythique' };

function vaultPips(slots, fmt) {
  return `<span class="pips">${slots.map((v) => `<span class="pip ${v != null ? 'on' : ''}">${v != null ? fmt(v) : '·'}</span>`).join('')}</span>`;
}
const vaultCount = ({ vault: v }) => (v ? v.mplus.slots.filter((x) => x != null).length + v.raid.slots.filter((x) => x != null).length : 0);
const nextReset = (v) => new Date(v.reset + 7 * DAY).toLocaleString('fr-FR', { weekday: 'long', hour: '2-digit', minute: '2-digit' });

function vaultCard(c) {
  const v = c.vault;
  if (!v) return '<p class="muted">Pas de données de coffre.</p>';
  const mp = v.mplus, rd = v.raid;
  return `<div class="vault">
    <div class="vault-row"><span class="vault-label">Donjons M+</span>${vaultPips(mp.slots, (l) => `+${l}`)}
      <span class="small">${mp.runs} clé${mp.runs > 1 ? 's' : ''}${mp.next ? ` · encore ${mp.next - mp.runs} pour le suivant` : ' · complet ✓'}</span></div>
    <div class="vault-row"><span class="vault-label">Raid</span>${vaultPips(rd.slots, (d) => DIFF_LABEL[d])}
      <span class="small">${rd.bosses} boss${rd.next ? ` · encore ${rd.next - rd.bosses} pour le suivant` : ' · complet ✓'}</span></div>
  </div>`;
}

function renderCoffre() {
  const list = visibleChars().filter((c) => c.vault).sort((a, b) => vaultCount(b) - vaultCount(a) || mplus(b) - mplus(a));
  const any = list.find((c) => c.vault);
  const full = list.filter((c) => vaultCount(c) === 6).length;
  $app.innerHTML = `
    <div class="toolbar"><div>
      <h2 class="section-title" style="margin:0">Coffre de la semaine</h2>
      <span class="muted">${any ? `Réinitialisation ${esc(nextReset(any.vault))}` : ''} · ${full} perso${full > 1 ? 's' : ''} avec les 6 emplacements</span>
    </div><span style="flex:1"></span>${filters()}</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Perso</th><th>Donjons M+</th><th>Clés</th><th>Raid</th><th>Boss</th><th>Emplacements</th></tr></thead>
      <tbody class="rows">${list.map((c) => `<tr data-href="${charUrl(c)}">
        <td>${charCell(c)}</td>
        <td>${vaultPips(c.vault.mplus.slots, (l) => `+${l}`)}</td>
        <td class="num">${c.vault.mplus.runs}</td>
        <td>${vaultPips(c.vault.raid.slots, (d) => DIFF_LABEL[d])}</td>
        <td class="num">${c.vault.raid.bosses}</td>
        <td class="num">${vaultCount(c)}/6</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="small">Clés M+ via Raider.IO, boss de raid via l'armurerie Blizzard (mise à jour au logout). Les Gouffres ne sont pas fournis par les API. </p>`;
  bindFilters(renderCoffre);
}

// ---------- Mon perso ----------
const ME_KEY = 'reborn.monPerso';
const getMe = () => { try { return localStorage.getItem(ME_KEY); } catch { return null; } };
const setMe = (v) => { try { v ? localStorage.setItem(ME_KEY, v) : localStorage.removeItem(ME_KEY); } catch { /* navigation privée */ } };
const meId = (c) => `${c.realm}/${c.name.toLowerCase()}`;

// Conseils concrets, du plus important au moins important.
function conseils(c) {
  const out = [];
  if (c.missingEnchants?.length) out.push({ lvl: 'bad', icon: '✦', text: `Pose un enchant sur : <b>${c.missingEnchants.map(esc).join(', ')}</b>` });
  if (c.emptySockets?.length) out.push({ lvl: 'warn', icon: '◆', text: `Sertis une gemme : <b>${groupSlots(c.emptySockets).map(esc).join(', ')}</b>` });
  const v = c.vault;
  if (v?.mplus.next) out.push({ lvl: 'info', icon: '🗝️', text: `Coffre : encore <b>${v.mplus.next - v.mplus.runs} clé${v.mplus.next - v.mplus.runs > 1 ? 's' : ''}</b> pour débloquer l'emplacement M+ suivant.` });
  if (v?.raid.next) out.push({ lvl: 'info', icon: '🐉', text: `Coffre : encore <b>${v.raid.next - v.raid.bosses} boss</b> pour l'emplacement raid suivant.` });
  const items = (c.items || []).filter((i) => i.ilvl);
  if (items.length) {
    const low = [...items].sort((a, b) => a.ilvl - b.ilvl)[0];
    if (low.ilvl <= c.ilvl - 10) out.push({ lvl: 'info', icon: '⬆️', text: `Ta pièce la plus faible : <b>${esc(low.slotName)}</b> (${low.ilvl}, ta moyenne est ${c.ilvl}). À améliorer en priorité.` });
  }
  const p = c.wcl?.parses;
  if (p?.bosses?.length > 1 && p.median != null) {
    const worst = [...p.bosses].sort((a, b) => a.best - b.best)[0];
    if (worst.best < p.median - 15) out.push({ lvl: 'info', icon: '📊', text: `Ton parse sur <b>${esc(worst.name)}</b> (${Math.round(worst.best)}) est loin de ta médiane (${Math.round(p.median)}). Jette un œil aux meilleurs logs de ta spé sur ce boss.` });
  }
  const night = (state.raids?.nights || []).find((n) => n.players.some((x) => x.name === c.name));
  const me = night?.players.find((x) => x.name === c.name);
  if (me) {
    if (me.noFlask) out.push({ lvl: 'warn', icon: '🧪', text: `${esc(fmtDate(night.date))} : pas de flacon sur <b>${me.noFlask} pull${me.noFlask > 1 ? 's' : ''}</b>.` });
    if (me.noFood) out.push({ lvl: 'warn', icon: '🍗', text: `${esc(fmtDate(night.date))} : pas de nourriture sur <b>${me.noFood} pull${me.noFood > 1 ? 's' : ''}</b>.` });
    if (me.topKiller?.[1] >= 2) out.push({ lvl: 'warn', icon: '💀', text: `${esc(fmtDate(night.date))} : tué <b>${me.topKiller[1]} fois par ${esc(me.topKiller[0])}</b>. Renseigne-toi sur cette capacité (souvent évitable).` });
    if (me.firstDeaths >= 2) out.push({ lvl: 'warn', icon: '🪦', text: `${esc(fmtDate(night.date))} : premier mort sur <b>${me.firstDeaths} pulls</b>. Regarde ce qui t'a tué dans le log.` });
  }
  if (c.lastLogin && Date.now() - c.lastLogin > 7 * DAY) out.push({ lvl: 'info', icon: '🕒', text: `Ces infos datent de ta dernière déconnexion (${ago(c.lastLogin)}).` });
  return out;
}

function renderPicker() {
  const chars = [...state.data.characters].sort((a, b) => (a.isMain === false) - (b.isMain === false) || a.name.localeCompare(b.name));
  $app.innerHTML = `<div class="card" style="max-width:560px;margin:0 auto">
      <h3>Qui es-tu ?</h3>
      <p class="muted" style="margin-top:0">Choisis ton perso : le site s'en souviendra sur ce navigateur.</p>
      <div class="toolbar"><input type="search" id="pick" placeholder="Nom de ton perso…" autofocus></div>
      <ul id="picklist" class="picklist"></ul>
    </div>`;
  const draw = (q = '') => {
    const plain = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const list = chars.filter((c) => !q || plain(c.name).includes(plain(q))).slice(0, 30);
    $app.querySelector('#picklist').innerHTML = list.map((c) => `<li><button class="pick" data-id="${esc(meId(c))}">${charCell(c)}<span class="small">${esc(c.spec || '')} · ${c.ilvl}</span></button></li>`).join('') || '<li class="muted">Aucun perso trouvé.</li>';
  };
  draw();
  $app.querySelector('#pick').oninput = (e) => draw(e.target.value);
  $app.querySelector('#picklist').onclick = (e) => {
    const b = e.target.closest('button[data-id]');
    if (b) { setMe(b.dataset.id); renderMoi(); }
  };
}

function renderMoi() {
  const id = getMe();
  const c = id && state.data.characters.find((x) => meId(x) === id);
  if (!c) return renderPicker();
  const tips = conseils(c);
  const account = [c, ...(c.alts || []).map((a) => findChar(a.name, a.realm)).filter(Boolean)].sort((a, b) => b.ilvl - a.ilvl);
  const night = (state.raids?.nights || []).find((n) => n.players.some((x) => x.name === c.name));
  const me = night?.players.find((x) => x.name === c.name);

  $app.innerHTML = `
    <div class="me-head">
      ${c.avatar ? `<img src="${esc(c.avatar)}" alt="">` : ''}
      <div><h2 style="color:${color(c)}">${esc(c.name)}</h2>
        <div class="muted">${esc([c.spec, c.className].filter(Boolean).join(' '))} · <b>${c.ilvl} ilvl</b> · M+ ${scoreCell(c)}${c.wcl?.parses?.best != null ? ` · parse ${parseCell(c.wcl.parses.best)}` : ''}</div></div>
      <span style="flex:1"></span>
      <a class="btn" href="${charUrl(c)}">Fiche complète</a>
      <button class="btn" id="change">Changer de perso</button>
    </div>

    <div class="me-grid">
      <div class="card"><h3>À faire${tips.length ? `<small>${tips.length}</small>` : ''}</h3>
        ${tips.length ? `<ul class="tips">${tips.map((t) => `<li class="tip ${t.lvl}"><span>${t.icon}</span><span>${t.text}</span></li>`).join('')}</ul>`
          : '<p style="margin:0">Rien à signaler, tu es prêt pour le raid 💪</p>'}
      </div>
      <div class="card"><h3>Coffre de la semaine<small>réinit. ${c.vault ? esc(nextReset(c.vault)) : ''}</small></h3>
        ${vaultCard(c)}
        ${c.vault?.raid.kills?.length ? `<p class="small" style="margin:10px 0 0">${c.vault.raid.kills.map((k) => `${esc(k.boss)} <b>${DIFF_LABEL[k.diff]}</b>`).join(' · ')}</p>` : ''}
      </div>
      ${me ? `<div class="card"><h3>Dernier raid<small>${esc(fmtDate(night.date))}</small></h3>
        <p style="margin:0">Meilleur parse ${parseCell(me.bestParse)} · moyen ${parseCell(me.avgParse)} · ${me.deaths} mort${me.deaths > 1 ? 's' : ''} · ${me.interrupts} interrupt${me.interrupts > 1 ? 's' : ''}</p>
        <p style="margin:8px 0 0"><a href="#/soiree/${night.date}">Voir la soirée →</a></p></div>` : ''}
    </div>

    ${account.length > 1 ? `<div class="section-title">Mes persos</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Perso</th><th>ilvl</th><th>M+</th><th>Coffre M+</th><th>Coffre raid</th><th>Stuff</th></tr></thead>
      <tbody class="rows">${account.map((x) => `<tr data-href="${charUrl(x)}">
        <td>${charCell(x)}</td><td class="num">${x.ilvl}</td><td class="num">${scoreCell(x)}</td>
        <td>${x.vault ? vaultPips(x.vault.mplus.slots, (l) => `+${l}`) : '—'}</td>
        <td>${x.vault ? vaultPips(x.vault.raid.slots, (d) => DIFF_LABEL[d]) : '—'}</td>
        <td>${statusPill(x)}</td></tr>`).join('')}</tbody>
    </table></div>` : ''}`;
  $app.querySelector('#change').onclick = () => { setMe(null); renderPicker(); };
}

// ---------- Alertes ----------
function renderAlertes() {
  const list = visibleChars().filter((c) => c.found && issues(c)).sort((a, b) => b.ilvl - a.ilvl);
  $app.innerHTML = `
    <div class="toolbar">
      <div><h2 class="section-title" style="margin:0">Petit check avant le raid</h2>
      <span class="muted">${list.length ? `${list.length} perso${list.length > 1 ? 's' : ''} avec un enchant ou une gemme qui manque, du plus haut ilvl au plus bas.` : ''}</span></div>
      <span style="flex:1"></span>
      ${filters()}
      <button class="btn gold" id="copy">Copier pour Discord</button>
    </div>
    <p class="small">Tu as corrigé ? Déconnecte-toi une fois : l'armurerie Blizzard ne se met à jour qu'au logout, et le site se rafraîchit toutes les 3 heures.</p>
    <div class="grid">${list.map((c) => `
      <a class="card alert-card" href="${charUrl(c)}" style="text-decoration:none">
        <h3>${charCell(c)}<small>${c.ilvl} ilvl</small></h3>
        ${c.missingEnchants.length ? `<div class="missing">Enchant à poser : ${c.missingEnchants.map(esc).join(', ')}</div>` : ''}
        ${c.emptySockets.length ? `<div class="sockets">Gemme à sertir : ${groupSlots(c.emptySockets).map(esc).join(', ')}</div>` : ''}
      </a>`).join('') || '<p class="muted">Tout le monde est enchanté et gemmé. Bon raid ! 🎉</p>'}
    </div>`;
  bindFilters(renderAlertes);
  $app.querySelector('#copy').onclick = async (e) => {
    const url = location.href.split('#')[0] + '#/alertes';
    const text = `✨ **Petit check avant le raid !** Un enchant ou une gemme a peut-être filé entre les doigts ? 👀\n👉 ${url}`;
    try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copié ✓'; }
    catch { e.target.textContent = 'Copie impossible'; }
    setTimeout(() => (e.target.textContent = 'Copier pour Discord'), 2000);
  };
}

// ---------- Métiers ----------
function renderMetiers() {
  const by = {};
  for (const c of visibleChars({ withAlts: true })) for (const p of c.professions || []) (by[p.name] ??= []).push({ c, p });
  const names = Object.keys(by).sort((a, b) => a.localeCompare(b));
  $app.innerHTML = `
    <div class="toolbar"><span class="muted">Métiers principaux, palier Midnight. Les rerolls sont inclus.</span><span style="flex:1"></span>
      ${filters({ mains: false })}</div>
    <div class="grid">${names.map((n) => `
      <div class="card"><h3>${esc(n)}<small>${by[n].length}</small></h3><ul>
        ${by[n].sort((a, b) => b.p.skill - a.p.skill).map(({ c, p }) => `
          <li><span><a href="${charUrl(c)}" style="color:${color(c)}">${esc(c.name)}</a>${c.isMain === false ? ` <span class="small">(${esc(c.main)})</span>` : ''}</span>
          <span class="${p.skill >= p.max ? 'pill ok' : 'small'}">${p.skill}/${p.max}</span></li>`).join('')}
      </ul></div>`).join('')}
    </div>`;
  bindFilters(renderMetiers);
}

// ---------- Fiche perso ----------
const SLOT_ORDER = ['HEAD', 'NECK', 'SHOULDER', 'BACK', 'CHEST', 'WRIST', 'HANDS', 'WAIST', 'LEGS', 'FEET', 'FINGER_1', 'FINGER_2', 'TRINKET_1', 'TRINKET_2', 'MAIN_HAND', 'OFF_HAND'];

function itemLink(i) {
  const params = [`bonus=${i.bonus.join(':')}`, `ilvl=${i.ilvl}`];
  if (i.enchants[0]) params.push(`ench=${i.enchants[0].id}`);
  const gems = i.sockets.map((s) => s.gem).filter(Boolean);
  if (gems.length) params.push(`gems=${gems.join(':')}`);
  return `<a class="iname q-${i.quality}" href="https://www.wowhead.com/fr/item=${i.id}" data-wowhead="${params.join('&amp;')}&amp;domain=fr" target="_blank" rel="noopener">${esc(i.name)}</a>`;
}

function renderPerso(realm, name) {
  const c = state.data.characters.find((x) => x.realm === realm && x.name.toLowerCase() === decodeURIComponent(name));
  if (!c) { $app.innerHTML = '<p class="muted">Perso introuvable. <a href="#/">Retour</a></p>'; return; }
  const slug = `${c.realm}/${encodeURIComponent(c.name.toLowerCase())}`;
  const missing = new Set(c.missingEnchants);
  const items = [...(c.items || [])].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));

  $app.innerHTML = `
    <p><a href="#/" class="small">← Retour aux membres</a></p>
    <div class="profile">
      <div class="portrait">${c.render ? `<img src="${esc(c.render)}" alt="${esc(c.name)}">` : ''}</div>
      <div>
        <h2 style="color:${color(c)}">${favButton(c)} ${esc(c.name)}</h2>
        <div class="meta">${c.raider ? '<span class="pill raid">⚔ Roster raid</span> ' : ''}${esc([c.race, c.className, c.spec, c.hero].filter(Boolean).join(' · '))}<br>
          ${esc(rankName(c.rank))} · niv. ${c.level} · <b>${c.ilvl} ilvl</b> · vu ${ago(c.lastLogin)}</div>
        <div class="links">
          <a class="btn" target="_blank" rel="noopener" href="https://worldofwarcraft.blizzard.com/fr-fr/character/eu/${slug}">Armurerie</a>
          <a class="btn" target="_blank" rel="noopener" href="https://www.warcraftlogs.com/character/eu/${slug}">Warcraft Logs</a>
          <a class="btn" target="_blank" rel="noopener" href="${esc(c.rio?.url || `https://raider.io/characters/eu/${slug}`)}">Raider.IO</a>
          <button class="btn ${getMe() === meId(c) ? 'gold' : ''}" id="its-me">${getMe() === meId(c) ? '★ Mon perso' : "C'est moi"}</button>
        </div>
        <div>${statusPill(c)}</div>

        <div class="section-title">Talents</div>
        ${c.talentCode ? `<div class="code" id="tcode">${esc(c.talentCode)}</div>
          <div class="links" style="margin-top:8px">
            <button class="btn" id="copy-talents">Copier le code</button>
            <a class="btn" target="_blank" rel="noopener" href="https://www.wowhead.com/fr/talent-calc/blizzard/${esc(c.talentCode)}">Voir sur Wowhead</a>
          </div>` : '<p class="muted">Pas de talents disponibles.</p>'}

        ${c.rio ? `<div class="section-title">Mythique+ & raid</div>
        <p>Score M+ : ${scoreCell(c)}${(state.data.raids || []).map((r) => c.rio.raids?.[r.slug]?.summary ? ` · ${esc(r.name)} <b>${esc(c.rio.raids[r.slug].summary)}</b>` : '').join('')}</p>
        ${c.rio.bestRuns.length ? `<div class="runs">${c.rio.bestRuns.map((r) => `<span class="run" title="${esc(r.dungeon)}"><b>+${r.level}</b>${'★'.repeat(r.upgrades)} ${esc(r.short)}</span>`).join('')}</div>` : ''}` : ''}

        ${c.vault ? `<div class="section-title">Coffre de la semaine</div>${vaultCard(c)}` : ''}

        ${c.wcl?.parses ? `<div class="section-title">Warcraft Logs</div>
        <p>Parse moyen ${parseCell(c.wcl.parses.best)} <span class="small">${c.wcl.parses.metric === 'hps' ? 'HPS' : 'DPS'}</span> · médian ${parseCell(c.wcl.parses.median)}${c.wcl.attendance ? ` · ${c.wcl.attendance.nights} soirée${c.wcl.attendance.nights > 1 ? 's' : ''} de raid loggée${c.wcl.attendance.nights > 1 ? 's' : ''}` : ''}</p>
        <div class="runs">${c.wcl.parses.bosses.map((b) => `<span class="run">${parseCell(b.best)} ${esc(b.name)}</span>`).join('')}</div>` : ''}

        ${c.alts?.length ? `<div class="section-title">${c.isMain ? 'Rerolls' : `Compte de ${esc(c.main)}`}</div>
        <p>${[...c.alts].sort((a, b) => (findChar(b.name, b.realm)?.ilvl || 0) - (findChar(a.name, a.realm)?.ilvl || 0) || b.level - a.level).map((a) => {
          const d = findChar(a.name, a.realm);
          const label = `<span style="color:${CLASS_COLORS[a.classId] || '#ccc'}">${esc(a.name)}</span> <span class="small">niv. ${a.level}${d?.ilvl ? ` · ${d.ilvl}` : ''}${d?.isMain ? ' · main' : ''}</span>`;
          return d ? `<a href="${charUrl(d)}" style="text-decoration:none">${label}</a>` : label;
        }).join(' · ')}</p>
        <p class="small">Regroupement automatique par collection de mascottes (commune à tout le compte). Une erreur ? Corrige-la dans <code>config.json</code>.</p>` : ''}

        <div class="section-title">Métiers</div>
        <p>${(c.professions || []).map((p) => `${esc(p.name)} <span class="small">${p.skill}/${p.max}</span>`).join(' · ') || '<span class="muted">Aucun</span>'}
        ${c.cooking ? ` · Cuisine <span class="small">${c.cooking.skill}/${c.cooking.max}</span>` : ''}</p>
      </div>
    </div>

    <div class="section-title">Équipement</div>
    <div class="gear">${items.map((i) => {
      const needs = missing.has(i.slotName);
      return `<div class="slot ${needs || i.sockets.some((s) => !s.gem) ? 'flag' : ''}">
        <span class="sname">${esc(i.slotName)}</span>
        <span class="ilvl q-${i.quality}">${i.ilvl}</span>
        ${itemLink(i)}
        ${i.enchants.map((e) => `<span class="ench">✦ ${esc(e.name)}</span>`).join('')}
        ${needs ? '<span class="ench none">✖ Enchantement manquant</span>' : ''}
        ${i.sockets.map((s) => s.gem ? `<span class="gem">◆ ${esc(s.gemName)}</span>` : '<span class="gem none">◇ Châsse vide</span>').join('')}
      </div>`;
    }).join('')}</div>`;

  document.getElementById('its-me').onclick = () => { setMe(meId(c)); location.hash = '#/moi'; };
  const btn = document.getElementById('copy-talents');
  if (btn) btn.onclick = async () => {
    try { await navigator.clipboard.writeText(c.talentCode); btn.textContent = 'Copié ✓'; } catch { btn.textContent = 'Copie impossible'; }
  };
  window.$WowheadPower?.refreshLinks?.();
}

// Clic sur une ligne de tableau → fiche du perso.
document.addEventListener('click', (e) => {
  const tr = e.target.closest('tbody.rows tr[data-href]');
  if (tr && !e.target.closest('a')) location.hash = tr.dataset.href;
});

// ---------- Routage ----------
function route(opts = {}) {
  if (!state.data) return;
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const tab = parts[0] || 'membres';
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === (tab === 'soiree' ? 'soirees' : tab)));
  if (!opts.keepScroll) window.scrollTo(0, 0);
  if (tab === 'alertes') renderAlertes();
  else if (tab === 'classement') renderClassement();
  else if (tab === 'coffre') renderCoffre();
  else if (tab === 'moi') renderMoi();
  else if (tab === 'soirees') renderSoirees();
  else if (tab === 'soiree') renderSoiree(parts[1]);
  else if (tab === 'metiers') renderMetiers();
  else if (tab === 'perso') renderPerso(parts[1], parts[2]);
  else renderMembres();
}

window.addEventListener('hashchange', route);
fetch('data/guild.json', { cache: 'no-cache' })
  .then((r) => r.json())
  .then(async (d) => {
    state.data = d;
    // Les soirées sont dans un fichier à part ; le site fonctionne sans.
    state.raids = await fetch('data/raids.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    renderKpis();
    route();
  })
  .catch(() => { $app.innerHTML = '<p class="muted">Données introuvables. Lance <code>node scripts/sync.mjs</code>.</p>'; });
