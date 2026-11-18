// Sync release assets to a CNB (cnb.cool) release via Open API.
// Usage: CNB_TOKEN=<token> node scripts/sync-cnb-release.mjs <org/repo> <tag> <files...>
// Creates the release if missing (reuses it otherwise), uploads each file with overwrite.
import { createReadStream, statSync } from 'node:fs';
import { basename } from 'node:path';
import https from 'node:https';
import http from 'node:http';

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

// fetch 的 undici 默认 300s 响应头超时：跨洋上传大文件时服务端收完 body 才回头，
// 会误判超时。上传改用原生 https 流式请求，不设超时，由 CI job 超时兜底。
function putFile(url, file, size) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.request(
      url,
      { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': size } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () =>
          res.statusCode >= 200 && res.statusCode < 300
            ? resolve()
            : reject(new Error(`PUT ${basename(file)} -> ${res.statusCode}: ${body.slice(0, 500)}`)),
        );
      },
    );
    req.on('error', reject);
    createReadStream(file).pipe(req);
  });
}

async function withRetry(label, fn, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw err;
      console.warn(`${label} failed (attempt ${i}/${attempts}): ${err.message}; retrying...`);
      await new Promise((r) => setTimeout(r, 5000 * i));
    }
  }
}

for (const file of files) {
  const name = basename(file);
  const size = statSync(file).size;
  await withRetry(`upload ${name}`, async () => {
    const { upload_url, verify_url } = await api(
      'POST',
      `/${repo}/-/releases/${release.id}/asset-upload-url`,
      { asset_name: name, size, overwrite: true },
    );
    await putFile(upload_url, file, size);
    const confirm = verify_url.startsWith('http') ? verify_url : `${API}${verify_url}`;
    const sep = confirm.includes('?') ? '&' : '?';
    const res = await fetch(`${confirm}${sep}ttl=0`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`confirm ${name} -> ${res.status}: ${(await res.text()).slice(0, 500)}`);
  });
  console.log(`Uploaded ${name} (${size} bytes)`);
}
console.log(`Done: https://cnb.cool/${repo}/-/releases`);