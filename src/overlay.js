// HTML controls and labels over the 3D scene.
import { setIcon, Component } from 'obsidian';

function el(tag, cls, parent, text) {
  const e = parent.ownerDocument.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  parent.appendChild(e);
  return e;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtDay = (t) => {
  const d = new Date(t);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};
function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 2 * 3600) return 'an hour ago';
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  if (s < 2 * 86400) return 'yesterday';
  return `${Math.round(s / 86400)} days ago`;
}
function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Good night.';
  if (h < 12) return 'Good morning.';
  if (h < 18) return 'Good afternoon.';
  if (h < 23) return 'Good evening.';
  return 'Good night.';
}

export class Overlay {
  constructor(root, view) {
    this.root = root;
    this.view = view;
    this.labels = new Map();
    this._p = {};

    this.labelLayer = el('div', 'aat-labels', root);
    this.nodeLabels = new Map();
    this._frameNo = 0;
    // Curve the label beneath the black hole and show an orbital ring on hover. The black hole handles clicks.
    this.homeText = 'Home';
    this._buildHoleLabel();

    // Header
    const top = el('div', 'aat-top', root);
    const brand = el('div', 'aat-brand', top);
    this.titleEl = el('div', 'aat-title', brand, 'Galaxy');
    this.subEl = el('div', 'aat-sub', brand, '');
    this.homePill = el('div', 'aat-pill aat-pill-center', top, 'Home');
    this.homePill.addEventListener('click', () => this.toggleDash());
    this.modePill = el('div', 'aat-pill', top, '');
    this.modePill.addEventListener('click', () => view.toggleMode());

    this.greet = el('div', 'aat-greet', root);
    this.local = el('div', 'aat-local', root);
    this.tip = el('div', 'aat-tip', root);
    this.empty = el('div', 'aat-empty', root);
    this.empty.setAttribute('role', 'status');

    // Toolbar
    const tb = el('div', 'aat-toolbar', root);
    const btn = (icon, title, fn) => {
      const b = el('div', 'aat-tb', tb);
      b.setAttribute('aria-label', title);
      setIcon(b, icon);
      b.addEventListener('click', fn);
      return b;
    };
    btn('minus', 'Zoom out', () => view.galaxy?.zoomBy(1.35));
    btn('plus', 'Zoom in', () => view.galaxy?.zoomBy(0.72));
    btn('rotate-ccw', 'Reset view', () => view.galaxy?.home());
    this.pauseBtn = btn('pause', 'Pause motion', () => this.togglePause());
    btn('maximize', 'Full screen', () => {
      const doc = root.ownerDocument;
      if (doc.fullscreenElement) doc.exitFullscreen();
      else root.requestFullscreen?.();
    });

    // Dashboard
    this.dash = el('div', 'aat-dash', root);
    this._onKey = (e) => {
      if (e.key === 'Escape' && this.dash.classList.contains('is-open')) {
        e.preventDefault();
        this.toggleDash(false);
      }
    };
    root.addEventListener('keydown', this._onKey);
  }

  togglePause() {
    const g = this.view.galaxy;
    if (!g) return;
    g.setPaused(!g.paused);
    setIcon(this.pauseBtn, g.paused ? 'play' : 'pause');
    this.pauseBtn.setAttribute('aria-label', g.paused ? 'Resume motion' : 'Pause motion');
  }

  setFps(fps) {
    this.subEl.textContent = `${this.view.app.vault.getName()} · ${fps} fps`;
  }

