// The dashboard: a sheet over the whole view. A head with the search, then one card per subject:
// activity, tasks, the most connected notes, the vault in numbers and the clusters. The galaxy stays
// behind it, blurred. Whatever leads into the galaxy or to a note closes the sheet first.
import { setIcon } from 'obsidian';

import { taskState } from './galaxy.js';
import { el, clickable, MONTHS, WEEKDAYS, fmtDay, fmtWeekday, fmtTime, ago, agoShort, greeting, newsLine, dueText } from './util.js';

const SVG = 'http://www.w3.org/2000/svg';
// Rows of a list before it is cut off
const LIST_ROWS = 8;
const CLUSTER_ROWS = 10;
// The sheet is laid out for a view of this width and scaled to the view it gets: a large window shows
// everything larger instead of more empty space, a slightly smaller one still shows it whole.
const DESIGN_WIDTH = 1456;
const MIN_SCALE = 0.9;
const MAX_SCALE = 1.4;

export class Dashboard {
  constructor(root, view, overlay) {
    this.root = root;
    this.view = view;
    this.overlay = overlay;
    this.isOpen = false;
    this.query = '';
    this.day = null;
    this.allClusters = false;

    const d = (this.element = el('div', 'aat-dash', root));
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-label', 'Dashboard');
    d.inert = true;
    this.scroll = el('div', 'aat-dash-scroll', d);
    // A click beside the sheet closes it.
    this.scroll.addEventListener('click', (e) => {
      if (e.target === this.scroll) this.toggle(false);
    });
    this.resizeObserver = new root.win.ResizeObserver(() => {
      if (this.isOpen && !this.query) this._fit();
    });
    this.resizeObserver.observe(root);
  }

  dispose() {
    this.resizeObserver.disconnect();
    this.root.win.clearTimeout(this._arriveTimer);
  }

  // Scale the sheet so that the cards fill the view: as large as the width and the height allow.
  // A narrow view (one column) keeps the plain size and scrolls.
  _fit() {
    const page = this.page;
    if (!page?.isConnected) return;
    const W = this.root.clientWidth, H = this.root.clientHeight;
    page.style.zoom = '1';
    const natural = page.offsetHeight;
    // Rounded down, so the scaled sheet never ends a pixel below the view (a scroll bar would appear).
    const scale = Math.floor(Math.min(W / DESIGN_WIDTH, (H - 1) / Math.max(1, natural)) * 200) / 200;
    page.style.zoom = String(Math.max(W < 980 ? 1 : MIN_SCALE, Math.min(MAX_SCALE, scale)));
  }

  // Open or close. Opening hands the keyboard to the search.
  toggle(force) {
    const open = force ?? !this.isOpen;
    const win = this.root.win;
    if (open === this.isOpen) {
      if (open) this.input?.focus({ preventScroll: true });
      return;
    }
    this.isOpen = open;
    this.element.classList.toggle('is-open', open);
    this.element.inert = !open;
    this.root.classList.toggle('dash-open', open);
    this.overlay.showTip(null);
    win.clearTimeout(this._arriveTimer);
    if (open) {
      // Arriving: the cards rise one after the other, numbers count up, the ring draws itself. Only
      // while the sheet opens; a rebuild after the vault changed shows everything at once.
      this._arriving = !win.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.element.classList.toggle('is-arriving', this._arriving);
      this._build();
      this._arriveTimer = win.setTimeout(() => {
        this._arriving = false;
        this.element.classList.remove('is-arriving');
      }, 1900);
      this.input.focus({ preventScroll: true });
    } else {
      this._arriving = false;
      this.element.classList.remove('is-arriving');
      // Keep the keyboard in the view, so the keys of the galaxy go on working.
      this.root.focus({ preventScroll: true });
    }
  }

  // Escape: first empty the search, then close.
  escape() {
    if (this.query || this.input?.value) {
      this.input.value = '';
      this._runSearch('');
      this.input.focus({ preventScroll: true });
    } else {
      this.toggle(false);
    }
  }

  // The vault or the colors changed: show the new state, unless a search is on screen.
  refresh() {
    if (this.isOpen && !this.query) this._home();
  }

