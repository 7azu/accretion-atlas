// HTML controls and labels over the 3D scene.
import { setIcon, Component } from 'obsidian';

import { taskState, LABEL_FADE } from './galaxy.js';
import { Dashboard } from './dashboard.js';
import { el, clickable, fmtDay, ago, greeting, newsLine, dueText } from './util.js';

// Loading screen for the desktop launcher (plugin setting, Linux): covers the window with a quiet star
// field until the first frame of the galaxy is drawn, then opens from the place of the black hole.
// The same picture is shown before by the launcher's own window (launcher/Launch.qml), so the two join.
export class LaunchLoadingScreen {
  constructor(doc) {
    this.element = el('div', 'aat-launch-screen', doc.body);
    const veil = el('div', 'aat-launch-veil', this.element);
    const stars = el('div', 'aat-launch-stars', veil);
    el('div', 'aat-launch-ring', this.element);
    stars.setAttribute('aria-hidden', 'true');
    const orbit = el('div', 'aat-launch-orbit', this.element);
    el('div', 'aat-launch-glow', orbit);
    el('div', 'aat-launch-disc', orbit);
    el('div', 'aat-launch-hole', orbit);
    const track = el('div', 'aat-launch-track', orbit);
    el('div', 'aat-launch-dust', track);
    const status = el('div', 'aat-launch-status', orbit, 'Loading the galaxy …');
    status.setAttribute('role', 'status');
  }
  waitForPaint() {
    const win = this.element.ownerDocument.defaultView;
    return new Promise((resolve) => {
      let frame;
      const done = () => {
        window.clearTimeout(timeout);
        if (!win.closed) win.cancelAnimationFrame(frame);
        resolve();
      };
      const timeout = window.setTimeout(done, 300);
      frame = win.requestAnimationFrame(() => {
        frame = win.requestAnimationFrame(done);
      });
    });
  }
  reveal() {
    if (this.fade || !this.element.isConnected) return;
    const win = this.element.ownerDocument.defaultView;
    const reduced = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.element.setAttribute('aria-hidden', 'true');
    const at = this.anchor?.() ?? [0.5, 0.5];
    const st = this.element.style;
    st.setProperty('--aat-iris-x', `${(at[0] * 100).toFixed(2)}%`);
    st.setProperty('--aat-iris-y', `${(at[1] * 100).toFixed(2)}%`);
    st.setProperty('--aat-iris-dx', `${((at[0] - 0.5) * 100).toFixed(2)}vw`);
    st.setProperty('--aat-iris-dy', `${((at[1] - 0.5) * 100).toFixed(2)}vh`);
    this.element.classList.add('is-opening');
    this.onRelease?.();
    const dur = reduced ? 200 : 1150;
    const start = win.performance.now();
    const far = Math.hypot(win.innerWidth, win.innerHeight);
    const smooth = (x) => {
      const c = Math.min(1, Math.max(0, x));
      return c * c * c * (c * (c * 6 - 15) + 10);
    };
    this.fade = { done: false };
    const step = (now) => {
      if (!this.element.isConnected) return;
      const k = Math.min(1, (now - start) / dur);
      const r = smooth((k - 0.1) / 0.85) * far * 1.05;
      st.setProperty('--aat-iris-r', `${r.toFixed(1)}px`);
      st.setProperty('--aat-iris-soft', `${(40 + r * 0.32).toFixed(1)}px`);
      st.setProperty('--aat-iris-ring', (Math.sin(Math.PI * Math.min(1, k * 1.15)) * (1 - k) * 1.6).toFixed(3));
      st.setProperty('--aat-iris-core', (1 - smooth(k / 0.4)).toFixed(3));
      if (k < 1) this.frame = win.requestAnimationFrame(step);
      else this.dispose();
    };
    this.frame = win.requestAnimationFrame(step);
  }
  dispose() {
    const win = this.element.ownerDocument.defaultView;
    if (this.frame && win && !win.closed) win.cancelAnimationFrame(this.frame);
    this.element.remove();
  }
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
    this.subEl = el('div', 'aat-sub', brand, view.app.vault.getName());
    this.modePill = el('div', 'aat-pill', top, '');
    this.modePill.addEventListener('click', () => view.toggleMode());