  // View state
  setData(data, stats, mode, extra = {}) {
    this.data = data;
    this.stats = stats;
    this.mode = mode;
    this.root.classList.toggle('is-local', mode === 'local');
    this.titleEl.textContent = mode === 'local' ? 'Local Galaxy' : 'Galaxy';
    this.modePill.textContent = mode === 'local' ? 'Global' : 'Local';
    this.modePill.setAttribute('aria-label', mode === 'local' ? 'Show the entire galaxy' : 'Show the current note’s galaxy');
    if (!this.loading) this.empty.style.display = 'none';

    for (const lab of this.nodeLabels.values()) lab.remove();
    this.nodeLabels.clear();
    this._frameNo = 0;

    // Cluster labels
    const keys = new Set();
    for (const c of data?.clusters || []) {
      if (c.key === '__center') continue;
      keys.add(c.key);
      let lab = this.labels.get(c.key);
      if (!lab) {
        lab = el('div', 'aat-clabel', this.labelLayer);
        const name = el('div', 'aat-cname', lab);
        lab._dot = el('span', 'aat-dot', name);
        lab._name = el('span', '', name);
        lab._sub = el('div', 'aat-csub', lab);
        lab.addEventListener('click', () => this.view.galaxy?.flyToCluster(c.key));
        this.labels.set(c.key, lab);
      }
      lab._name.textContent = c.name;
      lab._sub.textContent = `${c.ideas} ${c.ideas === 1 ? 'idea' : 'ideas'}`;
      lab.title = c.sub ? `${c.sub} / ${c.name}` : c.name;
    }
    for (const [k, lab] of this.labels) {
      if (!keys.has(k)) {
        lab.remove();
        this.labels.delete(k);
      }
    }
    this.recolor();

    this._setHoleText(mode === 'local' ? data?.info?.name || '' : 'Home');
    if (mode === 'global') this._buildGreeting(stats, extra.prevVisit);
    else this._buildLocal(data?.info);
    if (this.dash.classList.contains('is-open') && !this.query) this._buildDashHome();
  }

  // Show the interface after the scene appears.
  beginIntro() {
    this.root.classList.remove('is-intro-done');
    this.root.classList.add('is-intro');
  }

  endIntro() {
    if (!this.root.classList.contains('is-intro')) return;
    this.root.classList.remove('is-intro');
    this.root.classList.add('is-intro-done');
    // Apply staggered transitions only during this reveal.
    const win = this.root.win ?? window;
    win.clearTimeout(this._introDone);
    this._introDone = win.setTimeout(() => this.root.classList.remove('is-intro-done'), 1600);
  }

  showLoading() {
    this.loading = true;
    this.labelLayer.style.visibility = 'hidden';
    this.empty.textContent = 'Loading galaxy…';
    this.empty.style.display = '';
  }

  finishLoading() {
    this.loading = false;
    this.labelLayer.style.visibility = '';
    this.empty.textContent = '';
    this.empty.style.display = 'none';
  }

  showEmpty(text) {
    if (this.loading) this.finishLoading();
    this.empty.textContent = text;
    this.empty.style.display = '';
    for (const lab of this.labels.values()) lab.remove();
    this.labels.clear();
    this._setHoleText('');
    this.local.empty();
  }

  recolor() {
    const g = this.view.galaxy;
    if (!g) return;
    for (const [k, lab] of this.labels) lab._dot.style.color = g.clusterColorCss(k);
  }

  _buildGreeting(stats, prevVisit) {
    const g = this.greet;
    g.empty();
    el('h2', '', g, greeting());
    if (prevVisit) el('div', 'aat-since', g, `Last here: ${ago(prevVisit)}`);
    const changed = prevVisit ? stats.pagesList.filter((p) => p.mtime > prevVisit).length : stats.updatedWeek;
    const news = prevVisit
      ? changed
        ? `${changed} ${changed === 1 ? 'note was' : 'notes were'} edited since your last visit.`
        : 'No new notes or changes since your last visit.'
      : `${changed} ${changed === 1 ? 'note' : 'notes'} edited this week.`;
    el('div', 'aat-news', g, news);
  }

  _buildLocal(info) {
    const l = this.local;
    l.empty();
    if (!info) return;
    const t = el('div', 'aat-local-title', l, info.name);
    t.addEventListener('click', () => this.view.openPath(info.path));
    if (info.cluster) el('div', 'aat-since', l, info.cluster.sub ? `${info.cluster.sub} · ${info.cluster.name}` : info.cluster.name);
    const parts = [`${info.sections} ${info.sections === 1 ? 'section' : 'sections'}`, `${info.depth1} linked directly`];
    if (info.depth2) parts.push(`${info.depth2} two steps away`);
    el('div', 'aat-news', l, parts.join(' · '));
  }

