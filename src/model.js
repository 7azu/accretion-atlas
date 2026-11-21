// Build the galaxy and its dashboard statistics. Notes are large stars, level 1–3 headings are smaller stars, and linked attachments are faint points.
import { parseLinktext } from 'obsidian';

export const DAY = 86400000;
const MAX_LEVEL = 3;

export function clusterOf(path) {
  const dirs = path.split('/').slice(0, -1);
  if (!dirs.length) return { key: '', name: 'Vault', sub: 'Root folder' };
  return { key: '/' + dirs[0], name: dirs[0], sub: '' };
}

const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
export const pageIdOf = (n) => (n.type === 'section' ? n.page : n.id);

export function buildModel(app) {
  const mc = app.metadataCache;
  const files = app.vault.getMarkdownFiles();
  const nodes = new Map();
  const links = [];
  const clusters = new Map();
  const pageOf = new Map();
  const sectionsOf = new Map();

  const clusterFor = (path) => {
    const c = clusterOf(path);
    if (!clusters.has(c.key)) clusters.set(c.key, { ...c, pages: 0, ideas: 0 });
    return clusters.get(c.key);
  };

  // Collect notes and headings.
  for (const f of files) {
    const cl = clusterFor(f.path);
    const page = {
      id: f.path, type: 'page', name: f.basename, path: f.path, cluster: cl.key, level: 0,
      // Copying or syncing a file can reset its creation time. Use the earlier timestamp.
      mtime: f.stat.mtime, ctime: Math.min(f.stat.ctime || f.stat.mtime, f.stat.mtime), degree: 0, sections: 0, links: 0,
    };
    nodes.set(page.id, page);
    pageOf.set(f.path, page);
    cl.pages++;

    const cache = mc.getFileCache(f);
    const secs = [];
    const stack = [{ node: page, level: 0 }];
    const seen = new Map();
    // Link sections in document order, chaining siblings to form constellation lines.
    const lastChild = new Map();
    for (const h of cache?.headings ?? []) {
      if (h.level > MAX_LEVEL) continue;
      while (stack.length > 1 && stack[stack.length - 1].level >= h.level) stack.pop();
      const parent = stack[stack.length - 1].node;
      let id = `${f.path}#${h.heading}`;
      const k = (seen.get(id) || 0) + 1;
      seen.set(id, k);
      if (k > 1) id += `#${k}`;
      const sec = {
        id, type: 'section', name: h.heading, heading: h.heading, path: f.path, page: page.id,
        cluster: cl.key, level: h.level, mtime: f.stat.mtime, degree: 0,
      };
      nodes.set(id, sec);
      links.push({ source: lastChild.get(parent.id) || parent.id, target: id, kind: 'tree' });
      lastChild.set(parent.id, id);
      secs.push({ node: sec, line: h.position.start.line });
      stack.push({ node: sec, level: h.level });
    }
    page.sections = secs.length;
    cl.ideas += Math.max(1, secs.length);
    sectionsOf.set(f.path, secs);
  }

  // Resolve links from the containing section to the destination note or heading.
  const seenEdge = new Set();
  for (const f of files) {
    const cache = mc.getFileCache(f);
    if (!cache) continue;
    const page = pageOf.get(f.path);
    const secs = sectionsOf.get(f.path) || [];
    const sourceAt = (line) => {
      let s = page;
      for (const x of secs) {
        if (x.line <= line) s = x.node;
        else break;
      }
      return s;
    };
    const refs = [
      ...(cache.links || []).map((l) => [l, 'link']),
      ...(cache.embeds || []).map((l) => [l, 'embed']),
      ...(cache.frontmatterLinks || []).map((l) => [l, 'link']),
    ];
    for (const [ref, kind] of refs) {
      let lp, subpath;
      try {
        ({ path: lp, subpath } = parseLinktext(ref.link));
      } catch {
        continue;
      }
      const dest = lp ? mc.getFirstLinkpathDest(lp, f.path) : app.vault.getAbstractFileByPath(f.path);
      if (!dest) continue;
      const src = ref.position ? sourceAt(ref.position.start.line) : page;
      let target;
      if (dest.extension === 'md') {
        target = pageOf.get(dest.path);
        if (!target) continue;
        if (subpath) {
          const want = norm(subpath.split('#').filter(Boolean).pop() || '');
          const hit = (sectionsOf.get(dest.path) || []).find((x) => norm(x.node.heading) === want);
          if (hit) target = hit.node;
        }
      } else {
        target = nodes.get(dest.path);
        if (!target) {
          target = {
            id: dest.path, type: 'file', name: dest.name, path: dest.path, cluster: page.cluster,
            level: 4, mtime: dest.stat?.mtime ?? 0, degree: 0, ext: dest.extension,
          };
          nodes.set(dest.path, target);
        }
      }
      if (target === src) continue;
      if (target.type !== 'file' && pageIdOf(target) === page.id) continue; // Skip links within the same note.
      const key = src.id + '\u0000' + target.id;
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      links.push({ source: src.id, target: target.id, kind: kind === 'embed' || target.type === 'file' ? 'embed' : 'link' });
      // Count each connection once per note and track section and attachment degrees separately.
      page.degree++;
      page.links++;
      const tp = target.type === 'file' ? target : pageOf.get(pageIdOf(target));
      if (tp) tp.degree++;
      if (src !== page) src.degree++;
      if (target !== tp) target.degree++;
    }
  }

  const model = {
    nodes: [...nodes.values()],
    links,
    clusters: [...clusters.values()],
    byId: nodes,
  };
  model.stats = buildStats(model, [...pageOf.values()]);
  return model;
}