  // Close, then act in the galaxy: the flight starts once the sheet is on its way out.
  _leave(action) {
    this.toggle(false);
    this.root.win.setTimeout(action, 140);
  }

  _openNote(path, heading, event) {
    this.toggle(false);
    this.view.openPath(path, heading, !!event && (event.ctrlKey || event.metaKey));
  }

  // Fly to the star of a note; a note without a star is opened instead.
  _flyTo(path) {
    this._leave(() => {
      const g = this.view.galaxy;
      if (g?.nodeById.has(path)) g.focusNode(path);
      else this.view.openPath(path);
    });
  }

  // ---- frame: head with the search, the body, a foot ----
  _build() {
    const s = this.scroll;
    s.empty();
    s.scrollTop = 0;
    this.query = '';
    this.sel = undefined;
    const page = (this.page = el('div', 'aat-dash-page', s));

    const head = el('header', 'aat-dash-head', page);
    const title = el('div', 'aat-dash-title', head);
    const now = new Date();
    el('div', 'aat-dash-date', title, `${WEEKDAYS[now.getDay()]}, ${fmtDay(now.getTime())}, ${now.getFullYear()}`);
    el('h2', 'aat-dash-name', title, greeting(this.view.plugin.userName()));
    this.lede = el('div', 'aat-dash-lede', title);

    const tools = el('div', 'aat-dash-tools', head);
    const sb = el('label', 'aat-search', tools);
    setIcon(el('span', 'aat-search-icon', sb), 'search');
    const input = (this.input = el('input', '', sb));
    input.type = 'text';
    input.placeholder = 'Search notes and sections';
    input.spellcheck = false;
    const close = clickable(el('div', 'aat-close', tools), () => this.toggle(false));
    close.setAttribute('aria-label', 'Close');
    setIcon(close, 'x');

    const win = this.root.win;
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

    this.body = el('div', 'aat-dash-body', page);

    const foot = el('footer', 'aat-dash-foot', page);
    el('span', '', foot, `Accretion Atlas ${this.view.plugin.manifest.version}`);
    el('span', 'aat-dash-foot-vault', foot, this.view.app.vault.getName());
    const accent = el('div', 'aat-dash-accent', foot);
    el('span', '', accent, 'Accent');
    this._swatches(accent);

    this._home();
  }

  // A card: its name on the left of the head; the caller may add something on the right.
  // `order` staggers the cards while the sheet arrives.
  _card(parent, label, order, cls) {
    const card = el('section', 'aat-card' + (cls ? ' ' + cls : ''), parent);
    card.style.setProperty('--i', String(order));
    const head = el('div', 'aat-card-head', card);
    el('span', 'aat-card-label', head, label);
    return { card, head };
  }

  // A row of a list: the name, a value on the right.
  _row(parent, name, value, onClick) {
    const row = el('div', 'aat-row', parent);
    el('span', 'aat-row-name', row, name);
    if (value != null) el('span', 'aat-row-val', row, value);
    if (onClick) clickable(row, onClick);
    return row;
  }

  _chip(parent, text, onClick) {
    return clickable(el('div', 'aat-chip-btn', parent, text), onClick);
  }

  // Count a number up from zero while the sheet arrives.
  _count(node, value) {
    const text = (v) => v.toLocaleString('en-US');
    const win = this.root.win;
    if (!this._arriving || value < 2) {
      node.textContent = text(value);
      return;
    }
    node.textContent = '0';
    const start = win.performance.now() + 220;
    const step = (now) => {
      if (!node.isConnected) return;
      const k = Math.min(1, Math.max(0, (now - start) / 950));
      node.textContent = text(Math.round(value * (1 - Math.pow(1 - k, 3))));
      if (k < 1) win.requestAnimationFrame(step);
    };
    win.requestAnimationFrame(step);
  }

  _num(parent, value, label) {
    const cell = el('div', 'aat-numcell', parent);
    this._count(el('div', 'aat-big', cell), value);
    el('div', 'aat-small', cell, label);
    return cell;
  }

