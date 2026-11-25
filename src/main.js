// Render the vault as a galaxy surrounding a black hole.
import { Plugin, PluginSettingTab, Setting, ItemView, Notice, TFile, WorkspaceWindow, MarkdownRenderer, debounce } from 'obsidian';
import { buildModel, localModel, signature, taskSignature, clusterOf, parseClusterRules } from './model.js';
import { Galaxy } from './galaxy.js';
import { LaunchLoadingScreen, Overlay } from './overlay.js';
import { writeFile, readFile, chmod, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import launchScript from '../launcher/launch.sh';
import launchQml from '../launcher/Launch.qml';
import starlightQml from '../launcher/Starlight.qml';
import launcherIcon from '../launcher/icon.svg';
// Desktop launcher (plugin setting, Linux): the launcher's own window shows a loading screen while
// Obsidian starts and waits in $XDG_RUNTIME_DIR/<id>/status for "ready x y" (x, y = place of the black
// hole in the window, shares 0..1). It is written once the first frame is drawn and the window shows.
// Only the short session id that the local launcher made is accepted from the URI.
function desktopTransition(id) {
  if (typeof id !== 'string' || !/^accretion-atlas\.[a-zA-Z0-9]{10}$/.test(id)) return null;
  const runtime = process.env.XDG_RUNTIME_DIR;
  if (!runtime) return null;
  const status = runtime + '/' + id + '/status';
  let frameReady = false;
  let windowShown = false;
  const transition = {
    fade: false,
    reveal() {
      frameReady = true;
      if (windowShown) transition.dispose();
    },
    didShowWindow() {
      windowShown = true;
      if (frameReady) transition.dispose();
    },
    dispose() {
      if (transition.fade) return;
      transition.fade = true;
      const at = transition.anchor?.() ?? [0.5, 0.5];
      writeFile(status, `ready ${at[0].toFixed(4)} ${at[1].toFixed(4)}`, { flag: 'r+' }).catch((error) => {
        if (error.code !== 'ENOENT') console.warn('Accretion Atlas could not signal the launcher', error);
      });
      transition.onRelease?.();
    },
  };
  return transition;
}

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
    this.solo = false;
    this.center = null;
    this.sig = '';
    this.navigation = false;
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
    this.launchLoading = this.plugin.launchLoadingScreens.get(this.leaf);
    this.plugin.launchLoadingScreens.delete(this.leaf);
    this.overlay = new Overlay(this.root, this);
    this.overlay.setSolo(this.solo);
    this.overlay.setTasksEnabled(!!this.plugin.settings.tasks);
    this.root.addEventListener('pointerdown', (e) => (this.lastPointer = { x: e.clientX, y: e.clientY }), true);
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
    const loading = this.launchLoading;
    const hold = !!loading && !loading.fade;
    if (hold) {
      loading.onRelease = () => this.galaxy?.beginIntro();
      loading.anchor = () => this._anchor();
    }
    this.overlay.beginIntro();
    try {
      this.galaxy = new Galaxy(this.canvasWrap, {
        mode: this.mode,
        intro: hold ? 'hold' : 'play',
        onIntroUi: () => this.overlay.endIntro(),
        onHole: () => this.galaxy?.home(),
        held: () => this.plugin.renderHold && this.plugin.exitingView !== this,
        onHoleHover: (on) => this.overlay.setHoleHover(on),
        colors: this.plugin.colors,
        nebulaColor: () => this.plugin.nebulaColor(),
        onOpenNode: (n, newTab) => this.openNode(n, newTab),
        onHover: (n, m) => this.overlay.showTip(n, m),
        onFrame: (g) => this.overlay.frame(g),
        onFps: (f) => this.overlay.setFps(f),
        onFirstFrame: loading && !loading.fade ? () => loading.reveal() : null,
        onFirstFrameError: (error) => this._showRenderError(error),
      });
      if (this.root.classList.contains('is-task-filter')) this.galaxy.setTaskFilter(true);
      this.leaf.updateHeader?.();
      this.refresh();
    } catch (e) {
      this._showRenderError(e);
    }
  }
  setSolo(solo) {
    this.solo = solo;
    this.overlay?.setSolo(solo);
  }
  replayIntro(loading) {
    const g = this.galaxy;
    if (!g) return false;
    this.overlay.toggleDash(false);
    this.overlay.beginIntro();
    if (loading) {
      loading.onRelease = () => this.galaxy?.beginIntro();
      loading.anchor = () => this._anchor();
      g.restartIntro('hold', () => loading.reveal());
    } else {
      g.restartIntro('play');
    }
    return true;
  }
  liftToOverlay(at) {
    const root = this.root;
    this._home = { parent: root.parentElement, next: root.nextSibling };
    root.style.setProperty('--aat-hole-x', `${Math.round(at.x)}px`);
    root.style.setProperty('--aat-hole-y', `${Math.round(at.y)}px`);
    root.classList.add('aat-exit-overlay');
    root.ownerDocument.body.appendChild(root);
  }
  openHole() {
    const root = this.root;
    return new Promise((resolve) => {
      const done = () => {
        root.removeEventListener('animationend', onEnd);
        window.clearTimeout(timer);
        resolve();
      };
      const onEnd = (e) => {
        if (e.target === root && e.animationName === 'aat-hole-open') done();
      };
      root.addEventListener('animationend', onEnd);
      const timer = window.setTimeout(done, 1600);
      root.classList.add('is-opening-hole');
    });
  }
  settleOverlay() {
    const root = this.root;
    const home = this._home;
    this._home = null;
    root.classList.remove('aat-exit-overlay', 'is-opening-hole', 'is-exiting');
    if (home?.parent?.isConnected) home.parent.insertBefore(root, home.next?.parentElement === home.parent ? home.next : null);
    else this.contentEl.appendChild(root);
  }
  _anchor() {
    const r = this.canvasWrap.getBoundingClientRect();
    const w = this.root.win;
    return [(r.left + r.width / 2) / Math.max(1, w.innerWidth), (r.top + r.height / 2) / Math.max(1, w.innerHeight)];
  }
  originOf(node) {
    const g = this.galaxy;
    if (g && node) {
      const p = g.project(node.x, node.y, node.z, {});
      const r = g.renderer.domElement.getBoundingClientRect();
      if (p.front && p.x >= 0 && p.y >= 0 && p.x <= r.width && p.y <= r.height) return { x: r.left + p.x, y: r.top + p.y };
    }
    return this.lastPointer ?? { x: this.root.win.innerWidth / 2, y: this.root.win.innerHeight / 2 };
  }

  _showRenderError(error) {
    console.error('Accretion Atlas:', error);
    this.galaxy?.dispose();
    this.galaxy = null;
    this.overlay.endIntro();
    this.overlay.showEmpty('The galaxy could not be rendered.');
    this.launchLoading?.reveal();
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
    const tasks = taskSignature(data);
    if (sig !== this.sig) {
      this.galaxy.setData(data);
      this.sig = sig;
    } else if (tasks !== this.taskSig) {
      this.galaxy.updateTasks(data.nodes);
    }
    this.taskSig = tasks;
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
    if (n.type === 'section') this.openPath(n.path, n.heading, newTab, n);
    else this.openPath(n.path, null, newTab, n);
  }

  async openPath(path, heading, newTab, node) {
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
    if (!this.solo) {
      leaf ??= ws.getLeaf('tab');
      await leaf.openFile(file, { active: true, eState });
      ws.revealLeaf(leaf);
      return;
    }
    const tabs = this.leaf.parent;
    leaf ??= ws.createLeafInParent(tabs, Math.max(0, tabs.children.indexOf(this.leaf) + 1));
    await this.plugin.exitSolo({
      node,
      origin: this.originOf(node),
      prepare: () => leaf.openFile(file, { active: false, eState }),
      reveal: async () => {
        ws.setActiveLeaf(leaf, { focus: true });
        await ws.revealLeaf(leaf);
      },
    });
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

  async showObsidian() {
    const ws = this.app.workspace;
    const back = async () => {
      const recent = ws.getLeavesOfType('markdown').filter((l) => l.getContainer() === this.leaf.getContainer());
      recent.sort((a, b) => (b.activeTime || 0) - (a.activeTime || 0));
      if (recent[0]) ws.setActiveLeaf(recent[0], { focus: true });
    };
    const w = this.root.win;
    await this.plugin.exitSolo({ origin: { x: w.innerWidth / 2, y: w.innerHeight / 2 }, reveal: back });
  }
  async onClose() {
    this.ready = false;
    this.stopWatchingWindow?.();
    this.launchLoading?.dispose();
    this.plugin.rememberVisit();
    this.overlay?.dispose();
    this.galaxy?.dispose();
    this.galaxy = null;
  }
}

