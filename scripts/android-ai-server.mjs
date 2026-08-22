import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPersonalAiConfig } from './personal-ai-config.mjs';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const config = await loadPersonalAiConfig();

console.log('');
console.log('오늘의 말씀 개인용 AI 설교 서버');
console.log(`휴대폰 연결 주소: ${config.baseUrl}`);
console.log(`연결 코드: ${config.token}`);
console.log('이 창을 켜 둔 동안 휴대폰에서 새 설교를 만들 수 있습니다.');
console.log('');

const child = spawn(process.execPath, [join(projectRoot, 'scripts', 'local-ai-server.mjs')], {
  cwd: projectRoot,
  env: {
    ...process.env,
    BIBLE_LOCAL_AI_HOST: '0.0.0.0',
    BIBLE_LOCAL_AI_PORT: config.port,
    BIBLE_LOCAL_TOKEN: config.token,
  },
  stdio: 'inherit',
  windowsHide: false,
});

const stop = () => child.kill('SIGTERM');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => { process.exitCode = code ?? 0; });