  // ---- the cards ----
  _home() {
    const plugin = this.view.plugin;
    const s = plugin.getModel().stats;
    const g = this.view.galaxy;
    const b = this.body;
    b.empty();
    this.element.style.setProperty('--aat-chart', plugin.chartColor());

    const prev = this.view.prevVisit;
    this.lede.textContent = newsLine(s, prev) + (prev ? ` You were last here ${ago(prev)}.` : '');

    // Two columns: the wide one tells what happened and what is to do, the narrow one what there is.
    const grid = el('div', 'aat-grid', b);
    const main = el('div', 'aat-col aat-col-main', grid);
    const side = el('div', 'aat-col aat-col-side', grid);
    this._activity(main, s, 1);
    const pair = el('div', 'aat-pair', main);
    this._tasks(pair, s, g, 3);
    this._hubs(pair, s, 4);
    this._vault(side, s, 2);
    this._clusters(side, s, g, 3);
    this._fit();
  }

  // Activity of the past 12 weeks: the ring shows when, the list beside it what. Without a chosen day
  // the list holds the notes edited last.
  _activity(parent, s, order) {
    const { card, head } = this._card(parent, 'Activity', order, 'aat-card-activity');
    el('span', 'aat-card-note', head, 'Last 12 weeks');
    const wrap = el('div', 'aat-act', card);
    const left = el('div', 'aat-act-ring', wrap);
    // Keep the chosen day when the vault changes.
    const keep = this.day?.t;
    this.day = s.activity.find((d) => d.t === keep) ?? null;
    this._ring(left, s.activity);
    if (this.day) this.ticks[s.activity.indexOf(this.day)]?.classList.add('is-picked');
    const key = el('div', 'aat-ring-key', left);
    el('i', 'aat-key-bar', key);
    el('span', '', key, 'edited');
    el('i', 'aat-key-dot', key);
    el('span', '', key, 'new');
    this.recent = s.recent;
    this.dayList = el('div', 'aat-act-list', wrap);
    this._showDay(this.day);
  }

  _showDay(d) {
    const box = this.dayList;
    if (!box) return;
    box.empty();
    const head = el('div', 'aat-list-head', box);
    const rows = el('div', 'aat-rows', box);
    if (!d) {
      el('span', 'aat-list-title', head, 'Recently edited');
      for (const p of this.recent.slice(0, LIST_ROWS)) this._row(rows, p.name, agoShort(p.mtime), (e) => this._openNote(p.path, null, e));
      if (!this.recent.length) el('div', 'aat-note', box, 'No notes yet.');
      return;
    }
    el('span', 'aat-list-title', head, fmtWeekday(d.t));
    this._chip(head, 'Recent', () => {
      this.day = null;
      for (const t of this.ticks) t.classList.remove('is-picked');
      this._showDay(null);
    });
    if (!d.edited.length) el('div', 'aat-note', box, 'No notes were edited that day.');
    const shown = d.edited.length > LIST_ROWS ? LIST_ROWS - 1 : LIST_ROWS;
    for (const p of d.edited.slice(0, shown)) this._row(rows, p.name, fmtTime(p.mtime), (e) => this._openNote(p.path, null, e));
    if (d.edited.length > shown) el('div', 'aat-note aat-more', box, `and ${d.edited.length - shown} more`);
  }

