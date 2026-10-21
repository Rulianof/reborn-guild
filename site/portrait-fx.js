// Portrait animé de la fiche perso : respiration, effet de profondeur au survol, et une action au clic
// (attaque, soin ou emote, selon la classe et la spé). Pour désactiver : retirer portrait-fx.js et
// portrait-fx.css de index.html.
(() => {
  const HEALERS = ['Restauration', 'Sacré', 'Discipline', 'Tisse-brume', 'Préservation'];

  // Effet d'attaque par classe : « slash » pour le corps à corps, sinon un projectile.
  const ATTACKS = {
    1: { type: 'slash', label: 'Frappe héroïque' },
    2: { type: 'slash', label: 'Jugement', glyph: '✦' },
    3: { type: 'bolt', glyph: '➶', label: 'Tir des arcanes' },
    4: { type: 'slash', label: 'Éviscération', double: true },
    5: { type: 'bolt', glyph: '✹', label: 'Mot de l’ombre : Douleur' },
    6: { type: 'slash', label: 'Frappe de mort' },
    7: { type: 'bolt', glyph: '⚡', label: 'Éclair' },
    8: { type: 'bolt', glyph: '🔥', label: 'Boule de feu' },
    9: { type: 'bolt', glyph: '☄', label: 'Trait de l’ombre' },
    10: { type: 'slash', label: 'Paume du tigre', double: true },
    11: { type: 'slash', label: 'Lambeau' },
    12: { type: 'slash', label: 'Lame du chaos', double: true },
    13: { type: 'bolt', glyph: '🐉', label: 'Souffle de feu' },
  };
  const EMOTES = ['/flex 💪', '/danse 💃', '/rire 😂', '/salut 👋', '/applaudir 👏', '/charge ⚔️', '/train 🚂'];

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} M` : `${Math.round(n / 1e3)} k`);

  function spawn(root, cls, html, style = {}) {
    const el = document.createElement('div');
    el.className = cls;
    el.innerHTML = html;
    Object.assign(el.style, style);
    root.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 2500);
    return el;
  }

  function floatNumber(root, text, kind) {
    spawn(root, `pfx-num ${kind}`, text, { left: `${rand(30, 60)}%`, top: `${rand(22, 40)}%` });
  }

  function attack(root, c) {
    const a = ATTACKS[c.classId] || { type: 'slash', label: 'Attaque' };
    root.classList.remove('pfx-lunge');
    void root.offsetWidth; // relance l'animation
    root.classList.add('pfx-lunge');
    if (a.type === 'slash') {
      spawn(root, 'pfx-slash', '');
      if (a.double) setTimeout(() => spawn(root, 'pfx-slash pfx-slash-2', ''), 140);
      if (a.glyph) spawn(root, 'pfx-burst', a.glyph);
    } else {
      spawn(root, 'pfx-bolt', a.glyph);
      setTimeout(() => spawn(root, 'pfx-burst', a.glyph), 380);
    }
    if (!reduced) setTimeout(() => { root.classList.remove('pfx-shake'); void root.offsetWidth; root.classList.add('pfx-shake'); }, a.type === 'bolt' ? 380 : 120);
    const crit = Math.random() < 0.3;
    const amount = rand(250e3, 900e3) * (crit ? 2 : 1) * Math.max(0.6, (c.ilvl || 300) / 300);
    setTimeout(() => floatNumber(root, `${fmt(amount)}${crit ? ' crit !' : ''}`, crit ? 'crit' : 'dmg'), a.type === 'bolt' ? 400 : 150);
    spawn(root, 'pfx-spell', a.label);
  }

  function heal(root, c) {
    spawn(root, 'pfx-heal', '');
    for (let i = 0; i < 3; i++) {
      setTimeout(() => floatNumber(root, `+${fmt(rand(150e3, 600e3) * Math.max(0.6, (c.ilvl || 300) / 300))}`, 'heal'), i * 180);
    }
    spawn(root, 'pfx-spell', 'Soin');
  }

  function emote(root) {
    spawn(root, 'pfx-bubble', pick(EMOTES));
    root.classList.remove('pfx-hop');
    void root.offsetWidth;
    root.classList.add('pfx-hop');
  }

  function attach(root, c) {
    if (!root || !root.querySelector('img')) return;
    root.classList.add('pfx');
    root.style.setProperty('--pfx-color', c.classColor || 'var(--gold)');
    spawn(root, 'pfx-hint', 'Clique sur le perso !');

    if (!reduced) {
      root.addEventListener('pointermove', (e) => {
        const r = root.getBoundingClientRect();
        root.style.setProperty('--rx', `${((e.clientY - r.top) / r.height - 0.5) * -6}deg`);
        root.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 8}deg`);
      });
      root.addEventListener('pointerleave', () => { root.style.setProperty('--rx', '0deg'); root.style.setProperty('--ry', '0deg'); });
    }

    root.addEventListener('click', () => {
      const healer = HEALERS.includes(c.spec);
      const roll = Math.random();
      if (roll < 0.25) emote(root);
      else if (healer && roll < 0.75) heal(root, c);
      else attack(root, c);
    });
  }

  window.PortraitFX = { attach };
})();