  // Anchor labels to projected cluster positions each frame.
  frame(g) {
    const p = this._p;
    // Place nearer labels first and shift overlapping labels down.
    const placed = [];
    if (this._holeBox) placed.push(this._holeBox);
    const order = [];
    for (const [k, lab] of this.labels) {
      const c = g.centroids.get(k);
      if (!c) {
        lab.style.opacity = '0';
        continue;
      }
      const q = g.project(c.x, c.y, c.z, {});
      if (!q.front) {
        lab.style.opacity = '0';
        lab.style.pointerEvents = 'none';
        continue;
      }
      order.push([lab, q]);
    }
    order.sort((a, b) => a[1].depth - b[1].depth);
    // Push labels outward if they would cover the black hole.
    const hc = g.project(0, 0, 0, this._hc || (this._hc = {}));
    const lim = g.holeRadius() * 2.2 + 16;
    for (const [, q] of order) {
      if (!hc.front) break;
      const dx = q.x - hc.x, dy = q.y - hc.y, d = Math.hypot(dx, dy);
      if (d >= lim) continue;
      const ux = d > 1 ? dx / d : 0, uy = d > 1 ? dy / d : -1;
      q.x = hc.x + ux * lim;
      q.y = hc.y + uy * lim;
    }
    for (const [lab, q] of order) {
      const w = (lab._lw ||= Math.max(60, lab._name.textContent.length * 7.5 + 20));
      let y = q.y;
      for (let tries = 0; tries < 4; tries++) {
        const r = { x: q.x - w / 2, y: y - 14, w, h: 28 };
        if (!placed.some((t) => r.x < t.x + t.w && r.x + r.w > t.x && r.y < t.y + t.h && r.y + r.h > t.y)) break;
        y += 26;
      }
      placed.push({ x: q.x - w / 2, y: y - 14, w, h: 28 });
      const o = Math.max(0.28, Math.min(1, 1.5 - q.depth / 2200));
      lab.style.opacity = String(o);
      lab.style.pointerEvents = '';
      lab.style.transform = `translate(${q.x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
    }
    // Update the nearby-note selection every few frames and track positions in between.
    if (this._frameNo++ % 12 === 0) {
      const want = new Set(g.labelCandidates().map((n) => n.id));
      for (const [id, lab] of this.nodeLabels) {
        if (!want.has(id)) {
          lab.remove();
          this.nodeLabels.delete(id);
        }
      }
      for (const id of want) {
        if (this.nodeLabels.has(id)) continue;
        const n = g.nodeById.get(id);
        const lab = el('div', 'aat-nlabel', this.labelLayer, n.name);
        lab.style.opacity = '0'; // Show the label once its position is known.
        lab.addEventListener('click', (e) => this.view.openPath(n.path, null, e.ctrlKey || e.metaKey));
        this.nodeLabels.set(id, lab);
      }
    }
    // Place cluster labels first, then notes in priority order. Hide the greeting when the camera leaves its home position.
    const away = !!g.follow || g.camera.position.distanceTo(g.homeCam) > 260 || g.controls.target.length() > 60;
    this.root.classList.toggle('is-away', away);
    // Reserve space for the header, toolbar and greeting or local summary.
    const W = g.width, H = g.height;
    const taken = [{ x: 0, y: 0, w: W, h: 64 }, { x: W / 2 - 110, y: H - 64, w: 220, h: 64 }];
    if (!away || this.mode === 'local') {
      const box = (this.mode === 'local' ? this.local : this.greet).getBoundingClientRect();
      const rr = this.root.getBoundingClientRect();
      if (box.height) taken.push({ x: box.left - rr.left - 8, y: box.top - rr.top - 8, w: box.width + 16, h: box.height + 16 });
    }
    const hit = (r) => taken.some((t) => r.x < t.x + t.w && r.x + r.w > t.x && r.y < t.y + t.h && r.y + r.h > t.y);
    for (const lab of this.labels.values()) {
      if (lab.style.opacity === '0') continue;
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(lab.style.transform);
      if (m) taken.push({ x: +m[1] - 50, y: +m[2] - 14, w: 100, h: 28 });
    }
    for (const [id, lab] of this.nodeLabels) {
      const n = g.nodeById.get(id);
      if (!n) continue;
      g.project(n.x, n.y, n.z, p);
      const w = Math.min(180, (lab._w ||= lab.textContent.length * 5.8 + 4));
      const r = { x: p.x - w / 2, y: p.y + 8, w, h: 12 };
      lab.style.transform = `translate(${p.x.toFixed(1)}px, ${(p.y + 9).toFixed(1)}px) translate(-50%, 0)`;
      if (!p.front || hit(r)) {
        lab.style.opacity = '0';
        lab.style.pointerEvents = 'none';
        continue;
      }
      taken.push(r);
      lab.style.pointerEvents = '';
      lab.style.opacity = String(Math.max(0.35, Math.min(0.9, 1.4 - p.depth / 1400)));
    }

    this._placeHoleLabel(g);
    if (this.tipNode && !this.tipMouse) this._placeTip();
    if (this.loading) this.finishLoading();
  }

  // Show the title immediately and render a note or section preview after a short hover. With no pointer, the card tracks its star.
  showTip(node, mouse) {
    const win = this.root.win;
    win.clearTimeout(this._pvTimer);
    this._pvToken = (this._pvToken || 0) + 1;
    this._pvComp?.unload();
    this._pvComp = null;
    this.tipNode = node;
    this.tipMouse = mouse ? { x: mouse.x, y: mouse.y } : null;
    if (!node) {
      this.tip.style.opacity = '0';
      this.tip.classList.remove('is-rich');
      this.root.classList.remove('is-hovering');
      return;
    }
    if (mouse) this.root.classList.add('is-hovering');
    this.tip.empty();
    this.tip.classList.remove('is-rich');
    const head = el('div', 'aat-tip-head', this.tip);
    el('div', 'aat-tip-title', head, node.type === 'section' ? node.heading : node.name);
    const sub = node.type === 'section' ? `Section in ${node.path.split('/').pop().replace(/\.md$/, '')}` : node.type === 'file' ? 'Attachment' : `${node.sections || 0} ${node.sections === 1 ? 'section' : 'sections'} · ${node.degree} ${node.degree === 1 ? 'link' : 'links'}`;
    el('div', 'aat-tip-sub', head, sub);
    const body = el('div', 'aat-pv markdown-rendered', this.tip);
    this.tip.style.opacity = '1';
    this._placeTip();
    const token = this._pvToken;
    this._pvTimer = win.setTimeout(async () => {
      const comp = new Component();
      comp.load();
      this._pvComp = comp;
      let ok = false;
      try {
        ok = await this.view.renderPreview(node, body, comp);
      } catch (error) {
        console.warn('Accretion Atlas preview', error);
      }
      if (token !== this._pvToken) return comp.unload();
      if (ok) {
        this.tip.classList.add('is-rich');
        this._placeTip();
      }
    }, mouse ? 380 : 150);
  }

  // Keep the card inside the viewport near the star or pointer.
  _placeTip() {
    const g = this.view.galaxy;
    let x, y;
    const r = this.root.getBoundingClientRect();
    if (this.tipMouse) {
      x = this.tipMouse.x - r.left;
      y = this.tipMouse.y - r.top;
    } else if (this.tipNode && g) {
      const n = this.tipNode;
      const p = g.project(n.x, n.y, n.z, this._tp || (this._tp = {}));
      const c = g.renderer.domElement.getBoundingClientRect();
      if (!p.front) return;
      x = p.x + c.left - r.left;
      y = p.y + c.top - r.top;
    } else return;
    const w = this.tip.offsetWidth, h = this.tip.offsetHeight;
    // Place the card below the pointer or above the star to leave room for its label.
    let tx = x + (this.tipMouse ? 16 : 30), ty = this.tipMouse ? y + 14 : y - 24;
    if (tx + w > r.width - 12) tx = x - 16 - w;
    if (ty + h > r.height - 12) ty = Math.max(12, r.height - 12 - h);
    this.tip.style.transform = `translate(${Math.max(12, tx).toFixed(1)}px, ${ty.toFixed(1)}px)`;
  }

  // Black hole label
  _buildHoleLabel() {
    const NS = 'http://www.w3.org/2000/svg';
    const doc = this.root.ownerDocument;
    const id = 'aat-hole-arc-' + Math.random().toString(36).slice(2, 8);
    this.hole = el('div', 'aat-hole', this.labelLayer);
    const svg = doc.createElementNS(NS, 'svg');
    this.hole.appendChild(svg);
    const ring = doc.createElementNS(NS, 'circle');
    ring.setAttribute('class', 'aat-hole-ring');
    svg.appendChild(ring);
    const arc = doc.createElementNS(NS, 'path');
    arc.setAttribute('id', id);
    arc.setAttribute('fill', 'none');
    svg.appendChild(arc);
    const text = doc.createElementNS(NS, 'text');
    text.setAttribute('class', 'aat-hole-text');
    const tp = doc.createElementNS(NS, 'textPath');
    tp.setAttribute('href', '#' + id);
    tp.setAttribute('startOffset', '50%');
    tp.setAttribute('text-anchor', 'middle');
    text.appendChild(tp);
    svg.appendChild(text);
    Object.assign(this.hole, { _svg: svg, _ring: ring, _arc: arc, _tp: tp, _r: 0 });
  }

  _setHoleText(t) {
    this.homeText = t.length > 28 ? t.slice(0, 27) + '…' : t;
    this.hole._tp.textContent = this.homeText;
  }

  setHoleHover(on) {
    this.root.classList.toggle('is-hole-hover', on);
  }

  _placeHoleLabel(g) {
    const h = this.hole;
    const p = g.project(0, 0, 0, this._hp || (this._hp = {}));
    const r0 = g.holeRadius();
    if (!p.front || !this.homeText || r0 < 6 || r0 > 600) {
      h.style.opacity = '0';
      this._holeBox = null;
      return;
    }
    // Place the text below the disk and the hover ring just outside the photon ring.
    const R = r0 * 2.7 + 6;
    const ringR = r0 * 2.3;
    const size = Math.ceil(R + 16);
    if (Math.abs(R - h._r) > 0.4) {
      h._r = R;
      h._svg.setAttribute('width', String(size * 2));
      h._svg.setAttribute('height', String(size * 2));
      h._svg.setAttribute('viewBox', `0 0 ${size * 2} ${size * 2}`);
      // Trace the lower arc from left to right to keep the text upright.
      h._arc.setAttribute('d', `M ${size - R} ${size} A ${R} ${R} 0 0 0 ${size + R} ${size}`);
      h._ring.setAttribute('cx', String(size));
      h._ring.setAttribute('cy', String(size));
      h._ring.setAttribute('r', ringR.toFixed(1));
      h.style.width = h.style.height = `${size * 2}px`;
    }
    h.style.opacity = '';
    h.style.transform = `translate(${(p.x - size).toFixed(1)}px, ${(p.y - size).toFixed(1)}px)`;
    this._holeBox = { x: p.x - 70, y: p.y + R - 14, w: 140, h: 24 };
  }

  // Dashboard
  toggleDash(force) {
    const open = force ?? !this.dash.classList.contains('is-open');
    if (open === this.dash.classList.contains('is-open')) return;
    this.dash.classList.toggle('is-open', open);
    this.root.classList.toggle('dash-open', open);
    if (open) {
      this._buildDash();
      this.root.win.setTimeout(() => this.input?.focus(), 30);
    }
  }

  // Shift the galaxy left to make room for the dashboard.
  _buildDash() {
    const d = this.dash;
    d.empty();
    const head = el('div', 'aat-dash-head', d);
    const title = el('div', 'aat-dash-title', head);
    el('div', 'aat-dash-name', title, 'Overview');
    const now = new Date();
    el('div', 'aat-dash-date', title, `${WEEKDAYS[now.getDay()]}, ${fmtDay(now.getTime())}, ${now.getFullYear()}`);
    const close = el('div', 'aat-close', head);
    close.setAttribute('aria-label', 'Close');
    setIcon(close, 'x');
    close.addEventListener('click', () => this.toggleDash(false));

    const sb = el('label', 'aat-search', d);
    setIcon(el('span', 'aat-search-icon', sb), 'search');
    const input = (this.input = el('input', '', sb));
    input.type = 'text';
    input.placeholder = 'Search notes and sections';
    input.spellcheck = false;
    this.body = el('div', 'aat-dash-body', d);
    this.query = '';
    this.day = null;
    const win = input.win;
    let timer = 0;
    input.addEventListener('input', () => {
      win.clearTimeout(timer);
      timer = win.setTimeout(() => this._runSearch(input.value), 120);
    });
    input.addEventListener('keydown', (e) => {
      const items = [...this.body.querySelectorAll('.aat-result')];
      if (!items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.sel = Math.max(0, Math.min(items.length - 1, (this.sel ?? -1) + (e.key === 'ArrowDown' ? 1 : -1)));
        items.forEach((x, i) => x.classList.toggle('is-active', i === this.sel));
        items[this.sel].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        items[this.sel ?? 0]?.click();
      }
    });
    this._buildDashHome();
  }

  _section(parent, label, aside) {
    const sec = el('section', 'aat-sec', parent);
    const h = el('div', 'aat-sec-head', sec);
    el('span', 'aat-sec-label', h, label);
    if (aside) h.appendChild(aside);
    return sec;
  }

  // Connect each name and value with a dotted leader.
  _leaderRow(parent, name, value, onClick) {
    const row = el('div', 'aat-lead', parent);
    el('span', 'aat-lead-name', row, name);
    el('span', 'aat-lead-dots', row);
    el('span', 'aat-lead-val', row, value);
    if (onClick) row.addEventListener('click', onClick);
    return row;
  }

  _buildDashHome() {
    const s = this.view.plugin.getModel().stats;
    const b = this.body;
    b.empty();
    this.dash.style.setProperty('--aat-chart', this.view.plugin.chartColor());

    // Activity over the past 84 days
    const act = this._section(b, 'Activity · 12 weeks', this._swatches());
    // Keep the selected day when the vault changes.
    const keep = this.day?.t;
    this.day = s.activity.find((d) => d.t === keep) ?? null;
    this._ring(act, s.activity);
    if (this.day) this.ticks[s.activity.indexOf(this.day)]?.classList.add('is-picked');
    this.dayList = el('div', 'aat-daylist', act);
    this._showDay(this.day);

    // Vault totals
    const stock = this._section(b, 'Vault totals');
    const nums = el('div', 'aat-nums', stock);
    const num = (n, label) => {
      const c = el('div', 'aat-numcell', nums);
      el('div', 'aat-big', c, n.toLocaleString('en-US'));
      el('div', 'aat-small', c, label);
    };
    num(s.pages, s.pages === 1 ? 'note' : 'notes');
    num(s.ideas, s.ideas === 1 ? 'idea' : 'ideas');
    num(s.links, s.links === 1 ? 'link' : 'links');
    const per = s.pages ? (s.links / s.pages).toFixed(1) : '0';
    el('div', 'aat-note', stock, `${s.newWeek} new and ${s.updatedWeek} edited in the last 7 days · ${per} links per note`);

    // Cluster distribution
    const cl = this._section(b, 'Clusters');
    const list = s.byCluster.filter((c) => c.key !== '__center' && c.ideas > 0);
    const total = list.reduce((a, c) => a + c.ideas, 0) || 1;
    const spec = el('div', 'aat-spectrum', cl);
    const legend = el('div', 'aat-legend', cl);
    const fly = (c) => {
      if (this.mode !== 'global') this.view.toggleMode();
      this.root.win.setTimeout(() => this.view.galaxy?.flyToCluster(c.key), 60);
    };
    for (const c of list) {
      const color = this.view.galaxy?.clusterColorCss(c.key) || '';
      const seg = el('i', '', spec);
      seg.style.flexGrow = String(c.ideas);
      seg.style.background = color;
      seg.title = `${c.name}: ${c.ideas}`;
      const row = el('div', 'aat-leg', legend);
      el('span', 'aat-leg-dot', row).style.background = color;
      el('span', 'aat-leg-name', row, c.name);
      el('span', 'aat-leg-val', row, `${Math.round((c.ideas / total) * 100)}%`);
      row.title = `${c.ideas} ${c.ideas === 1 ? 'idea' : 'ideas'} · fly to cluster`;
      const hi = (on) => {
        seg.classList.toggle('is-hot', on);
        spec.classList.toggle('has-hot', on);
      };
      for (const x of [row, seg]) {
        x.addEventListener('pointerenter', () => hi(true));
        x.addEventListener('pointerleave', () => hi(false));
        x.addEventListener('click', () => fly(c));
      }
    }

    const hubs = this._section(b, 'Most connected');
    for (const p of s.mostConnected) this._leaderRow(hubs, p.name, String(p.degree), () => this.view.openPath(p.path));

    const rec = this._section(b, 'Recently edited');
    for (const p of s.recent) this._leaderRow(rec, p.name, ago(p.mtime), () => this.view.openPath(p.path));
  }

  // Offer the accent, palette swatches and a custom color.
  _swatches() {
    const plugin = this.view.plugin;
    const box = this.root.ownerDocument.createElement('div');
    box.className = 'aat-swatches';
    const cur = plugin.settings.chartColor;
    const pick = async (token) => {
      await plugin.setChartColor(token);
      this.dash.style.setProperty('--aat-chart', plugin.chartColor());
      for (const x of box.children) x.classList.toggle('is-on', x.dataset.token === token || (x.dataset.token === 'custom' && token.startsWith('#')));
    };
    const tokens = ['accent', ...plugin.colors.palette.map((_, i) => 'p' + i)];
    for (const t of tokens) {
      const sw = el('span', 'aat-sw', box);
      sw.dataset.token = t;
      sw.style.background = plugin.chartColor(t);
      sw.setAttribute('aria-label', t === 'accent' ? 'Theme accent color' : `Graph color ${Number(t[1]) + 1}`);
      sw.classList.toggle('is-on', t === cur);
      sw.addEventListener('click', () => pick(t));
    }
    const custom = el('label', 'aat-sw aat-sw-custom', box);
    custom.dataset.token = 'custom';
    custom.setAttribute('aria-label', 'Custom color');
    custom.classList.toggle('is-on', cur.startsWith('#'));
    if (cur.startsWith('#')) custom.style.background = cur;
    const input = el('input', '', custom);
    input.type = 'color';
    input.value = cur.startsWith('#') ? cur : '#d79b75';
    input.addEventListener('input', () => {
      custom.style.background = input.value;
    });
    input.addEventListener('change', () => pick(input.value));
    return box;
  }

  _ring(parent, days) {
    const NS = 'http://www.w3.org/2000/svg';
    const doc = this.root.ownerDocument;
    const wrap = el('div', 'aat-ring', parent);
    const svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 280 280');
    wrap.appendChild(svg);
    const node = (tag, attrs, into = svg) => {
      const n = doc.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      into.appendChild(n);
      return n;
    };
    const C = 140, R0 = 74, LEN = 46;
    const n = days.length;
    const max = Math.max(1, ...days.map((d) => d.edited.length));
    // The top gap marks the present. Days run clockwise from oldest to newest.
    const ang = (i) => ((-90 + 7 + (i / (n - 1)) * 346) * Math.PI) / 180;
    const pt = (a, r) => [C + Math.cos(a) * r, C + Math.sin(a) * r];
    node('circle', { cx: C, cy: C, r: R0, class: 'aat-ring-base' });
    node('circle', { cx: C, cy: C, r: R0 + LEN + 4, class: 'aat-ring-outer' });
    const [nx, ny] = pt(-Math.PI / 2, R0 + LEN + 4);
    node('circle', { cx: nx, cy: ny, r: 2.2, class: 'aat-ring-now' });
    this.ticks = [];
    days.forEach((d, i) => {
      const a = ang(i);
      const g = node('g', { class: 'aat-tick' + (i === n - 1 ? ' is-today' : '') });
      const k = d.edited.length;
      const age = 0.35 + 0.65 * (i / (n - 1));
      if (k) {
        const len = 4 + LEN * Math.sqrt(k / max);
        const [x1, y1] = pt(a, R0 + 3);
        const [x2, y2] = pt(a, R0 + 3 + len);
        node('line', { x1, y1, x2, y2, class: 'aat-tick-bar', 'stroke-opacity': age.toFixed(2) }, g);
      } else {
        const [x, y] = pt(a, R0 + 4);
        node('circle', { cx: x, cy: y, r: 0.9, class: 'aat-tick-zero' }, g);
      }
      if (d.created) {
        const [x, y] = pt(a, R0 - 7);
        node('circle', { cx: x, cy: y, r: Math.min(3.2, 1.1 + Math.sqrt(d.created) * 0.7), class: 'aat-tick-new' }, g);
      }
      // Label the first day of each month.
      const date = new Date(d.t);
      if (date.getDate() === 1) {
        const [x, y] = pt(a, R0 + LEN + 17);
        const t = node('text', { x, y, class: 'aat-ring-month', 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
        t.textContent = MONTHS[date.getMonth()];
      }
      // Widen the invisible hit target.
      const [hx1, hy1] = pt(a, R0 - 12);
      const [hx2, hy2] = pt(a, R0 + LEN + 6);
      const hit = node('line', { x1: hx1, y1: hy1, x2: hx2, y2: hy2, class: 'aat-tick-hit' }, g);
      hit.addEventListener('pointerenter', () => this._ringFocus(d, g));
      hit.addEventListener('pointerleave', () => this._ringFocus(null, null));
      hit.addEventListener('click', () => {
        this.day = this.day === d ? null : d;
        for (const t of this.ticks) t.classList.toggle('is-picked', t === g && !!this.day);
        this._showDay(this.day);
      });
      this.ticks.push(g);
    });
    // The center shows the weekly total or the day under the pointer.
    const mid = (this.ringMid = el('div', 'aat-ring-mid', wrap));
    const week = days.slice(-7).reduce((a, d) => a + d.edited.length, 0);
    const created = days.reduce((a, d) => a + d.created, 0);
    this.ringDefault = [String(week), 'edited this week', `${created} created in 12 weeks`];
    this._ringFocus(null, null);
  }

  _ringFocus(d, g) {
    const mid = this.ringMid;
    if (!mid) return;
    mid.empty();
    this.ticks?.forEach((t) => t.classList.toggle('is-hover', t === g));
    const [a, b, c] = d
      ? [String(d.edited.length), `edited · ${WEEKDAYS[new Date(d.t).getDay()]}, ${fmtDay(d.t)}`, d.created ? `${d.created} created` : '']
      : this.ringDefault;
    el('div', 'aat-ring-num', mid, a);
    el('div', 'aat-ring-lbl', mid, b);
    if (c) el('div', 'aat-ring-sub', mid, c);
  }

  _showDay(d) {
    const box = this.dayList;
    if (!box) return;
    box.empty();
    box.classList.toggle('is-open', !!d);
    if (!d) {
      el('div', 'aat-note', box, 'Each bar shows how many notes you edited that day. An inner dot marks new notes. Select a day to see its notes.');
      return;
    }
    el('div', 'aat-day-head', box, `${WEEKDAYS[new Date(d.t).getDay()]}, ${fmtDay(d.t)}`);
    if (!d.edited.length) el('div', 'aat-note', box, 'No notes were edited that day.');
    for (const p of d.edited.slice(0, 12)) {
      const t = new Date(p.mtime);
      this._leaderRow(box, p.name, `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`, () => this.view.openPath(p.path));
    }
    if (d.edited.length > 12) el('div', 'aat-note', box, `and ${d.edited.length - 12} more`);
  }

  async _runSearch(q) {
    this.query = q.trim();
    this.sel = undefined;
    if (this.query.length < 2) {
      this._buildDashHome();
      return;
    }
    const results = await this.view.plugin.search(this.query);
    if (q.trim() !== this.query) return;
    const b = this.body;
    b.empty();
    if (!results.length) {
      el('div', 'aat-noresult', b, 'No results found.');
      return;
    }
    const list = el('div', 'aat-results', b);
    for (const r of results) {
      const it = el('div', 'aat-result', list);
      el('div', 'aat-r-title', it, r.heading ? `${r.name} › ${r.heading}` : r.name);
      el('div', 'aat-r-cl', it, r.cluster);
      if (r.snippet) {
        const sn = el('div', 'aat-r-snip', it);
        const [a, m, z] = r.snippet;
        sn.append(a);
        el('mark', '', sn, m);
        sn.append(z);
      }
      it.addEventListener('click', (e) => {
        this.view.openPath(r.path, r.heading, e.ctrlKey || e.metaKey);
        this.view.galaxy?.focusNode(r.heading ? `${r.path}#${r.heading}` : r.path);
      });
    }
  }

  dispose() {
    this.root.removeEventListener('keydown', this._onKey);
  }
}