  _ring(parent, days) {
    const doc = this.root.ownerDocument;
    const wrap = el('div', 'aat-ring', parent);
    const svg = doc.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 280 280');
    wrap.appendChild(svg);
    const node = (tag, attrs, into = svg) => {
      const n = doc.createElementNS(SVG, tag);
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
      const g = node('g', { class: 'aat-tick' + (i === n - 1 ? ' is-today' : ''), style: `--i:${i}` });
      const k = d.edited.length;
      const age = 0.35 + 0.65 * (i / (n - 1));
      if (k) {
        const len = 4 + LEN * Math.sqrt(k / max);
        const [x1, y1] = pt(a, R0 + 3);
        const [x2, y2] = pt(a, R0 + 3 + len);
        node('line', { x1, y1, x2, y2, pathLength: 1, class: 'aat-tick-bar', 'stroke-opacity': age.toFixed(2) }, g);
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
    this.ringMid = el('div', 'aat-ring-mid', wrap);
    const week = days.slice(-7).reduce((a, d) => a + d.edited.length, 0);
    const created = days.reduce((a, d) => a + d.created, 0);
    this.ringDefault = [String(week), 'edited this week', `${created} new in 12 weeks`];
    this._ringFocus(null, null);
  }

  _ringFocus(d, g) {
    const mid = this.ringMid;
    if (!mid) return;
    mid.empty();
    this.ticks?.forEach((t) => t.classList.toggle('is-hover', t === g));
    const [a, b, c] = d ? [String(d.edited.length), `edited · ${fmtWeekday(d.t)}`, d.created ? `${d.created} new` : ''] : this.ringDefault;
    const num = el('div', 'aat-ring-num', mid);
    if (d) num.textContent = a;
    else this._count(num, Number(a));
    el('div', 'aat-ring-lbl', mid, b);
    if (c) el('div', 'aat-ring-sub', mid, c);
  }

  // Tasks (setting "Show tasks"): how many are open, what is due next, and the filter of the galaxy.
  _tasks(parent, s, g, order) {
    const open = this.view.plugin.settings.tasks && g ? g.openTasks() : [];
    if (!open.length) return;
    const { card, head } = this._card(parent, 'Tasks', order);
    const filter = this._chip(head, g.taskFilter ? 'Show all notes' : 'Show in galaxy', () => {
      const on = !g.taskFilter;
      this.overlay.toggleTaskFilter(on);
      if (on) this.toggle(false);
      else filter.textContent = 'Show in galaxy';
    });
    const cells = el('div', 'aat-nums aat-task-nums', card);
    const count = (state) => open.filter((n) => taskState(n) === state).length;
    this._num(cells, count('overdue'), 'overdue').classList.add('is-overdue');
    this._num(cells, count('open'), 'open').classList.add('is-open');
    this._num(cells, count('partial'), 'partly done').classList.add('is-partial');
    const rows = el('div', 'aat-rows', card);
    for (const it of s.comingUp) {
      const due = dueText(it.due);
      const row = this._row(rows, it.title, due.text, () => this._flyTo(it.path));
      row.classList.toggle('is-overdue', due.overdue);
      row.classList.toggle('is-soon', due.soon);
    }
  }

  _hubs(parent, s, order) {
    const { card, head } = this._card(parent, 'Most connected', order);
    el('span', 'aat-card-note', head, 'Links');
    const rows = el('div', 'aat-rows', card);
    for (const p of s.mostConnected) this._row(rows, p.name, String(p.degree), (e) => this._openNote(p.path, null, e));
  }

  _vault(parent, s, order) {
    const { card } = this._card(parent, 'Vault', order);
    const nums = el('div', 'aat-nums', card);
    this._num(nums, s.pages, s.pages === 1 ? 'note' : 'notes');
    this._num(nums, s.ideas, s.ideas === 1 ? 'idea' : 'ideas');
    this._num(nums, s.links, s.links === 1 ? 'link' : 'links');
    const per = s.pages ? (s.links / s.pages).toFixed(1) : '0';
    el('div', 'aat-note', card, `${s.newWeek} new and ${s.updatedWeek} edited in the last 7 days · ${per} links per note`);
  }

  // Clusters by size: one bar in their colors, below it the list. A click flies there.
  _clusters(parent, s, g, order) {
    const list = s.byCluster.filter((c) => c.key !== '__center' && c.ideas > 0);
    const { card, head } = this._card(parent, 'Clusters', order, 'aat-card-clusters');
    el('span', 'aat-card-note', head, String(list.length));
    const total = list.reduce((a, c) => a + c.ideas, 0) || 1;
    const spec = el('div', 'aat-spectrum', card);
    const rows = el('div', 'aat-rows', card);
    const cut = !this.allClusters && list.length > CLUSTER_ROWS + 1 ? CLUSTER_ROWS : list.length;
    const segs = [];
    list.forEach((c, i) => {
      const color = g?.clusterColorCss(c.key) || '';
      const seg = el('i', '', spec);
      // While arriving the bar grows from nothing
      seg.style.flexGrow = this._arriving ? '0' : String(c.ideas);
      seg.style.background = color;
      segs.push([seg, c.ideas]);
      const fly = () => this._leave(() => this.view.galaxy?.flyToCluster(c.key));
      const hot = [seg];
      if (i < cut) {
        const share = (c.ideas / total) * 100;
        const row = this._row(rows, c.name, share >= 1 ? `${Math.round(share)}%` : '<1%', fly);
        el('span', 'aat-row-dot', row).style.background = color;
        row.setAttribute('aria-label', `${c.name}: ${c.ideas} ${c.ideas === 1 ? 'idea' : 'ideas'}. Fly to the cluster`);
        hot.push(row);
      }
      seg.setAttribute('aria-label', `${c.name}: ${c.ideas} ${c.ideas === 1 ? 'idea' : 'ideas'}`);
      seg.addEventListener('click', fly);
      const light = (on) => {
        for (const x of hot) x.classList.toggle('is-hot', on);
        spec.classList.toggle('has-hot', on);
      };
      for (const x of hot) {
        x.addEventListener('pointerenter', () => light(true));
        x.addEventListener('pointerleave', () => light(false));
      }
    });
    if (cut < list.length) {
      this._chip(el('div', 'aat-more', card), `${list.length - cut} more`, () => {
        this.allClusters = true;
        this._home();
      });
    }
    if (this._arriving) {
      this.root.win.setTimeout(() => {
        for (const [seg, grow] of segs) seg.style.flexGrow = String(grow);
      }, 420);
    }
  }

  // The accent of the sheet and the color of the ring: the theme accent, the palette or a custom color.
  _swatches(parent) {
    const plugin = this.view.plugin;
    const box = el('div', 'aat-swatches', parent);
    const cur = plugin.settings.chartColor;
    const pick = async (token) => {
      await plugin.setChartColor(token);
      this.element.style.setProperty('--aat-chart', plugin.chartColor());
      for (const x of box.children) x.classList.toggle('is-on', x.dataset.token === token || (x.dataset.token === 'custom' && token.startsWith('#')));
    };
    const tokens = ['accent', ...plugin.colors.palette.map((_, i) => 'p' + i)];
    for (const t of tokens) {
      const sw = clickable(el('span', 'aat-sw', box), () => pick(t));
      sw.dataset.token = t;
      sw.style.background = plugin.chartColor(t);
      sw.setAttribute('aria-label', t === 'accent' ? 'Theme accent color' : `Graph color ${Number(t[1]) + 1}`);
      sw.classList.toggle('is-on', t === cur);
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

  // ---- search: the results take the place of the cards ----
  async _runSearch(q) {
    this.query = q.trim();
    this.sel = undefined;
    if (this.query.length < 2) {
      this.query = '';
      this._home();
      return;
    }
    const results = await this.view.plugin.search(this.query);
    if (q.trim() !== this.query || !this.isOpen) return;
    const b = this.body;
    b.empty();
    this.scroll.scrollTop = 0;
    const { card, head } = this._card(b, 'Results', 1, 'aat-card-results');
    if (!results.length) {
      el('div', 'aat-noresult', card, 'Nothing found.');
      return;
    }
    el('span', 'aat-card-note', head, results.length >= 40 ? 'First 40' : String(results.length));
    const list = el('div', 'aat-results', card);
    for (const r of results) {
      const it = el('div', 'aat-result', list);
      const top = el('div', 'aat-r-top', it);
      el('span', 'aat-r-title', top, r.heading ? `${r.name} › ${r.heading}` : r.name);
      el('span', 'aat-r-cl', top, r.cluster);
      if (r.snippet) {
        const sn = el('div', 'aat-r-snip', it);
        const [a, m, z] = r.snippet;
        sn.append(a);
        el('mark', '', sn, m);
        sn.append(z);
      }
      clickable(it, (e) => {
        this._openNote(r.path, r.heading, e);
        this.view.galaxy?.focusNode(r.heading ? `${r.path}#${r.heading}` : r.path);
      });
    }
  }
}
