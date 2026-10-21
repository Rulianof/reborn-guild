const CLASS_COLORS = {
  1: '#C69B6D', 2: '#F48CBA', 3: '#AAD372', 4: '#FFF468', 5: '#FFFFFF', 6: '#C41E3A', 7: '#0070DD',
  8: '#3FC7EB', 9: '#8788EE', 10: '#00FF98', 11: '#FF7C0A', 12: '#A330C9', 13: '#33937F',
};
const DAY = 86400000;

const state = { data: null, sort: { key: 'ilvl', dir: -1 }, q: '', cls: '', rank: '', inactifs: false };
const $app = document.getElementById('app');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const color = (c) => CLASS_COLORS[c.classId] || '#ccc';
const isActive = (c) => c.lastLogin && Date.now() - c.lastLogin < state.data.config.joursInactif * DAY;
const rankName = (r) => state.data.config.rangs[r] ?? `Rang ${r}`;
const issues = (c) => (c.missingEnchants?.length || 0) + (c.emptySockets?.length || 0);
const groupSlots = (list) => Object.entries(list.reduce((m, s) => ((m[s] = (m[s] || 0) + 1), m), {})).map(([s, n]) => (n > 1 ? `${s} ×${n}` : s));
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
    <div><b style="color:${color(c)}">${esc(c.name)}</b>${c.realm !== 'hyjal' ? `<div class="small">${esc(c.realm)}</div>` : ''}</div></div>`;
}

function visibleChars() {
  return state.data.characters.filter((c) => state.inactifs || isActive(c));
}

function renderKpis() {
  const d = state.data;
  const active = d.characters.filter(isActive);
  const avg = active.length ? Math.round(active.reduce((s, c) => s + (c.ilvl || 0), 0) / active.length) : 0;
  const clean = active.filter((c) => c.found && !issues(c)).length;
  document.getElementById('kpis').innerHTML = [
    [d.guild.memberCount, 'membres'],
    [active.length, `actifs niv. ${d.config.niveauMin}`],
    [avg, 'ilvl moyen'],
    [`${active.length ? Math.round((100 * clean) / active.length) : 0} %`, 'stuff complet'],
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
      <label><input type="checkbox" id="inactifs" ${state.inactifs ? 'checked' : ''}> Inclure les inactifs (+${state.data.config.joursInactif} j)</label>
    </div>
    <div class="table-wrap"><table>
      <thead><tr>
        ${[['name', 'Perso'], ['spec', 'Spé'], ['ilvl', 'ilvl'], ['rank', 'Rang'], ['prof', 'Métiers'], ['issues', 'État'], ['lastLogin', 'Vu']]
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
      name: (c) => c.name, spec: (c) => c.spec || '', ilvl: (c) => c.ilvl || 0, rank: (c) => c.rank,
      prof: (c) => c.professions?.map((p) => p.name).join() || '', issues: issues, lastLogin: (c) => c.lastLogin || 0,
    }[state.sort.key];
    list.sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * state.sort.dir; });
    document.getElementById('rows').innerHTML = list.map((c) => `
      <tr data-href="${charUrl(c)}" class="${isActive(c) ? '' : 'inactive'}">
        <td>${charCell(c)}</td>
        <td>${esc(c.spec ?? '—')}${c.hero ? `<div class="small">${esc(c.hero)}</div>` : ''}</td>
        <td class="num">${c.ilvl || '—'}</td>
        <td>${esc(rankName(c.rank))}</td>
        <td class="small">${(c.professions || []).map((p) => esc(p.name)).join(' · ') || '—'}</td>
        <td>${statusPill(c)}</td>
        <td class="small">${ago(c.lastLogin)}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">Aucun perso.</td></tr>';
  };
  draw();

  $app.querySelector('#q').oninput = (e) => { state.q = e.target.value; draw(); };
  $app.querySelector('#cls').onchange = (e) => { state.cls = e.target.value; draw(); };
  $app.querySelector('#rank').onchange = (e) => { state.rank = e.target.value; draw(); };
  $app.querySelector('#inactifs').onchange = (e) => { state.inactifs = e.target.checked; draw(); };
  $app.querySelectorAll('th').forEach((th) => th.onclick = () => {
    const k = th.dataset.k;
    state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (k === 'name' || k === 'rank' ? 1 : -1) };
    renderMembres();
  });
  $app.querySelector('#rows').onclick = (e) => { const tr = e.target.closest('tr[data-href]'); if (tr) location.hash = tr.dataset.href; };
}

