import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const vinextCli = join(projectRoot, 'node_modules', 'vinext', 'dist', 'cli.js');
const localAiPort = process.env.BIBLE_LOCAL_AI_PORT || '4317';
const localToken = randomBytes(32).toString('base64url');
const childEnv = {
  ...process.env,
  BIBLE_LOCAL_AI_PORT: localAiPort,
  BIBLE_LOCAL_TOKEN: localToken,
  NEXT_PUBLIC_BIBLE_LOCAL_AI_PORT: localAiPort,
  NEXT_PUBLIC_BIBLE_LOCAL_TOKEN: localToken,
};

const children = [
  spawn(process.execPath, [vinextCli, 'dev'], { cwd: projectRoot, env: childEnv, stdio: 'inherit', windowsHide: true, detached: process.platform !== 'win32' }),
  spawn(process.execPath, [join(projectRoot, 'scripts', 'local-ai-server.mjs')], { cwd: projectRoot, env: childEnv, stdio: 'inherit', windowsHide: true, detached: process.platform !== 'win32' }),
];

let stopping = false;
function waitForExit(child, timeoutMs = 4_000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timeout);
      child.removeListener('close', done);
      resolve();
    }
    child.once('close', done);
  });
}

function posixGroupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

async function waitForPosixGroupExit(pid, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (posixGroupExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !posixGroupExists(pid);
}

async function terminateTree(child) {
  if (!child.pid) return;
  const pid = child.pid;
  if (process.platform === 'win32') {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      killer.once('error', () => {
        child.kill();
        resolve();
      });
      killer.once('close', resolve);
    });
    await waitForExit(child);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await waitForExit(child, 1_000);
    }
    return;
  }

  if (!posixGroupExists(pid)) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  const groupExited = await waitForPosixGroupExit(pid);
  if (!groupExited) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
  await waitForExit(child, 1_000);
}

async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  await Promise.allSettled(children.map(terminateTree));
  process.exit(exitCode);
}

for (const child of children) {
  child.on('error', (error) => {
    console.error(error.message);
    void stop(1);
  });
  child.on('exit', (code, signal) => {
    if (!stopping) void stop(code ?? (signal ? 1 : 0));
  });
}

process.on('SIGINT', () => { void stop(0); });
process.on('SIGTERM', () => { void stop(0); });
process.on('SIGHUP', () => { void stop(0); });
