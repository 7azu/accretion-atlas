// Render the vault as a galaxy surrounding a black hole.
import { Plugin, ItemView, PluginSettingTab, Setting, TFile, MarkdownRenderer, debounce } from 'obsidian';
import { buildModel, localModel, signature, clusterOf } from './model.js';
import { Galaxy } from './galaxy.js';
import { Overlay } from './overlay.js';

const VIEW_TYPE = 'accretion-atlas';
const ICON = 'orbit';


// Read optional pywal RGB triplets from the active snippet and fall back to Obsidian theme colors.
function readColors(usePywal) {
  const cs = getComputedStyle(document.body);
  const parse = (s) => {
    const m = s && s.match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/);
    return m ? [m[1] / 255, m[2] / 255, m[3] / 255] : null;
  };
  const probe = (name) => {
    const s = document.createElement('span');
    s.style.color = `var(${name})`;
    s.style.display = 'none';
    document.body.appendChild(s);
    const v = getComputedStyle(s).color;
    s.remove();
    return parse(v);
  };
  const accent = (usePywal && parse(cs.getPropertyValue('--ctp-accent'))) || probe('--interactive-accent') || [0.83, 0.67, 0.62];
  let palette = usePywal ? [1, 2, 3, 4, 5, 6, 7].map((i) => parse(cs.getPropertyValue(`--wal-graph-${i}`))).filter(Boolean) : [];
  if (palette.length < 3) {
    palette = ['--color-orange', '--color-green', '--color-blue', '--color-purple', '--color-pink', '--color-cyan', '--color-yellow']
      .map(probe)
      .filter(Boolean);
  }
  return { accent, palette };
}

