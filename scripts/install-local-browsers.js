const { spawnSync } = require('child_process');

const command = process.platform === 'win32'
  ? 'npx.cmd playwright install chromium'
  : 'npx playwright install chromium';
const result = spawnSync(command, {
  cwd: 'server',
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: '0',
  },
  shell: true,
  stdio: 'inherit',
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}
