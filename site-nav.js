// Shared header for every page: Vahnim logo, four sections, and a sub-menu for the section you are in.
// Edit SECTIONS / EXPLAIN to change all pages at once. Pages shown inside another page (iframes) get no header.
(function () {
  'use strict';
  const root = document.documentElement;
  if (window.top !== window) { root.classList.add('embed'); return; }
  const HOME = 'index.html';
  const SECTIONS = [
    { id: 'home', label: 'Home', href: HOME, pages: [HOME] },
    { id: 'demo', label: 'Ground-N1 demo', href: 'n1.html', pages: [['n1.html', 'Launcher'], ['n1-pilot.html', 'Pilot'], ['n1-ground.html', 'Ground control'], ['n1-live.html', 'Live view'], ['n1-wall.html', 'Demo wall']] },
    { id: 'explore', label: 'Explore', href: 'explore.html', pages: [['explore.html', 'Overview'], ['comms.html', 'Guided encounter'], ['hangar.html', 'Aircraft'], ['smart-pad.html', 'Smart pad'], ['coordination-lab.html', 'Integration lab']], alias: ['comms-classic.html'] }
  ];
  const GUIDE = 'docs/Vahnim-Simulation-User-Manual.pdf';
  const EXPLAIN = {
    'index.html': 'The home page: a live city with five landing pads. Air taxis and drones fly out, hover over a site, return, land and charge. Use the sliders to add aircraft or change how busy it is.',
    'n1.html': 'The control room for the demo. Choose a story, then press Start. The pilot\'s screen, the ground team\'s screen and a 3D view open together.',
    'n1-pilot.html': 'You are the pilot of one air taxi. Press the glowing button at each step. The ground computer answers by itself and every message is checked.',
    'n1-ground.html': 'You are the ground team. The computer handles most things, but you can close a pad, add wind or step in. The decisions log shows why it did what it did.',
    'n1-live.html': 'A live 3D camera over the landing area. Green pads are free, blue reserved, amber occupied, red blocked. The camera follows the action; press 1 to 6 to change it, H for a clean view.',
    'n1-wall.html': 'All three screens on one display, sharing one simulation.',
    'explore.html': 'A menu of everything else you can try, each explained in plain language.',
    'comms.html': 'A guided practice landing. The coach says what is happening and what to press next. Use the buttons underneath to cause a problem.',
    'hangar.html': 'A close-up viewer for the two aircraft designs. Drag to look around and pick how it flies.',
    'smart-pad.html': 'A landing pad is more than concrete. Click any part to learn what a smart pad adds: lights, sensors, power and a radio link.',
    'coordination-lab.html': 'A workshop for harder cases between aircraft and ground: visitors, unknown aircraft, expired offers and lost links.'
  };
  const here = (location.pathname.split('/').pop() || HOME).toLowerCase();
  const has = (s, f) => s.pages.some(p => (Array.isArray(p) ? p[0] : p) === f) || (s.alias || []).includes(f);
  const section = SECTIONS.find(s => has(s, here)) || SECTIONS[0];

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const header = el('header'); header.id = 'site-header';
  const main = el('div', 'row main');
  const logo = el('a', 'logo'); logo.href = HOME; logo.setAttribute('aria-label', 'Vahnim, home'); logo.append(el('span', 'logo-img'));
  const nav = el('nav', 'primary'); nav.setAttribute('aria-label', 'Sections');
  for (const s of SECTIONS) { const a = el('a', '', s.label); a.href = s.href; if (s.id === section.id) a.setAttribute('aria-current', 'true'); nav.append(a); }
  const guide = el('a', '', 'Guide ↗'); guide.href = GUIDE; guide.target = '_blank'; guide.rel = 'noopener'; guide.title = 'Open the user manual (PDF)'; nav.append(guide);
  main.append(logo, nav);
  const spacer = el('span', 'spacer'); main.append(spacer);
  header.append(main);

  let navh = 56;
  if (section.pages.length > 1) {
    const sub = el('nav', 'row sub'); sub.setAttribute('aria-label', section.label);
    for (const [href, label] of section.pages) { const a = el('a', '', label); a.href = href; if (href === here) a.setAttribute('aria-current', 'page'); sub.append(a); }
    header.append(sub); navh = 92;
  }
  root.style.setProperty('--navh', navh + 'px');

  const text = EXPLAIN[here];
  if (text) {
    const help = el('button', 'help', 'Help'); help.type = 'button'; help.setAttribute('aria-expanded', 'false'); help.setAttribute('aria-controls', 'site-explain'); main.append(help);
    const card = el('div'); card.id = 'site-explain'; card.hidden = true; card.setAttribute('role', 'note');
    const p = el('p', '', text), close = el('button', '', 'Got it'); close.type = 'button'; card.append(el('b', '', 'In simple words'), p, close);
    const key = 'vahnim-help-' + here; let seen = false;
    try { seen = !!localStorage.getItem(key); } catch (e) { /* storage may be blocked */ }
    const set = open => { card.hidden = !open; help.setAttribute('aria-expanded', String(open)); help.classList.remove('pulse'); if (!open) { try { localStorage.setItem(key, '1'); } catch (e) { /* ignore */ } } };
    help.onclick = () => set(card.hidden); close.onclick = () => set(false);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !card.hidden) set(false); });
    if (!seen) help.classList.add('pulse');
    document.body.append(card);
  }

  document.body.classList.add('has-site-nav');
  document.body.prepend(header);
  const skip = el('a', 'skip', 'Skip to content'); skip.href = '#main'; document.body.prepend(skip);
  if (!document.getElementById('main')) { const m = document.querySelector('main') || document.body.children[2]; if (m && !m.id) m.id = 'main'; }
  // Favicon and theme colour for every page.
  if (!document.querySelector('link[rel~="icon"]')) { const l = el('link'); l.rel = 'icon'; l.type = 'image/svg+xml'; l.href = 'assets/favicon.svg'; document.head.append(l); }
  if (!document.querySelector('meta[name="theme-color"]')) { const m = el('meta'); m.name = 'theme-color'; m.content = '#0a0c10'; document.head.append(m); }
})();
