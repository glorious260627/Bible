import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const configDirectory = join(projectRoot, '.local');
const configPath = join(configDirectory, 'personal-ai.json');

function privateIpv4Address() {
  const candidates = Object.entries(networkInterfaces()).flatMap(([name, entries]) => (entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => ({ name, address: entry.address })));
  const preferred = candidates.find((entry) => /wi-?fi|wireless|wlan/i.test(entry.name))
    ?? candidates.find((entry) => /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(entry.address))
    ?? candidates[0];
  if (!preferred) throw new Error('같은 와이파이에서 사용할 PC의 IPv4 주소를 찾지 못했습니다.');
  return preferred.address;
}

export async function loadPersonalAiConfig() {
  let saved = {};
  try {
    saved = JSON.parse(await readFile(configPath, 'utf8'));
  } catch {
    saved = {};
  }

  const port = String(process.env.BIBLE_LOCAL_AI_PORT || saved.port || '4317');
  const token = String(process.env.BIBLE_LOCAL_TOKEN || saved.token || randomBytes(24).toString('base64url'));
  const baseUrl = String(process.env.BIBLE_LOCAL_AI_PUBLIC_URL || `http://${privateIpv4Address()}:${port}`);
  const next = { port, token, baseUrl };
  await mkdir(configDirectory, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return next;
}
