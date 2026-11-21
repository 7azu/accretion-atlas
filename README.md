# Accretion Atlas

Explore your notes as stars orbiting a black hole. The global galaxy groups notes by their top-level folder. Notes at the vault root share their own group. The local galaxy follows the active note and shows its linked neighbors up to two steps away. Headings and linked attachments appear alongside notes.

Open the galaxy from the ribbon or search for **Open global galaxy** or **Open local galaxy** in the command palette. Hover over a star to preview its note. The dashboard includes vault activity and full-text search.

## Colors

By default the graph uses your Obsidian theme. In **Settings → Accretion Atlas**, enable **Use pywal colors** to read RGB triplets from the CSS variables `--ctp-accent` and `--wal-graph-1` through `--wal-graph-7`. Enable your pywal CSS snippet in Obsidian for these variables to be available. Changes apply to open views. The dashboard also lets you select a chart color.

## Build and install

Requires desktop Obsidian and WebGL 2. Build with Node.js and npm.

```sh
npm ci
npm run build
```

For a manual installation, copy the three files in `dist/` into the vault's plugin directory under `accretion-atlas/`, reload Obsidian, and enable **Accretion Atlas** in Community plugins.

For a GitHub release, use the exact version from `manifest.json` as its tag and attach `dist/main.js`, `dist/manifest.json`, and `dist/styles.css` individually. The build embeds license notices for Three.js and the D3 libraries in the JavaScript bundle.