    this.greet = el('div', 'aat-greet', root);
    this.taskChip = el('div', 'aat-task-chip', root);
    this.taskChip.addEventListener('click', () => this._nextTask());
    this.local = el('div', 'aat-local', root);
    this.tip = el('div', 'aat-tip', root);
    this.empty = el('div', 'aat-empty', root);
    this.empty.setAttribute('role', 'status');

    // Toolbar: the way into the dashboard with its name, then the controls of the view as icons
    const tb = el('div', 'aat-toolbar', root);
    this.dashBtn = clickable(el('div', 'aat-tb aat-tb-dash', tb), () => this.toggleDash());
    setIcon(el('span', 'aat-tb-icon', this.dashBtn), 'layout-dashboard');
    el('span', '', this.dashBtn, 'Dashboard');
    this.dashBtn.setAttribute('aria-label', 'Open the dashboard (Tab)');
    el('i', 'aat-tb-sep', tb);
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
    this.taskBtn = btn('list-todo', 'Show open tasks only', () => this.toggleTaskFilter());
    this.editorBtn = btn('book-open', 'Open Obsidian', () => view.showObsidian());
    btn('maximize', 'Full screen', () => {
      const doc = root.ownerDocument;
      if (doc.fullscreenElement) doc.exitFullscreen();
      else root.requestFullscreen?.();
    });