// ---------- Alertes ----------
function renderAlertes() {
  const list = visibleChars().filter((c) => c.found && issues(c)).sort((a, b) => issues(b) - issues(a) || b.ilvl - a.ilvl);
  $app.innerHTML = `
    <div class="toolbar">
      <span class="muted">${list.length} perso${list.length > 1 ? 's' : ''} avec un enchantement ou une gemme manquante${state.inactifs ? '' : ' (actifs uniquement)'}.</span>
      <span style="flex:1"></span>
      <label><input type="checkbox" id="inactifs" ${state.inactifs ? 'checked' : ''}> Inclure les inactifs</label>
      <button class="btn gold" id="copy">Copier pour Discord</button>
    </div>
    <p class="small">⚠ L'armurerie Blizzard ne se met à jour qu'à la déconnexion : un enchant posé en jeu apparaît après un relog et la prochaine synchro.</p>
    <div class="grid">${list.map((c) => `
      <a class="card alert-card" href="${charUrl(c)}" style="text-decoration:none">
        <h3>${charCell(c)}<small>${c.ilvl} ilvl</small></h3>
        ${c.missingEnchants.length ? `<div class="missing">Sans enchant : ${c.missingEnchants.map(esc).join(', ')}</div>` : ''}
        ${c.emptySockets.length ? `<div class="sockets">Châsse vide : ${groupSlots(c.emptySockets).map(esc).join(', ')}</div>` : ''}
      </a>`).join('') || '<p class="muted">Tout le monde est enchanté. Incroyable.</p>'}
    </div>`;
  $app.querySelector('#inactifs').onchange = (e) => { state.inactifs = e.target.checked; renderAlertes(); };
  $app.querySelector('#copy').onclick = async (e) => {
    const lines = list.map((c) => `• **${c.name}** — ${[
      c.missingEnchants.length && `enchant : ${c.missingEnchants.join(', ')}`,
      c.emptySockets.length && `gemme : ${groupSlots(c.emptySockets).join(', ')}`,
    ].filter(Boolean).join(' | ')}`);
    const text = `🔮 **Rappel enchants & gemmes** (${list.length})\n${lines.join('\n')}`;
    try { await navigator.clipboard.writeText(text.slice(0, 1990)); e.target.textContent = 'Copié ✓'; }
    catch { e.target.textContent = 'Copie impossible'; }
    setTimeout(() => (e.target.textContent = 'Copier pour Discord'), 2000);
  };
}

// ---------- Métiers ----------
function renderMetiers() {
  const by = {};
  for (const c of visibleChars()) for (const p of c.professions || []) (by[p.name] ??= []).push({ c, p });
  const names = Object.keys(by).sort((a, b) => a.localeCompare(b));
  $app.innerHTML = `
    <div class="toolbar"><span class="muted">Métiers principaux, palier Midnight.</span><span style="flex:1"></span>
      <label><input type="checkbox" id="inactifs" ${state.inactifs ? 'checked' : ''}> Inclure les inactifs</label></div>
    <div class="grid">${names.map((n) => `
      <div class="card"><h3>${esc(n)}<small>${by[n].length}</small></h3><ul>
        ${by[n].sort((a, b) => b.p.skill - a.p.skill).map(({ c, p }) => `
          <li><a href="${charUrl(c)}" style="color:${color(c)}">${esc(c.name)}</a>
          <span class="${p.skill >= p.max ? 'pill ok' : 'small'}">${p.skill}/${p.max}</span></li>`).join('')}
      </ul></div>`).join('')}
    </div>`;
  $app.querySelector('#inactifs').onchange = (e) => { state.inactifs = e.target.checked; renderMetiers(); };
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
          <a class="btn" target="_blank" rel="noopener" href="https://raider.io/characters/eu/${slug}">Raider.IO</a>
        </div>
        <div>${statusPill(c)}</div>

        <div class="section-title">Talents</div>
        ${c.talentCode ? `<div class="code" id="tcode">${esc(c.talentCode)}</div>
          <div class="links" style="margin-top:8px">
            <button class="btn" id="copy-talents">Copier le code</button>
            <a class="btn" target="_blank" rel="noopener" href="https://www.wowhead.com/fr/talent-calc/blizzard/${esc(c.talentCode)}">Voir sur Wowhead</a>
          </div>` : '<p class="muted">Pas de talents disponibles.</p>'}

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

// ---------- Routage ----------
function route() {
  if (!state.data) return;
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const tab = parts[0] || 'membres';
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  window.scrollTo(0, 0);
  if (tab === 'alertes') renderAlertes();
  else if (tab === 'metiers') renderMetiers();
  else if (tab === 'perso') renderPerso(parts[1], parts[2]);
  else renderMembres();
}

window.addEventListener('hashchange', route);
fetch('data/guild.json', { cache: 'no-cache' })
  .then((r) => r.json())
  .then((d) => { state.data = d; renderKpis(); route(); })
  .catch(() => { $app.innerHTML = '<p class="muted">Données introuvables. Lance <code>node scripts/sync.mjs</code>.</p>'; });