// Dashboard statistics
function bins(times, count, size, now, weights) {
  const out = new Array(count).fill(0);
  times.forEach((t, i) => {
    const k = Math.floor((now - t) / size);
    if (k >= 0 && k < count) out[count - 1 - k] += weights ? weights[i] : 1;
  });
  return out;
}

function buildStats(model, pages) {
  const now = Date.now();
  const linkEdges = model.links.filter((l) => l.kind !== 'tree');
  const ideas = model.clusters.reduce((s, c) => s + c.ideas, 0);
  const week = now - 7 * DAY;

  return {
    pages: pages.length,
    ideas,
    links: linkEdges.length,
    clusters: model.clusters.length,
    updatedWeek: pages.filter((p) => p.mtime > week).length,
    newWeek: pages.filter((p) => p.ctime > week).length,
    spark: {
      pages: bins(pages.map((p) => p.ctime), 10, 7 * DAY, now),
      ideas: bins(pages.map((p) => p.ctime), 10, 7 * DAY, now, pages.map((p) => Math.max(1, p.sections))),
      links: bins(pages.map((p) => p.ctime), 10, 7 * DAY, now, pages.map((p) => p.links)),
      updated: bins(pages.map((p) => p.mtime), 10, DAY, now),
    },
    byCluster: [...model.clusters].sort((a, b) => b.ideas - a.ideas),
    mostConnected: [...pages].sort((a, b) => b.degree - a.degree).slice(0, 6),
    recent: [...pages].sort((a, b) => b.mtime - a.mtime).slice(0, 6),
    pagesList: pages,
    activity: activity(pages, 84),
  };
}

// Calendar days in chronological order, ending today. Each file contributes its creation and most recent edit.
function activity(pages, days) {
  const first = new Date();
  first.setHours(0, 0, 0, 0);
  first.setDate(first.getDate() - (days - 1));
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    out.push({ t: d.getTime(), edited: [], created: 0 });
  }
  const index = (t) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - first.getTime()) / DAY);
  };
  for (const p of pages) {
    const e = index(p.mtime);
    if (e >= 0 && e < days) out[e].edited.push({ path: p.path, name: p.name, mtime: p.mtime });
    const c = index(p.ctime);
    if (c >= 0 && c < days) out[c].created++;
  }
  for (const d of out) d.edited.sort((a, b) => b.mtime - a.mtime);
  return out;
}

// The active note becomes the black hole. Include neighbors up to two steps away.
export function localModel(model, centerPath) {
  const center = model.byId.get(centerPath);
  if (!center || center.type !== 'page') return null;

  const adj = new Map();
  const addAdj = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a).add(b);
  };
  for (const l of model.links) {
    if (l.kind === 'tree') continue;
    const a = pageIdOf(model.byId.get(l.source) || { id: l.source, type: 'page' });
    const b = pageIdOf(model.byId.get(l.target) || { id: l.target, type: 'page' });
    if (a === b) continue;
    addAdj(a, b);
    addAdj(b, a);
  }

  const depth = new Map([[center.id, 0]]);
  for (const n of adj.get(center.id) || []) depth.set(n, 1);
  let d2 = 0;
  for (const [id, d] of [...depth]) {
    if (d !== 1) continue;
    for (const n of adj.get(id) || []) {
      if (depth.has(n) || d2 >= 140) continue;
      depth.set(n, 2);
      d2++;
    }
  }

  const keep = new Set();
  for (const n of model.nodes) {
    const pid = pageIdOf(n);
    if (!depth.has(pid)) continue;
    const d = depth.get(pid);
    if (n.type === 'section') {
      if (d === 0 || (d === 1 && n.level <= 2)) keep.add(n.id);
    } else keep.add(n.id);
  }

  const nodes = model.nodes.filter((n) => keep.has(n.id)).map((n) => ({
    ...n,
    depth: depth.get(pageIdOf(n)),
    cluster: pageIdOf(n) === center.id ? '__center' : n.cluster,
  }));
  const links = model.links.filter((l) => keep.has(l.source) && keep.has(l.target)).map((l) => ({ ...l }));

  const counts = new Map();
  for (const n of nodes) {
    if (n.cluster === '__center') continue;
    const c = counts.get(n.cluster) || { pages: 0, ideas: 0 };
    if (n.type === 'page') c.pages++;
    if (n.type === 'section') c.ideas++;
    counts.set(n.cluster, c);
  }
  const clusters = model.clusters
    .filter((c) => counts.has(c.key))
    .map((c) => ({ ...c, pages: counts.get(c.key).pages, ideas: Math.max(counts.get(c.key).ideas, counts.get(c.key).pages) }));
  clusters.push({ key: '__center', name: center.name, sub: '', pages: 1, ideas: center.sections });

  const out = { nodes, links, clusters, byId: new Map(nodes.map((n) => [n.id, n])), centerId: center.id };
  out.info = {
    name: center.name,
    path: center.path,
    cluster: model.clusters.find((c) => c.key === center.cluster),
    sections: center.sections,
    outgoing: [...(adj.get(center.id) || [])].length,
    depth1: [...depth.values()].filter((d) => d === 1).length,
    depth2: d2,
  };
  return out;
}

// Fingerprint the graph to skip redundant rebuilds.
export function signature(data) {
  let h = 0;
  const add = (s) => {
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  };
  for (const n of data.nodes) add(n.id);
  for (const l of data.links) add(l.source + '>' + l.target);
  return `${data.nodes.length}:${data.links.length}:${h}`;
}