class GalaxyView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.mode = 'global';
    this.center = null;
    this.sig = '';
  }

  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return this.mode === 'local' ? 'Local galaxy' : 'Galaxy';
  }
  getIcon() {
    return ICON;
  }
  getState() {
    return { mode: this.mode };
  }
  async setState(state, result) {
    const mode = state?.mode === 'local' ? 'local' : 'global';
    if (mode !== this.mode || !this.galaxy) {
      this.mode = mode;
      if (this.ready) this._rebuild();
    }
    await super.setState(state, result);
  }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass('aat-view');
    this.root = this.contentEl.createDiv({ cls: 'aat-root' });
    this.applyPalette(this.plugin.colors);
    this.root.tabIndex = 0;
    this.canvasWrap = this.root.createDiv({ cls: 'aat-canvas' });
    this.overlay = new Overlay(this.root, this);
    this.overlay.showLoading();
    this.prevVisit = this.plugin.prevVisit;
    this.ready = true;
    this.stopWatchingWindow = this.root.onWindowMigrated?.(() => this._rebuild());
    // Wait one tick so setState can supply the view mode after onOpen.
    this.root.win.setTimeout(() => {
      if (this.ready && !this.galaxy) this._rebuild();
    }, 0);
  }

  _rebuild() {
    this.overlay.showLoading();
    this.galaxy?.dispose();
    this.galaxy = null;
    this.sig = '';
    this.overlay.beginIntro();
    try {
      this.galaxy = new Galaxy(this.canvasWrap, {
        mode: this.mode,
        onIntroUi: () => this.overlay.endIntro(),
        onHole: () => this.galaxy?.home(),
        onHoleHover: (on) => this.overlay.setHoleHover(on),
        colors: this.plugin.colors,
        nebulaColor: () => this.plugin.nebulaColor(),
        onOpenNode: (n, newTab) => this.openNode(n, newTab),
        onHover: (n, m) => this.overlay.showTip(n, m),
        onFrame: (g) => this.overlay.frame(g),
        onFps: (f) => this.overlay.setFps(f),
        onRenderError: (error) => this._showRenderError(error),
      });
      this.leaf.updateHeader?.();
      this.refresh();
    } catch (e) {
      this._showRenderError(e);
    }
  }

  _showRenderError(error) {
    console.error('Accretion Atlas:', error);
    this.galaxy?.dispose();
    this.galaxy = null;
    this.overlay.endIntro();
    this.overlay.showEmpty('The galaxy could not be rendered.');
  }

  refresh() {
    if (!this.galaxy) return;
    const model = this.plugin.getModel();
    let data = model;
    if (this.mode === 'local') {
      const center = this.center || this.plugin.lastFile;
      data = center ? localModel(model, center) : null;
      if (!data) {
        this.galaxy.setData({ nodes: [], links: [], clusters: [] });
        this.sig = '';
        this.overlay.setData(null, model.stats, 'local');
        this.overlay.showEmpty('Open a note to see its local galaxy.');
        return;
      }
      this.center = data.centerId;
    }
    const sig = signature(data) + this.mode + (data.centerId || '');
    if (sig !== this.sig) {
      this.galaxy.setData(data);
      this.sig = sig;
    }
    this.overlay.setData(data, model.stats, this.mode, { prevVisit: this.prevVisit });
  }

  setCenter(path) {
    if (this.mode !== 'local' || path === this.center) return;
    this.center = path;
    // Rebuild around the new center so stars settle into their orbits.
    this.galaxy?.nodeById.clear();
    this.refresh();
  }

  toggleMode() {
    const mode = this.mode === 'local' ? 'global' : 'local';
    this.leaf.setViewState({ type: VIEW_TYPE, state: { ...this.getState(), mode }, active: true });
  }

  applyPalette({ accent, palette }) {
    const rgb = (color) => color.map((v) => Math.round(v * 255)).join(', ');
    this.root.style.setProperty('--aat-acc', rgb(accent));
    for (const [i, index] of [5, 0, 3, 1].entries()) {
      this.root.style.setProperty('--aat-a' + (i + 1), rgb(palette[index % palette.length] || accent));
    }
  }

  recolor(colors) {
    if (this.root) this.applyPalette(colors);
    this.galaxy?.setColors(colors);
    this.overlay?.recolor();
    if (this.overlay?.dash.classList.contains('is-open') && !this.overlay.query) this.overlay._buildDashHome();
  }

  openNode(n, newTab) {
    if (n.type === 'section') this.openPath(n.path, n.heading, newTab);
    else this.openPath(n.path, null, newTab);
  }

  async openPath(path, heading, newTab) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const ws = this.app.workspace;
    const eState = heading ? { subpath: '#' + heading } : undefined;
    let leaf = null;
    if (!newTab) {
      // Reuse the most recent editor in this window and keep the galaxy open.
      const md = ws.getLeavesOfType('markdown').filter((l) => l.getContainer() === this.leaf.getContainer());
      md.sort((a, b) => (b.activeTime || 0) - (a.activeTime || 0));
      leaf = md[0] || null;
    }
    leaf ??= ws.getLeaf('tab');
    await leaf.openFile(file, { active: true, eState });
    ws.revealLeaf(leaf);
  }

  // Render the beginning of a note or the selected section. Return false for an empty preview.
  async renderPreview(node, el, component) {
    const file = this.app.vault.getAbstractFileByPath(node.path);
    if (!(file instanceof TFile)) return false;
    if (/^(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(file.extension)) {
      const img = el.createEl('img', { cls: 'aat-pv-img' });
      img.src = this.app.vault.getResourcePath(file);
      return true;
    }
    if (file.extension !== 'md') return false;
    const text = await this.app.vault.cachedRead(file);
    let lines = text.split('\n');
    let from = 0;
    if (lines[0] === '---') {
      const end = lines.indexOf('---', 1);
      if (end > 0) from = end + 1;
    }
    let to = lines.length;
    if (node.type === 'section') {
      // Stop at the next heading of equal or higher rank.
      const heads = this.app.metadataCache.getFileCache(file)?.headings ?? [];
      const nth = Number(/#(\d+)$/.exec(node.id.slice(node.path.length + 1 + node.heading.length))?.[1] || 1);
      const same = heads.filter((h) => h.heading === node.heading);
      const h = same[nth - 1] ?? same[0];
      if (!h) return false;
      from = h.position.start.line + 1;
      const next = heads.find((x) => x.position.start.line > h.position.start.line && x.level <= h.level);
      if (next) to = next.position.start.line;
    }
    let md = lines.slice(from, to).join('\n').trim();
    if (!md) return false;
    if (md.length > 1800) md = md.slice(0, 1800).replace(/\n[^\n]*$/, '') + '\n\n…';
    await MarkdownRenderer.render(this.app, md, el, file.path, component);
    return true;
  }

  async onClose() {
    this.ready = false;
    this.stopWatchingWindow?.();
    this.plugin.rememberVisit();
    this.overlay?.dispose();
    this.galaxy?.dispose();
    this.galaxy = null;
  }
}

// Muted warm gray that matches the accretion disk.
const DEFAULT_NEBULA = '#958b84';

export default class AccretionAtlas extends Plugin {
  async onload() {
    this.settings = Object.assign({ chartColor: 'accent', usePywal: false, nebulaColor: DEFAULT_NEBULA }, await this.loadData());
    this.pendingSave = Promise.resolve();
    if (this.settings.lastVisit == null) {
      const legacyVisit = Number(this.app.loadLocalStorage?.('accretion-atlas-lastVisit')
        ?? window.localStorage.getItem(this.app.vault.getName() + ':accretion-atlas-lastVisit'));
      if (Number.isFinite(legacyVisit) && legacyVisit > 0) {
        this.settings.lastVisit = legacyVisit;
        await this.saveSettings();
      }
    }
    this.prevVisit = Number(this.settings.lastVisit) || 0;
    this.registerInterval(window.setInterval(() => {
      if (this.views().length) this.rememberVisit();
    }, 5 * 60 * 1000));
    this.colors = readColors(this.settings.usePywal);
    this.addSettingTab(new ColorSettings(this.app, this));
    this.model = null;
    this.searchIndex = null;
    this.lastFile = this.app.workspace.getActiveFile()?.path || null;

    this.registerView(VIEW_TYPE, (leaf) => new GalaxyView(leaf, this));
    this.addRibbonIcon(ICON, 'Open global galaxy', () => this.openGlobal());
    this.addCommand({ id: 'open-global', name: 'Open global galaxy', callback: () => this.openGlobal() });
    this.addCommand({ id: 'open-local', name: 'Open local galaxy', callback: () => this.openLocal() });

    const invalidate = debounce(() => this.invalidate(), 1200, true);
    this.registerEvent(this.app.metadataCache.on('resolved', invalidate));
    this.registerEvent(this.app.metadataCache.on('changed', (f) => {
      this.dropSearch(f.path);
      invalidate();
    }));
    this.registerEvent(this.app.vault.on('rename', () => {
      this.searchIndex = null;
      invalidate();
    }));
    this.registerEvent(this.app.vault.on('delete', () => {
      this.searchIndex = null;
      invalidate();
    }));
    this.registerEvent(this.app.workspace.on('css-change', () => this.refreshColors()));
    this.registerEvent(this.app.workspace.on('file-open', (f) => {
      if (!f) return;
      this.lastFile = f.path;
      for (const v of this.views()) v.setCenter(f.path);
    }));
  }

  onunload() {
    this.rememberVisit();
  }

  refreshColors() {
    this.colors = readColors(this.settings.usePywal);
    for (const view of this.views()) view.recolor(this.colors);
  }

  chartColor(token = this.settings.chartColor) {
    const c = this.colors;
    let rgb = null;
    if (token === 'accent') rgb = c.accent;
    else if (/^p[0-6]$/.test(token)) rgb = c.palette[Number(token[1])] ?? null;
    if (rgb) return `rgb(${rgb.map((v) => Math.round(v * 255)).join(', ')})`;
    return /^#[0-9a-f]{6}$/i.test(token) ? token : `rgb(${c.accent.map((v) => Math.round(v * 255)).join(', ')})`;
  }

  // Fixed nebula color as [r, g, b] in 0..1, or null when the nebula uses the pywal cluster colors.
  nebulaColor() {
    if (this.settings.usePywal) return null;
    const hex = /^#[0-9a-f]{6}$/i.test(this.settings.nebulaColor) ? this.settings.nebulaColor : DEFAULT_NEBULA;
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  }

  setNebulaColor(hex) {
    this.settings.nebulaColor = hex;
    for (const view of this.views()) view.galaxy?.refreshNebula();
    this.saveSettingsSoon();
  }

  // The color picker fires continuously while dragging, so write data.json only after a pause.
  saveSettingsSoon = debounce(() => this.saveSettings(), 800, true);

  async setChartColor(token) {
    this.settings.chartColor = token;
    await this.saveSettings();
  }

  rememberVisit() {
    this.settings.lastVisit = Date.now();
    return this.saveSettings();
  }

  saveSettings() {
    const save = this.pendingSave.then(() => this.saveData(this.settings));
    this.pendingSave = save.catch(error => console.error('Accretion Atlas could not save plugin data', error));
    return save;
  }

  views() {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).map((l) => l.view).filter((v) => v instanceof GalaxyView);
  }

  getModel() {
    if (!this.model) this.model = buildModel(this.app);
    return this.model;
  }

  invalidate() {
    this.model = null;
    for (const v of this.views()) v.refresh();
  }

  async openGlobal() {
    const ws = this.app.workspace;
    const existing = ws.getLeavesOfType(VIEW_TYPE).find((l) => l.view?.mode !== 'local');
    if (existing) return ws.revealLeaf(existing);
    const leaf = ws.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE, state: { mode: 'global' }, active: true });
    ws.revealLeaf(leaf);
  }

  async openLocal() {
    const ws = this.app.workspace;
    const existing = ws.getLeavesOfType(VIEW_TYPE).find((l) => l.view?.mode === 'local');
    if (existing) return ws.revealLeaf(existing);
    const leaf = ws.getRightLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE, state: { mode: 'local' }, active: true });
    ws.revealLeaf(leaf);
  }

  // Cache note contents in memory for dashboard search.
  dropSearch(path) {
    if (this.searchIndex) this.searchIndex = this.searchIndex.filter((e) => e.path !== path).concat(this._indexOne(path) || []);
  }

  _indexOne(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile) || f.extension !== 'md') return null;
    return this.app.vault.cachedRead(f).then((text) => this._entry(f, text));
  }

  _entry(f, text) {
    const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '');
    const heads = (this.app.metadataCache.getFileCache(f)?.headings || []).map((h) => ({ h: h.heading, line: h.position.start.line, lower: h.heading.toLowerCase() }));
    return { path: f.path, name: f.basename, lname: f.basename.toLowerCase(), cluster: clusterOf(f.path).name, text: body, lower: body.toLowerCase(), raw: text, heads };
  }

  async getSearchIndex() {
    if (Array.isArray(this.searchIndex)) {
      const pending = this.searchIndex.filter((e) => e && typeof e.then === 'function');
      if (!pending.length) return this.searchIndex;
      this.searchIndex = (await Promise.all(this.searchIndex)).filter(Boolean);
      return this.searchIndex;
    }
    const files = this.app.vault.getMarkdownFiles();
    this.searchIndex = await Promise.all(files.map(async (f) => this._entry(f, await this.app.vault.cachedRead(f))));
    return this.searchIndex;
  }

  async search(q) {
    const idx = await this.getSearchIndex();
    const ql = q.toLowerCase();
    const out = [];
    for (const e of idx) {
      let score = 0;
      if (e.lname.includes(ql)) score += 10 + (e.lname.startsWith(ql) ? 5 : 0);
      const head = e.heads.find((h) => h.lower.includes(ql));
      if (head) score += 6;
      const pos = e.lower.indexOf(ql);
      if (pos >= 0) score += 2 + Math.min(4, e.lower.split(ql).length - 1);
      if (!score) continue;
      let snippet = null;
      if (pos >= 0) {
        const a = Math.max(0, pos - 70);
        const z = Math.min(e.text.length, pos + ql.length + 140);
        const clean = (s) => s.replace(/[#*_`>\[\]]+/g, '').replace(/\s+/g, ' ');
        snippet = [(a > 0 ? '…' : '') + clean(e.text.slice(a, pos)), e.text.slice(pos, pos + ql.length), clean(e.text.slice(pos + ql.length, z)) + (z < e.text.length ? '…' : '')];
      }
      out.push({ path: e.path, name: e.name, cluster: e.cluster, heading: head && !e.lname.includes(ql) ? head.h : null, snippet, score });
    }
    out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return out.slice(0, 40);
  }
}

class ColorSettings extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName('Use pywal colors')
      .setDesc('Use the colors from your active pywal CSS snippet, also for the nebulae. If the snippet is unavailable, use theme colors. When off, the nebulae use one fixed color.')
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.usePywal).onChange(async (enabled) => {
        this.plugin.settings.usePywal = enabled;
        this.plugin.refreshColors();
        await this.plugin.saveSettings();
        this.display();
      }));
    if (!this.plugin.settings.usePywal) {
      new Setting(this.containerEl)
        .setName('Nebula color')
        .setDesc('Color of all nebulae while pywal colors are off.')
        .addColorPicker((picker) => picker.setValue(this.plugin.settings.nebulaColor).onChange((hex) => this.plugin.setNebulaColor(hex)))
        .addExtraButton((button) => button.setIcon('rotate-ccw').setTooltip('Reset').onClick(() => {
          this.plugin.setNebulaColor(DEFAULT_NEBULA);
          this.display();
        }));
    }
  }
}
