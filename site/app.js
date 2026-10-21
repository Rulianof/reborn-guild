const CLASS_COLORS = {
  1: '#C69B6D', 2: '#F48CBA', 3: '#AAD372', 4: '#FFF468', 5: '#FFFFFF', 6: '#C41E3A', 7: '#0070DD',
  8: '#3FC7EB', 9: '#8788EE', 10: '#00FF98', 11: '#FF7C0A', 12: '#A330C9', 13: '#33937F',
};
const DAY = 86400000;

const state = { data: null, raids: null, sort: { key: 'ilvl', dir: -1 }, q: '', cls: '', rank: '', inactifs: false, mainsOnly: true };
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
  return `<div class="char">${c.avatar ? `<img src="${esc(c.avatar)}" alt="" loading="lazy">` : ''}
    <div><b style="color:${color(c)}">${esc(c.name)}</b> ${altsChip(c)}${c.realm !== 'hyjal' ? `<div class="small">${esc(c.realm)}</div>` : ''}${rerollTag(c)}</div></div>`;
}

function visibleChars({ withAlts = false } = {}) {
  return state.data.characters
    .filter((c) => state.inactifs || isActive(c))
    .filter((c) => withAlts || !state.mainsOnly || c.isMain !== false);
}

const findChar = (name, realm) => state.data.characters.find((x) => x.name === name && (!realm || x.realm === realm));
const altsChip = (c) => (c.isMain && c.alts?.length ? `<span class="pill" title="${esc(c.alts.map((a) => a.name).join(', '))}">+${c.alts.length} reroll${c.alts.length > 1 ? 's' : ''}</span>` : '');
const rerollTag = (c) => (c.isMain === false ? `<div class="small">reroll de ${esc(c.main)}</div>` : '');

function filters({ mains = true } = {}) {
  return `${mains ? `<label><input type="checkbox" id="mainsOnly" ${state.mainsOnly ? 'checked' : ''}> Mains uniquement</label>` : ''}
    <label><input type="checkbox" id="inactifs" ${state.inactifs ? 'checked' : ''}> Inclure les inactifs (+${state.data.config.joursInactif} j)</label>`;
}
function bindFilters(redraw) {
  const m = $app.querySelector('#mainsOnly'), i = $app.querySelector('#inactifs');
  if (m) m.onchange = (e) => { state.mainsOnly = e.target.checked; redraw(); };
  if (i) i.onchange = (e) => { state.inactifs = e.target.checked; redraw(); };
}

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
  $app.querySelector('#rows').onclick = (e) => { const tr = e.target.closest('tr[data-href]'); if (tr) location.hash = tr.dataset.href; };
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
  $app.querySelector('#rows').onclick = (e) => { const tr = e.target.closest('tr[data-href]'); if (tr) location.hash = tr.dataset.href; };
}

function parsesTable() {
  const list = visibleChars().filter((c) => c.wcl?.parses?.best != null).sort((a, b) => b.wcl.parses.best - a.wcl.parses.best);
  if (!list.length) return '';
  const nights = state.raids?.nights?.length || 0;
  return `<h2 class="section-title" style="margin-top:28px">Classement des parses</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Perso</th><th>Spé</th><th>Parse moyen (meilleurs)</th><th>Parse médian</th><th>Boss loggés</th><th>Présence</th></tr></thead>
      <tbody class="rows">${list.map((c, i) => `<tr data-href="${charUrl(c)}">
        <td class="num">${['🥇', '🥈', '🥉'][i] || `<span class="muted">${i + 1}</span>`}</td>
        <td>${charCell(c)}</td><td>${esc(c.spec ?? '—')}</td>
        <td class="num">${parseCell(c.wcl.parses.best)}</td>
        <td class="num">${parseCell(c.wcl.parses.median)}</td>
        <td class="num">${c.wcl.parses.bosses.length}</td>
        <td class="num">${nights ? `${c.wcl.attendance?.nights || 0}/${nights}` : '—'}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="small">Parses Warcraft Logs de la zone en cours. Présence : soirées de raid loggées sur les ${state.data.config.semainesWcl || 4} dernières semaines.</p>`;
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
        <h3 style="text-transform:capitalize">${esc(fmtDate(n.date))}<small>${n.players.length} joueurs</small></h3>
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
    <p class="small">Pour le fun ! Un joueur peut demander à être retiré du Hall of Shame (config.json → wcl.shameOptOut).</p>

    <div class="section-title">Détail par joueur</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Joueur</th><th>Pulls</th><th>Meilleur parse</th><th>Parse moyen</th><th>DPS / HPS</th><th>Morts</th><th>1er mort</th><th>Interrupts</th><th>Sans flacon</th><th>Sans food</th></tr></thead>
      <tbody class="rows">${players.map((p) => {
        const c = byName.get(p.name);
        return `<tr ${c ? `data-href="${charUrl(c)}"` : ''}>
          <td>${c ? charCell(c) : `<b>${esc(p.name)}</b>`}</td>
          <td class="num">${p.pulls}</td>
          <td class="num">${parseCell(p.bestParse)}</td>
          <td class="num">${parseCell(p.avgParse)}</td>
          <td class="num">${p.hps > p.dps ? `${fmtNum(p.hps)} <span class="small">HPS</span>` : p.dps ? fmtNum(p.dps) : '—'}</td>
          <td class="num">${p.deaths}</td><td class="num">${p.firstDeaths || ''}</td><td class="num">${p.interrupts || ''}</td>
          <td class="num">${p.noFlask ? `<span style="color:var(--warn)">${p.noFlask}</span>` : ''}</td>
          <td class="num">${p.noFood ? `<span style="color:var(--warn)">${p.noFood}</span>` : ''}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
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
        <h2 style="color:${color(c)}">${esc(c.name)}</h2>
        <div class="meta">${esc([c.race, c.className, c.spec, c.hero].filter(Boolean).join(' · '))}<br>
          ${esc(rankName(c.rank))} · niv. ${c.level} · <b>${c.ilvl} ilvl</b> · vu ${ago(c.lastLogin)}</div>
        <div class="links">
          <a class="btn" target="_blank" rel="noopener" href="https://worldofwarcraft.blizzard.com/fr-fr/character/eu/${slug}">Armurerie</a>
          <a class="btn" target="_blank" rel="noopener" href="https://www.warcraftlogs.com/character/eu/${slug}">Warcraft Logs</a>
          <a class="btn" target="_blank" rel="noopener" href="${esc(c.rio?.url || `https://raider.io/characters/eu/${slug}`)}">Raider.IO</a>
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

        ${c.wcl?.parses ? `<div class="section-title">Warcraft Logs</div>
        <p>Parse moyen ${parseCell(c.wcl.parses.best)} · médian ${parseCell(c.wcl.parses.median)}${c.wcl.attendance ? ` · ${c.wcl.attendance.nights} soirée${c.wcl.attendance.nights > 1 ? 's' : ''} de raid loggée${c.wcl.attendance.nights > 1 ? 's' : ''}` : ''}</p>
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
function route() {
  if (!state.data) return;
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const tab = parts[0] || 'membres';
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === (tab === 'soiree' ? 'soirees' : tab)));
  window.scrollTo(0, 0);
  if (tab === 'alertes') renderAlertes();
  else if (tab === 'classement') renderClassement();
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