    // Dashboard, above everything else. Tab or "/" on the galaxy opens it, Escape leaves it.
    this.dashboard = new Dashboard(root, view, this);
    // Keys of the galaxy itself, while the view (not a field in it) has the keyboard: arrows turn,
    // plus and minus zoom, Space pauses, Escape returns to the starting view.
    const held = new Set();
    const turn = () => {
      const on = (k) => (held.has(k) ? 1 : 0);
      view.galaxy?.setOrbitInput(on('ArrowLeft') - on('ArrowRight'), on('ArrowUp') - on('ArrowDown'));
    };
    this._onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (this.dashboard.isOpen) {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        this.dashboard.escape();
        return;
      }
      if (e.target !== root) return;
      const g = view.galaxy;
      if ((e.key === 'Tab' && !e.shiftKey) || e.key === '/') {
        if (this.mode === 'local') return;
        this.toggleDash(true);
      } else if (e.key.startsWith('Arrow')) {
        held.add(e.key);
        turn();
      } else if (e.key === '+' || e.key === '=') g?.zoomBy(0.72);
      else if (e.key === '-') g?.zoomBy(1.35);
      else if (e.key === ' ') this.togglePause();
      // Away from the starting view Escape leads back to it. There it is left to Obsidian, which
      // returns to the note edited last.
      else if (e.key === 'Escape' && this.root.classList.contains('is-away')) g?.home();
      else return;
      e.preventDefault();
    };
    this._onKeyUp = (e) => {
      if (held.delete(e.key)) turn();
    };
    this._onBlur = () => {
      held.clear();
      turn();
    };
    root.addEventListener('keydown', this._onKey);
    root.addEventListener('keyup', this._onKeyUp);
    root.addEventListener('focusout', this._onBlur);
  }

  // Solo: the galaxy fills the window like an app of its own (desktop launcher). Then a button leads
  // back to the notes.
  setSolo(enabled) {
    this.editorBtn.style.display = enabled ? '' : 'none';
  }
  togglePause() {
    const g = this.view.galaxy;
    if (!g) return;
    g.setPaused(!g.paused);
    setIcon(this.pauseBtn, g.paused ? 'play' : 'pause');
    this.pauseBtn.setAttribute('aria-label', g.paused ? 'Resume motion' : 'Pause motion');
  }

  // View state
  setData(data, stats, mode, extra = {}) {
    this.data = data;
    this.root.win.setTimeout(() => this._updateTaskChip(), 0);
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
        // The name under the pointer lights its cluster and dims the others.
        lab.addEventListener('pointerenter', () => this.view.galaxy?.setClusterHover(c.key));
        lab.addEventListener('pointerleave', () => this.view.galaxy?.setClusterHover(null));
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
    if (mode === 'local') this.toggleDash(false);
    this.dashboard.refresh();
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
    el('h2', '', g, greeting(this.view.plugin.userName()));
    if (prevVisit) el('div', 'aat-since', g, `Last here: ${ago(prevVisit)}`);
    // The news is the short form of the dashboard and leads there.
    const news = clickable(el('div', 'aat-news', g, newsLine(stats, prevVisit)), () => this.toggleDash(true));
    news.setAttribute('aria-label', 'Open the dashboard');
    if (stats.comingUp.length) {
      el('div', 'aat-section-title', g, 'Upcoming');
      for (const it of stats.comingUp) {
        const row = el('div', 'aat-up', g);
        const due = dueText(it.due);
        const d = el('span', 'aat-up-date', row, due.days > 1 ? `due ${due.text}` : due.text);
        if (due.overdue) d.classList.add('is-overdue');
        else if (due.soon) d.classList.add('is-soon');
        el('span', 'aat-up-title', row, it.title + (it.status === 'partial' ? ' (partial)' : ''));
        row.title = 'Click: fly there · Double-click: open';
        row.addEventListener('click', () => {
          const g = this.view.galaxy;
          if (g?.nodeById.has(it.path)) g.focusNode(it.path);
          else this.view.openPath(it.path);
        });
        row.addEventListener('dblclick', () => this.view.openPath(it.path));
      }
    }
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
    // When an overlap moves a name to another slot (26 px steps), don't jump: fade it out, move it
    // while invisible and fade it back in. If the overlap clears again while fading out, it fades
    // back in at the old slot (no flickering back and forth).
    const now = performance.now();
    const dt = Math.min(0.1, (now - (this._labT || now)) / 1000);
    this._labT = now;
    // Far away the names would pile up on a small spot: they fade out before the camera gets there.
    const camDist = g.camera.position.distanceTo(g.controls.target);
    const farK = Math.min(1, Math.max(0, (camDist - LABEL_FADE[0]) / (LABEL_FADE[1] - LABEL_FADE[0])));
    const near = 1 - farK * farK * (3 - 2 * farK);
    for (const [lab, q] of order) {
      const w = (lab._lw ||= Math.max(60, lab._name.textContent.length * 7.5 + 20));
      let slot = 0;
      for (let tries = 0; tries < 4; tries++) {
        const y = q.y + slot * 26;
        const r = { x: q.x - w / 2, y: y - 14, w, h: 28 };
        if (!placed.some((t) => r.x < t.x + t.w && r.x + r.w > t.x && r.y < t.y + t.h && r.y + r.h > t.y)) break;
        slot++;
      }
      if (lab._slot === undefined) lab._slot = slot;
      if (lab._fade === undefined) lab._fade = 1;
      if (slot !== lab._slot) {
        lab._fade -= dt / 0.15;
        if (lab._fade <= 0) {
          lab._fade = 0;
          lab._slot = slot;
        }
      } else {
        lab._fade = Math.min(1, lab._fade + dt / 0.2);
      }
      // A name occupies the slot it is currently drawn at.
      const y = q.y + lab._slot * 26;
      placed.push({ x: q.x - w / 2, y: y - 14, w, h: 28 });
      // While moving, _fade drives the opacity frame by frame; the CSS transition (0.4 s) would lag
      // behind and the name would still be visible when it moves.
      const fading = lab._fade < 1 || slot !== lab._slot;
      if (fading !== !!lab._fading) {
        lab._fading = fading;
        lab.style.transition = fading ? 'none' : '';
      }
      const o = Math.max(0.28, Math.min(1, 1.5 - q.depth / 2200)) * lab._fade * near;
      lab.style.opacity = o > 0.004 ? o.toFixed(3) : '0';
      lab.style.pointerEvents = lab._fade > 0.5 && near > 0.4 ? '' : 'none';
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
        // In the task filter with the cluster in front: tasks of different clusters often share a name
        const cluster = g.taskFilter ? g.clusterByKey.get(n.cluster)?.name : null;
        const lab = el('div', 'aat-nlabel', this.labelLayer, cluster ? `${cluster} · ${n.name}` : n.name);
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
    const taken = [{ x: 0, y: 0, w: W, h: 64 }, { x: W / 2 - 180, y: H - 64, w: 360, h: 64 }];
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
    const st = taskState(node);
    if (st) {
      const due = node.task.due != null ? fmtDay(node.task.due) : null;
      const text = {
        overdue: `overdue since ${due}`,
        open: due ? `open · due ${due}` : 'open',
        partial: due ? `partly done · due ${due}` : 'partly done',
        done: 'done',
      }[st];
      el('div', `aat-task-tag is-${st}`, head, text);
    }
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
    Object.assign(this.hole, { _svg: svg, _ring: ring, _arc: arc, _text: text, _tp: tp, _r: 0 });
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
    // Place the text below the disk and the hover ring just outside the photon ring.
    const R = r0 * 2.7 + 6;
    if (!p.front || !this.homeText || r0 < 6 || r0 > 600) {
      h.style.opacity = '0';
      this._holeBox = null;
      return;
    }
    // Close up the text would end under the toolbar: then only the hover ring stays.
    h._text.style.opacity = p.y + R > g.height - 78 ? '0' : '';
    const ringR = r0 * 2.3;
    // Rebuild the arc (and with it the glyph layout) only on a clear change, so its curvature fits.
    // Rebuilding on every change over 0.4 px with a rounded-up size made the text stand still for a
    // few frames and then jump by 1-2 px.
    if (!h._r || Math.abs(R / h._r - 1) > 0.08) {
      h._r = R;
      h._size = Math.ceil(R + 16);
      const size = h._size;
      h._svg.setAttribute('width', String(size * 2));
      h._svg.setAttribute('height', String(size * 2));
      h._svg.setAttribute('viewBox', `0 0 ${size * 2} ${size * 2}`);
      // Trace the lower arc from left to right to keep the text upright.
      h._arc.setAttribute('d', `M ${size - R} ${size} A ${R} ${R} 0 0 0 ${size + R} ${size}`);
      h._ring.setAttribute('cx', String(size));
      h.style.width = h.style.height = `${size * 2}px`;
    }
    // In between, move smoothly: shift the whole label by the missing distance (compositor only, the
    // text is not laid out again) and the ring (a circle, no text) the opposite way to keep it centered.
    const size = h._size;
    const off = R - h._r;
    h._ring.setAttribute('cy', (size - off).toFixed(2));
    h._ring.setAttribute('r', ringR.toFixed(2));
    h.style.opacity = '';
    h.style.transform = `translate(${(p.x - size).toFixed(2)}px, ${(p.y - size + off).toFixed(2)}px)`;
    this._holeBox = { x: p.x - 70, y: p.y + R - 14, w: 140, h: 24 };
  }

  // ---- Tasks: filter to open ones, a chip with the count, a click flies to the next ----
  setTasksEnabled(enabled) {
    this.taskBtn.style.display = enabled ? '' : 'none';
    if (!enabled && this.view.galaxy?.taskFilter) this.toggleTaskFilter(false);
  }

  toggleTaskFilter(force) {
    const g = this.view.galaxy;
    if (!g) return;
    const on = force ?? !g.taskFilter;
    g.setTaskFilter(on);
    this.root.classList.toggle('is-task-filter', on);
    this.taskBtn.classList.toggle('is-active', on);
    this._taskIndex = -1;
    for (const lab of this.nodeLabels.values()) lab.remove();
    this.nodeLabels.clear();
    this._frameNo = 0;
    this._updateTaskChip();
  }
  _updateTaskChip() {
    const g = this.view.galaxy;
    const c = this.taskChip;
    c.empty();
    if (!g?.taskFilter) return;
    const list = g.openTasks();
    const late = list.filter((n) => taskState(n) === 'overdue').length;
    if (!list.length) {
      el('span', '', c, 'No open tasks');
      return;
    }
    el('span', 'aat-task-count', c, `${list.length} ${list.length === 1 ? 'open task' : 'open tasks'}`);
    if (late) el('span', 'aat-task-late', c, `${late} overdue`);
    const next = el('span', 'aat-task-next', c);
    setIcon(next, 'chevron-right');
    c.setAttribute('aria-label', 'Fly to the next open task');
  }
  _nextTask() {
    const g = this.view.galaxy;
    const list = g?.openTasks() ?? [];
    if (!list.length) return;
    this._taskIndex = ((this._taskIndex ?? -1) + 1) % list.length;
    g.focusNode(list[this._taskIndex].id);
  }
  // Dashboard: see dashboard.js
  toggleDash(force) {
    if (this.mode === 'local' && force !== false) return;
    this.dashboard.toggle(force);
  }

  dispose() {
    this.dashboard.dispose();
    this.root.removeEventListener('keydown', this._onKey);
    this.root.removeEventListener('keyup', this._onKeyUp);
    this.root.removeEventListener('focusout', this._onBlur);
  }
}
