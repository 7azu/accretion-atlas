import { build } from 'esbuild';
import { copyFile, readFile } from 'node:fs/promises';

// Ship the bundled libraries' copyright and license notices with the installed plugin.
const libraries = ['three', 'd3-force-3d', 'd3-binarytree', 'd3-octree', 'd3-quadtree', 'd3-dispatch', 'd3-timer'];
const notices = await Promise.all(libraries.map(async (name) =>
  name + '\n' + await readFile('node_modules/' + name + '/LICENSE', 'utf8')
));

notices.push('second-brain-black-hole\n' + await readFile('licenses/second-brain-black-hole.txt', 'utf8'));

await build({
  entryPoints: ['src/main.js'],
  outfile: 'dist/main.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['obsidian'],
  minify: true,
  legalComments: 'inline',
  footer: { js: '/*!\n' + notices.join('\n') + '\n*/' },
});
for (const asset of ['manifest.json', 'styles.css']) {
  await copyFile(asset, 'dist/' + asset);
}
