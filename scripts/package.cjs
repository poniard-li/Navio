'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

(async () => {
  const { packager } = await import('@electron/packager');
  const pkg = require('../package.json');
  const outputs = path.resolve(root, '..');
  const stage = path.resolve(root, '../../work', `package-${Date.now()}`);
  if (!stage.startsWith(path.resolve(root, '../../work') + path.sep)) throw new Error('Invalid build path');
  await fs.mkdir(stage, { recursive: true });
  for (const name of ['electron', 'renderer', 'shared']) await fs.cp(path.join(root, name), path.join(stage, name), { recursive: true, dereference: true });
  await fs.mkdir(path.join(stage, 'scripts'), { recursive: true });
  for (const name of ['proxy-state.ps1', 'proxy-watchdog.ps1']) await fs.copyFile(path.join(root, 'scripts', name), path.join(stage, 'scripts', name));
  // Resolve pnpm's symlink into a normal production dependency for the portable app.
  await fs.cp(await fs.realpath(path.join(root, 'node_modules/yaml')), path.join(stage, 'node_modules/yaml'), { recursive: true, dereference: true });
  const manifest = { ...pkg }; delete manifest.devDependencies; delete manifest.scripts;
  await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify(manifest, null, 2));
  const cache = path.join(process.env.LOCALAPPDATA || '', 'electron', 'Cache');
  let electronZipDir;
  try {
    for (const item of await fs.readdir(cache, { withFileTypes: true })) {
      if (!item.isDirectory()) continue;
      const dir = path.join(cache, item.name);
      if ((await fs.readdir(dir)).includes(`electron-v${pkg.devDependencies.electron}-win32-x64.zip`)) { electronZipDir = dir; break; }
    }
  } catch {}
  const results = await packager({ dir: stage, out: outputs, name: 'DEX-STUDIO', executableName: 'D.E.X STUDIO', appVersion: pkg.version, buildVersion: pkg.version, platform: 'win32', arch: 'x64', electronVersion: pkg.devDependencies.electron, ...(electronZipDir ? { electronZipDir } : {}), asar: false, prune: false, overwrite: true, icon: path.join(root, 'resources/icon.ico'), extraResource: [path.join(root, 'resources/core'), path.join(root, 'resources/THIRD-PARTY-NOTICES.txt'), path.join(root, 'resources/icon.png')], win32metadata: { CompanyName: 'D.E.X STUDIO', FileDescription: 'D.E.X STUDIO Network Client', ProductName: 'D.E.X STUDIO', OriginalFilename: 'D.E.X STUDIO.exe' } });
  for (const directory of results) await fs.copyFile(path.join(root, '使用说明.txt'), path.join(directory, '使用说明.txt'));
  console.log(JSON.stringify({ packaged: results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
