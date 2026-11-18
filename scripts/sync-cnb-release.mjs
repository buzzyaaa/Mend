// Sync release assets to a CNB (cnb.cool) release via Open API.
// Usage: CNB_TOKEN=<token> node scripts/sync-cnb-release.mjs <org/repo> <tag> <files...>
// Creates the release if missing (reuses it otherwise), uploads each file with overwrite.
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

const API = 'https://api.cnb.cool';
const token = process.env.CNB_TOKEN;
const [repo, tag, ...files] = process.argv.slice(2);
if (!token || !repo || !tag || files.length === 0) {
  console.error('Usage: CNB_TOKEN=<token> node scripts/sync-cnb-release.mjs <org/repo> <tag> <files...>');
  process.exit(1);
}

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

let release;
try {
  release = await api('GET', `/${repo}/-/releases/tags/${tag}`);
  console.log(`Reusing CNB release ${release.id} for ${tag}`);
} catch {
  release = await api('POST', `/${repo}/-/releases`, {
    tag_name: tag,
    name: `Mend ${tag}`,
    body: `Mend ${tag} — mirror of the GitHub release. 国内下载镜像，产物与 GitHub Release 一致。`,
    draft: false,
    prerelease: false,
    make_latest: 'true',
  });
  console.log(`Created CNB release ${release.id} for ${tag}`);
}

for (const file of files) {
  const name = basename(file);
  const size = statSync(file).size;
  const { upload_url, verify_url } = await api(
    'POST',
    `/${repo}/-/releases/${release.id}/asset-upload-url`,
    { asset_name: name, size, overwrite: true },
  );
  const put = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: readFileSync(file),
  });
  if (!put.ok) throw new Error(`PUT ${name} -> ${put.status}: ${(await put.text()).slice(0, 500)}`);
  const confirm = verify_url.startsWith('http') ? verify_url : `${API}${verify_url}`;
  const sep = confirm.includes('?') ? '&' : '?';
  const res = await fetch(`${confirm}${sep}ttl=0`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`confirm ${name} -> ${res.status}: ${(await res.text()).slice(0, 500)}`);
  console.log(`Uploaded ${name} (${size} bytes)`);
}
console.log(`Done: https://cnb.cool/${repo}/-/releases`);