// Muted warm gray that matches the accretion disk.
const DEFAULT_NEBULA = '#958b84';
const DEFAULTS = {
  chartColor: 'accent',
  usePywal: false,
  nebulaColor: DEFAULT_NEBULA,
  // Folder patterns whose matches become clusters, one per line; empty = the top-level folders
  clusterRules: '',
  // Tasks from note properties: off by default, names of the properties and the values of each state
  tasks: false,
  taskStatusKey: 'status',
  taskDueKey: 'due',
  taskLabelKey: '',
  taskOpen: 'open, todo',
  taskPartial: 'partial, in progress',
  taskDone: 'done',
  // Desktop launcher with its own window and loading screen (Linux)
  launcher: false,
};
const DESKTOP_ENTRY = 'accretion-atlas.desktop';

export default class AccretionAtlas extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.pendingSave = Promise.resolve();
    // Started by the desktop launcher: the window is the galaxy from its first frame on
    this.launcherColdStart = this.settings.launcher && window.OBS_ACT?.action === VIEW_TYPE;
    // The last visit is kept per device, not in data.json: a synced vault would otherwise change on
    // every visit. A value saved there by an earlier version moves over once.
    let visit = Number(this.loadLocal('lastVisit')) || 0;
    if (this.settings.lastVisit != null) {
      visit = Math.max(visit, Number(this.settings.lastVisit) || 0);
      delete this.settings.lastVisit;
      this.saveLocal('lastVisit', String(visit));
      await this.saveSettings();
    }
    this.prevVisit = visit;
    this.registerInterval(window.setInterval(() => {
      if (this.views().length) this.rememberVisit();
    }, 5 * 60 * 1000));
    this.colors = readColors(this.settings.usePywal);
    this.addSettingTab(new AtlasSettings(this.app, this));
    this.model = null;
    this.searchIndex = null;
    this.launchLoadingScreens = new WeakMap();
    this.lastFile = this.app.workspace.getActiveFile()?.path || null;

    this.registerView(VIEW_TYPE, (leaf) => new GalaxyView(leaf, this));
    this.addRibbonIcon(ICON, 'Open global galaxy', () => this.openGlobal());
    this.addCommand({ id: 'open-global', name: 'Open global galaxy', callback: () => this.openGlobal() });
    this.addCommand({ id: 'open-local', name: 'Open local galaxy', callback: () => this.openLocal() });

    // obsidian://accretion-atlas: the desktop launcher opens the galaxy as a window of its own; without
    // the launcher setting the link just opens the global galaxy
    this.registerObsidianProtocolHandler(VIEW_TYPE, (params) => {
      this.app.workspace.onLayoutReady(() => (this.settings.launcher ? this.openLauncherWindow(params?.transition) : this.openGlobal()));
    });
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
      if (this.renderHold) this.pendingCenter = f.path;
      else for (const v of this.views()) v.setCenter(f.path);
    }));
    this.syncLauncher();
    this.app.workspace.onLayoutReady(() => this.closeLauncherPopouts());
    this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
      if (this.soloLeaf && leaf && leaf !== this.soloLeaf && !this.exitingSolo) this.clearSolo();
    }));
    this.registerEvent(this.app.workspace.on('layout-change', () => {
      if (this.soloLeaf && !this.soloLeaf.containerEl?.isConnected) this.clearSolo();
    }));
    if (this.launcherColdStart) {
      document.body.classList.add('aat-solo');
      this.registerInterval(window.setTimeout(() => {
        if (!this.soloLeaf) document.body.classList.remove('aat-solo');
      }, 15000));
    }
    this.register(() => this.clearSolo());
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

  // ---- settings that change what the galaxy is built from ----
  // Parsed once per change: cluster rules and the task properties (null = tasks off)
  modelOptions() {
    if (this._modelOptions) return this._modelOptions;
    const st = this.settings;
    const list = (text) => String(text || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
    const tasks = st.tasks
      ? { statusKey: st.taskStatusKey || 'status', dueKey: st.taskDueKey || 'due', labelKey: st.taskLabelKey || '', open: list(st.taskOpen), partial: list(st.taskPartial), done: list(st.taskDone) }
      : null;
    return (this._modelOptions = { clusterRules: parseClusterRules(st.clusterRules), tasks });
  }

  // After a change of these settings: build the galaxy and the search index anew
  modelSettingsChanged = debounce(() => {
    this._modelOptions = null;
    this.searchIndex = null;
    for (const v of this.views()) v.overlay?.setTasksEnabled(!!this.settings.tasks);
    this.invalidate();
  }, 500, true);

  // ---- desktop launcher (setting "launcher", Linux only) ----
  syncLauncher() {
    const job = this.settings.launcher ? this.installLauncher() : this.removeLauncher();
    return job.catch((error) => console.warn('Accretion Atlas could not update the desktop launcher', error));
  }

  launcherPaths() {
    const base = this.app.vault.adapter.getBasePath?.();
    const home = process.env.HOME;
    if (process.platform !== 'linux' || !base || !home) return null;
    const dir = join(base, this.manifest.dir, 'launcher');
    return { base, home, dir, script: join(dir, 'launch.sh'), entry: join(process.env.XDG_DATA_HOME || join(home, '.local', 'share'), 'applications', DESKTOP_ENTRY) };
  }

  // Writes the launcher (script, loading screen, icon) into the plugin's folder and a desktop entry
  // that starts it. Only when something changed, so a synced vault stays quiet.
  async installLauncher() {
    const at = this.launcherPaths();
    if (!at) return;
    const { base, home, dir, script } = at;
    // Only for a vault the regular Obsidian knows: a second instance with its own profile (a test
    // copy of the vault) must not point the entry at itself. Where the list cannot be read
    // (other install paths), the vault counts as known.
    const list = await readFile(join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'obsidian', 'obsidian.json'), 'utf8').catch(() => null);
    if (list) {
      try {
        const strip = (p) => String(p || '').replace(/\/+$/, '');
        if (!Object.values(JSON.parse(list).vaults || {}).some((v) => strip(v.path) === strip(base))) return;
      } catch {
        return;
      }
    }
    await mkdir(dir, { recursive: true });
    const files = { 'launch.sh': launchScript, 'Launch.qml': launchQml, 'Starlight.qml': starlightQml, 'icon.svg': launcherIcon };
    for (const [name, text] of Object.entries(files)) {
      const file = join(dir, name);
      if ((await readFile(file, 'utf8').catch(() => null)) !== text) await writeFile(file, text);
    }
    await chmod(script, 0o755);
    const file = at.entry;
    const entry = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=Galaxy',
      'Comment=Open the Obsidian vault as a 3D galaxy',
      `Exec="${script}"`,
      `Icon=${join(dir, 'icon.svg')}`,
      'Terminal=false',
      'Categories=Office;',
      'Keywords=Galaxy;Obsidian;Vault;Accretion Atlas;',
      '',
    ].join('\n');
    const old = await readFile(file, 'utf8').catch(() => '');
    if (old === entry) return;
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, entry);
  }

  // Setting off: take the desktop entry away again, but only if it is the one of this vault
  async removeLauncher() {
    const at = this.launcherPaths();
    if (!at) return;
    const old = await readFile(at.entry, 'utf8').catch(() => '');
    if (old.includes(`Exec="${at.script}"`)) await rm(at.entry, { force: true });
  }

  rememberVisit() {
    this.saveLocal('lastVisit', String(Date.now()));
  }

  // Per device and vault (Obsidian's local storage), see onload
  loadLocal(key) {
    const k = 'accretion-atlas-' + key;
    return this.app.loadLocalStorage ? this.app.loadLocalStorage(k) : window.localStorage.getItem(this.app.vault.getName() + ':' + k);
  }

  saveLocal(key, value) {
    const k = 'accretion-atlas-' + key;
    if (this.app.saveLocalStorage) this.app.saveLocalStorage(k, value);
    else window.localStorage.setItem(this.app.vault.getName() + ':' + k, value);
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
    if (!this.model) this.model = buildModel(this.app, this.modelOptions());
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
  async openLauncherWindow(transitionId) {
    if (this.openingLauncherWindow) return;
    this.openingLauncherWindow = true;
    this.launcherColdStart = false;
    const ws = this.app.workspace;
    const desktop = desktopTransition(transitionId);
    let loading = desktop;
    try {
      this.closeLauncherPopouts();
      const editor = window.electronWindow;
      if (editor && !editor.isDestroyed()) {
        if (editor.isVisible() && !editor.isFocused()) editor.hide();
        editor.show();
      }
      let leaf = ws.getLeavesOfType(VIEW_TYPE).find((l) => l.getContainer() === ws.rootSplit && l.view?.mode !== 'local');
      const fresh = !leaf || !(leaf.view instanceof GalaxyView) || !leaf.view.galaxy;
      leaf ??= ws.getLeaf('tab');
      this.enterSolo(leaf);
      loading ??= fresh ? new LaunchLoadingScreen(document) : null;
      if (fresh && loading) {
        this.launchLoadingScreens.set(leaf, loading);
        await loading.waitForPaint?.();
      }
      if (!(leaf.view instanceof GalaxyView)) {
        await leaf.setViewState({ type: VIEW_TYPE, state: { mode: 'global' }, active: true });
      }
      await ws.revealLeaf(leaf);
      const view = leaf.view;
      if (!(view instanceof GalaxyView)) throw new Error('The galaxy view could not be loaded.');
      this.enterSolo(leaf);
      ws.setActiveLeaf(leaf, { focus: true });
      editor?.focus();
      if (fresh) {
        if (loading && this.launchLoadingScreens.get(leaf) === loading) {
          this.launchLoadingScreens.delete(leaf);
          view.launchLoading = loading;
          if (view.ready && !view.galaxy) view._rebuild();
        }
      } else {
        view.replayIntro(loading);
      }
      desktop?.didShowWindow();
    } catch (error) {
      loading?.dispose();
      this.clearSolo();
      console.error('Accretion Atlas could not open the launcher window', error);
      new Notice('Accretion Atlas could not open the galaxy.');
    } finally {
      this.openingLauncherWindow = false;
    }
  }
  closeLauncherPopouts() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.getContainer() instanceof WorkspaceWindow) leaf.detach();
    }
  }
  enterSolo(leaf) {
    if (this.soloLeaf && this.soloLeaf !== leaf) this.clearSolo();
    this.soloLeaf = leaf;
    document.body.classList.add('aat-solo');
    leaf.containerEl?.classList.add('aat-solo-leaf');
    if (leaf.view instanceof GalaxyView) leaf.view.setSolo(true);
  }
  clearSolo() {
    const leaf = this.soloLeaf;
    this.soloLeaf = null;
    document.body.classList.remove('aat-solo');
    leaf?.containerEl?.classList.remove('aat-solo-leaf');
    if (leaf?.view instanceof GalaxyView) leaf.view.setSolo(false);
  }
  async exitSolo({ origin, node, prepare, reveal }) {
    if (this.exitingSolo) return;
    this.exitingSolo = true;
    this.renderHold = true;
    const view = this.soloLeaf?.view instanceof GalaxyView ? this.soloLeaf.view : null;
    this.exitingView = view;
    const g = view?.galaxy;
    const saved = g?.saveView();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animate = !!view && !reduced;
    const wait = (ms) => new Promise((r) => window.setTimeout(r, ms));
    let lifted = false;
    try {
      if (animate) {
        view.root.classList.add('is-exiting');
        if (g && node) g.nudgeToward(node);
      }
      const ready = Promise.resolve()
        .then(() => prepare?.())
        .catch((error) => console.warn('Accretion Atlas could not prepare the note', error));
      if (animate) await wait(220);
      await Promise.race([ready, wait(animate ? 480 : 700)]);
      const at = (node && view?.originOf(node)) || origin;
      if (animate) {
        view.liftToOverlay(at);
        lifted = true;
      }
      this.clearSolo();
      await reveal?.();
      if (animate) await view.openHole();
    } catch (error) {
      console.warn('Accretion Atlas could not finish the transition', error);
      if (this.soloLeaf) this.clearSolo();
    } finally {
      if (lifted) view.settleOverlay();
      else view?.root.classList.remove('is-exiting');
      g?.restoreView(saved);
      this.exitingSolo = false;
      this.exitingView = null;
      this.renderHold = false;
      const center = this.pendingCenter;
      this.pendingCenter = null;
      if (center) window.setTimeout(() => {
        for (const v of this.views()) v.setCenter(center);
      }, 150);
    }
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
    return { path: f.path, name: f.basename, lname: f.basename.toLowerCase(), cluster: clusterOf(f.path, this.modelOptions().clusterRules).name, text: body, lower: body.toLowerCase(), raw: text, heads };
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

class AtlasSettings extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const el = this.containerEl;
    const plugin = this.plugin;
    const st = plugin.settings;
    el.empty();
    // A text setting that rebuilds the galaxy
    const text = (name, desc, key, placeholder) => new Setting(el).setName(name).setDesc(desc)
      .addText((t) => t.setPlaceholder(placeholder).setValue(st[key]).onChange((value) => {
        st[key] = value.trim();
        plugin.saveSettingsSoon();
        plugin.modelSettingsChanged();
      }));

    new Setting(el).setName('Colors').setHeading();
    new Setting(el)
      .setName('Use pywal colors')
      .setDesc('Use the colors from your active pywal CSS snippet, also for the nebulae. If the snippet is unavailable, use theme colors. When off, the nebulae use one fixed color.')
      .addToggle((toggle) => toggle.setValue(st.usePywal).onChange(async (enabled) => {
        st.usePywal = enabled;
        plugin.refreshColors();
        await plugin.saveSettings();
        this.display();
      }));
    if (!st.usePywal) {
      new Setting(el)
        .setName('Nebula color')
        .setDesc('Color of all nebulae while pywal colors are off.')
        .addColorPicker((picker) => picker.setValue(st.nebulaColor).onChange((hex) => plugin.setNebulaColor(hex)))
        .addExtraButton((button) => button.setIcon('rotate-ccw').setTooltip('Reset').onClick(() => {
          plugin.setNebulaColor(DEFAULT_NEBULA);
          this.display();
        }));
    }

    new Setting(el).setName('Clusters').setHeading();
    new Setting(el)
      .setName('Cluster folders')
      .setDesc('Each top-level folder is one cluster. To split a folder into several clusters, name the deeper folders here, one pattern per line. "*" stands for any folder name: "Projects/*" makes every folder inside Projects a cluster, "School/Year */*" every subject folder of every year. The first pattern that fits wins, so put the deeper ones first.')
      .addTextArea((area) => {
        area.setPlaceholder('Projects/*').setValue(st.clusterRules).onChange((value) => {
          st.clusterRules = value;
          plugin.saveSettingsSoon();
          plugin.modelSettingsChanged();
        });
        area.inputEl.rows = 4;
        area.inputEl.cols = 30;
      });

    new Setting(el).setName('Tasks').setHeading();
    new Setting(el)
      .setName('Show tasks')
      .setDesc('Notes with a state in their properties become tasks: open ones get their own color, overdue ones pulse, a filter shows only them and the greeting lists what is due next.')
      .addToggle((toggle) => toggle.setValue(st.tasks).onChange(async (enabled) => {
        st.tasks = enabled;
        await plugin.saveSettings();
        plugin.modelSettingsChanged();
        this.display();
      }));
    if (st.tasks) {
      text('State property', 'Name of the property that holds the state.', 'taskStatusKey', 'status');
      text('Open', 'Values of the state that mean open, separated by commas.', 'taskOpen', 'open, todo');
      text('Partly done', 'Values that mean partly done.', 'taskPartial', 'partial');
      text('Done', 'Values that mean done. Done tasks look like any other note.', 'taskDone', 'done');
      text('Due date property', 'Name of the property with the due date (YYYY-MM-DD).', 'taskDueKey', 'due');
      text('Label property', 'Optional: a property whose value is put in front of the title in the list of what is due next, such as a subject or project.', 'taskLabelKey', '');
    }

    new Setting(el).setName('Desktop launcher').setHeading();
    const linux = process.platform === 'linux';
    new Setting(el)
      .setName('Add the galaxy to the app launcher')
      .setDesc(linux
        ? 'Linux: adds an entry "Galaxy" to your app launcher that opens this vault\'s galaxy as a window of its own, with a button back to your notes. With Quickshell and Hyprland a loading screen covers the start. Turning this off removes the entry again.'
        : 'Only available on Linux.')
      .addToggle((toggle) => toggle.setDisabled(!linux).setValue(linux && st.launcher).onChange(async (enabled) => {
        st.launcher = enabled;
        await plugin.saveSettings();
        await plugin.syncLauncher();
      }));
  }
}
