// Writes latest.json, the manifest installed copies of Fontier read to find an update.
// Run after a signed `npm run tauri build`: node scripts/latest-json.mjs "Release notes"
import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const dir = 'src-tauri/target/release/bundle/nsis';
const file = `Fontier_${version}_x64-setup.exe`;
const manifest = {
  version,
  notes: process.argv[2] ?? '',
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: readFileSync(`${dir}/${file}.sig`, 'utf8').trim(),
      url: `https://github.com/nitish-094s/fontier/releases/download/v${version}/${file}`,
    },
  },
};
writeFileSync(`${dir}/latest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(`${dir}/latest.json for ${version}`);
