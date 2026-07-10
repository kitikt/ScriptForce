const { chromium } = require('playwright');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const DATA_ROOT_DIR = process.env.SCRIPTFORGE_DATA_DIR || path.join(__dirname, '..');
const BROWSER_USER_DATA_DIR = path.join(DATA_ROOT_DIR, 'browser-data');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorDetails(error) {
  return [
    error?.message,
    error?.stderr,
    error?.stdout,
    error?.code ? `code=${error.code}` : '',
    error?.signal ? `signal=${error.signal}` : '',
  ].filter(Boolean).join(' | ');
}

function createFriendlyBrowserError(message, code, cause = null) {
  const error = new Error(message);
  error.code = code;
  error.cause = cause;
  return error;
}

function getPackagedAppRoot() {
  return path.resolve(__dirname, '..', '..');
}

function getCandidateAppRoots() {
  const roots = [
    getPackagedAppRoot(),
    path.resolve(__dirname, '..'),
    process.cwd(),
  ];

  if (process.resourcesPath) {
    roots.push(path.join(process.resourcesPath, 'app'));
  }

  return [...new Set(roots.filter(Boolean))];
}

function findBundledChromiumExecutable() {
  const browserRoots = getCandidateAppRoots()
    .flatMap((appRoot) => [
      path.join(appRoot, 'node_modules', 'playwright-core', '.local-browsers'),
      path.join(appRoot, 'node_modules', 'playwright', '.local-browsers'),
    ]);
  const checkedRoots = [];

  for (const browserRoot of browserRoots) {
    checkedRoots.push(browserRoot);

    if (!fs.existsSync(browserRoot)) {
      continue;
    }

    const chromiumDirs = fs.readdirSync(browserRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => /^chromium-\d+/i.test(name))
      .sort()
      .reverse();

    for (const chromiumDir of chromiumDirs) {
      const executablePath = path.join(browserRoot, chromiumDir, 'chrome-win64', 'chrome.exe');

      if (fs.existsSync(executablePath)) {
        return executablePath;
      }
    }
  }

  console.warn('[Browser] Bundled Chromium executable not found. Checked:', checkedRoots.join(' | '));
  return '';
}

function getChromiumPreflightFailureMessage(error, executablePath) {
  const rawDetails = getErrorDetails(error);
  const details = rawDetails.slice(0, 600);
  const lowerDetails = rawDetails.toLowerCase();
  const executableLine = executablePath ? `Chrome: ${executablePath}` : 'Chrome: không tìm thấy chrome.exe trong portable.';

  if (!executablePath || /enoent|not found|cannot find|không tìm thấy/i.test(rawDetails)) {
    return `Không tìm thấy Chromium bundled. ${executableLine} Cách sửa: tải lại file zip mới nhất, bấm Extract All/giải nén đầy đủ trước khi chạy, không chạy trực tiếp trong file zip.`;
  }

  if (/eacces|eperm|permission|access is denied|operation not permitted/i.test(rawDetails)) {
    return `Windows/antivirus đang chặn Chromium bundled. ${executableLine} Cách sửa: mở Windows Security > Protection history, Allow/Restore chrome.exe của ScriptForge, hoặc thêm thư mục ScriptForge-win32-x64 vào Exclusions rồi mở lại app. Chi tiết: ${details}`;
  }

  if (
    /vcruntime|msvcp|api-ms-win|ucrtbase|0xc0000135|0xc000007b|side-by-side|configuration is incorrect|dll/i
      .test(lowerDetails)
  ) {
    return `Máy sạch thiếu runtime/DLL để chạy Chromium. ${executableLine} Cách sửa: cài Microsoft Visual C++ Redistributable 2015-2022 x64, khởi động lại máy, rồi mở ScriptForge lại. Chi tiết: ${details}`;
  }

  if (/timed out|timeout/i.test(rawDetails)) {
    return `Chromium bundled không phản hồi khi kiểm tra trước khi mở. ${executableLine} Cách sửa: kiểm tra Windows Security/antivirus có đang scan hoặc chặn chrome.exe không; nếu có hãy Allow/Restore hoặc thêm Exclusion cho thư mục ScriptForge-win32-x64. Chi tiết: ${details}`;
  }

  return `Không chạy được Chromium bundled trên máy này. ${executableLine} Cách sửa nhanh: giải nén lại zip vào thư mục ngắn như C:\\ScriptForge, Allow trong Windows Security nếu bị chặn, cài Microsoft Visual C++ Redistributable 2015-2022 x64, rồi mở lại app. Chi tiết: ${details}`;
}

function createLaunchOptions(executablePath, options = {}) {
  return {
    headless: false,
    viewport: null,
    executablePath,
    timeout: 60000,
    args: [
      '--disable-blink-features=AutomationControlled',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  };
}

function isProfileAlreadyOpenError(error) {
  const message = error?.message || '';

  return (
    /Opening in existing browser session/i.test(message) ||
    (
      /launchPersistentContext/i.test(message) &&
      /Target page, context or browser has been closed/i.test(message)
    )
  );
}

function toFriendlyBrowserLaunchError(error) {
  if (isProfileAlreadyOpenError(error)) {
    const friendlyError = new Error(
      'Profile Chromium automation đang mở hoặc bị khóa. Hãy đóng cửa sổ Chromium cũ rồi bấm Kết nối browser lại.'
    );
    friendlyError.code = 'BROWSER_PROFILE_LOCKED';
    friendlyError.cause = error;
    return friendlyError;
  }

  if (/Timed out launching bundled Chromium/i.test(error?.message || '')) {
    const friendlyError = new Error(
      'Không mở được Chromium sau 60 giây. Máy này có thể đang bị antivirus/Windows Security chặn chrome.exe trong thư mục portable, hoặc file portable chưa được giải nén đầy đủ. Hãy giải nén lại zip, bỏ chặn thư mục ScriptForge-win32-x64, rồi mở lại app.'
    );
    friendlyError.code = 'BROWSER_LAUNCH_TIMEOUT';
    friendlyError.cause = error;
    return friendlyError;
  }

  return error;
}

function closeExistingProfileBrowsers(userDataDir) {
  return new Promise((resolve) => {
    const escapedProfile = userDataDir.replace(/'/g, "''");
    const command = `
$profile = '${escapedProfile}'.ToLowerInvariant()
$currentPid = $PID
$processes = Get-CimInstance Win32_Process |
  Where-Object {
    $_.ProcessId -ne $currentPid -and
    $_.Name -match '^(chrome|chromium|msedge)\\.exe$' -and
    $_.CommandLine -and
    $_.CommandLine.ToLowerInvariant().Contains($profile)
  }
foreach ($process in $processes) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  Write-Output $process.ProcessId
}
`;

    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true },
      (error, stdout) => {
        if (error) {
          console.warn('[Browser] Failed to close stale profile browser:', error.message);
          resolve([]);
          return;
        }

        const processIds = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        resolve(processIds);
      }
    );
  });
}

async function clearProfileLockFiles(userDataDir) {
  const lockNames = [
    'SingletonCookie',
    'SingletonLock',
    'SingletonSocket',
    'lockfile',
  ];
  const removed = [];

  for (const lockName of lockNames) {
    const lockPath = path.join(userDataDir, lockName);

    if (!fs.existsSync(lockPath)) {
      continue;
    }

    await fs.promises.rm(lockPath, { force: true, recursive: true }).catch(() => {});

    if (!fs.existsSync(lockPath)) {
      removed.push(lockName);
    }
  }

  return removed;
}

function unblockPortableFiles() {
  return new Promise((resolve) => {
    const appRoot = getPackagedAppRoot();
    const escapedRoot = appRoot.replace(/'/g, "''");
    const command = `
$root = '${escapedRoot}'
$files = Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue
$count = 0
foreach ($file in $files) {
  Unblock-File -LiteralPath $file.FullName -ErrorAction SilentlyContinue
  $count++
}
Write-Output $count
`;

    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true, timeout: 120000 },
      (error, stdout) => {
        if (error) {
          console.warn('[Browser] Failed to unblock portable files:', error.message);
          resolve({ ok: false, count: 0, error: error.message });
          return;
        }

        resolve({
          ok: true,
          count: Number(String(stdout || '').trim()) || 0,
          error: '',
        });
      }
    );
  });
}

function focusProfileBrowserWindow(userDataDir) {
  return new Promise((resolve) => {
    const escapedProfile = userDataDir.replace(/'/g, "''");
    const command = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ScriptForgeWindowFocus {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
}
"@
$profile = '${escapedProfile}'.ToLowerInvariant()
$deadline = (Get-Date).AddSeconds(8)
do {
  $processIds = Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -match '^(chrome|chromium|msedge)\\.exe$' -and
      $_.CommandLine -and
      $_.CommandLine.ToLowerInvariant().Contains($profile)
    } |
    Select-Object -ExpandProperty ProcessId
  $windowProcess = $processIds |
    ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue } |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Sort-Object StartTime |
    Select-Object -First 1
  if ($windowProcess) {
    [ScriptForgeWindowFocus]::ShowWindowAsync($windowProcess.MainWindowHandle, 9) | Out-Null
    [ScriptForgeWindowFocus]::BringWindowToTop($windowProcess.MainWindowHandle) | Out-Null
    [ScriptForgeWindowFocus]::SetForegroundWindow($windowProcess.MainWindowHandle) | Out-Null
    Write-Output $windowProcess.Id
    exit 0
  }
  Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)
`;

    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true },
      (error, stdout) => {
        if (error) {
          console.warn('[Browser] Failed to focus Chromium window:', error.message);
          resolve(null);
          return;
        }

        resolve(stdout.trim() || null);
      }
    );
  });
}

async function createPersistentContext(userDataDir) {
  const executablePath = findBundledChromiumExecutable();

  if (executablePath) {
    console.log('[Browser] Using bundled Chromium executable:', executablePath);
  } else {
    throw createFriendlyBrowserError(
      getChromiumPreflightFailureMessage(null, executablePath),
      'BUNDLED_CHROMIUM_NOT_FOUND'
    );
  }

  return chromium.launchPersistentContext(userDataDir, createLaunchOptions(executablePath));
}

async function repairChromiumLaunch(userDataDir = BROWSER_USER_DATA_DIR) {
  const closedProcessIds = await closeExistingProfileBrowsers(userDataDir);

  if (closedProcessIds.length > 0) {
    await sleep(1200);
  }

  const removedLocks = await clearProfileLockFiles(userDataDir);
  const unblockResult = await unblockPortableFiles();
  const executablePath = findBundledChromiumExecutable();

  if (!executablePath) {
    throw createFriendlyBrowserError(
      getChromiumPreflightFailureMessage(null, executablePath),
      'BUNDLED_CHROMIUM_NOT_FOUND'
    );
  }

  return {
    executablePath,
    closedProcessIds,
    removedLocks,
    unblockedFiles: unblockResult.count,
    unblockOk: unblockResult.ok,
    unblockError: unblockResult.error,
  };
}

function isClaudePage(page) {
  try {
    return /https:\/\/claude\.ai\//i.test(page.url());
  } catch {
    return false;
  }
}

function isBlankPage(page) {
  try {
    const url = page.url();
    return (
      url === 'about:blank' ||
      url === 'chrome://newtab/' ||
      url === 'chrome://new-tab-page/' ||
      url === 'chrome://new-tab-page' ||
      url.startsWith('chrome://new-tab-page-third-party/') ||
      url.startsWith('edge://newtab')
    );
  } catch {
    return false;
  }
}

async function selectAutomationPage(context) {
  const pages = context.pages();
  const claudePage = pages.find((page) => isClaudePage(page));
  const page = claudePage || pages.find((candidate) => !isBlankPage(candidate)) || pages[0] || await context.newPage();

  for (const candidate of pages) {
    if (candidate !== page && isBlankPage(candidate)) {
      await candidate.close().catch(() => {});
    }
  }

  return page;
}

async function launchBrowser(options = {}) {
  const {
    focusWindow = false,
    recoverProfileLock = true,
    userDataDir = BROWSER_USER_DATA_DIR,
  } = options;
  let context;

  if (recoverProfileLock) {
    const closedProcessIds = await closeExistingProfileBrowsers(userDataDir);

    if (closedProcessIds.length > 0) {
      console.warn(
        '[Browser] Closed existing Chromium profile process before launch:',
        closedProcessIds.join(', ')
      );
      await sleep(1200);
    }
  }

  try {
    context = await createPersistentContext(userDataDir);
  } catch (error) {
    if (!recoverProfileLock || !isProfileAlreadyOpenError(error)) {
      throw toFriendlyBrowserLaunchError(error);
    }

    console.warn('[Browser] Existing Chromium profile session detected. Closing stale profile process and retrying...');
    const closedProcessIds = await closeExistingProfileBrowsers(userDataDir);
    console.warn(
      '[Browser] Closed stale profile process ids:',
      closedProcessIds.length ? closedProcessIds.join(', ') : 'none'
    );
    await sleep(1200);

    try {
      context = await createPersistentContext(userDataDir);
    } catch (retryError) {
      throw toFriendlyBrowserLaunchError(retryError);
    }
  }

  const page = await selectAutomationPage(context);
  if (focusWindow) {
    await page.bringToFront().catch(() => {});
    await focusProfileBrowserWindow(userDataDir).catch(() => {});
  }

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  if (!isClaudePage(page)) {
    await page.goto('https://claude.ai', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    if (focusWindow) {
      await page.bringToFront().catch(() => {});
      await focusProfileBrowserWindow(userDataDir).catch(() => {});
    }
  }

  return { context, page };
}

async function waitForLogin(page) {
  console.log('Waiting for login... (you have 5 minutes)');

  const maxWait = 5 * 60 * 1000;
  const interval = 3000;
  let elapsed = 0;

  while (elapsed < maxWait) {
    try {
      const url = page.url();

      if (url.includes('claude.ai/new') || url.includes('claude.ai/chat') || url.includes('claude.ai/project')) {
        const hasLoggedInUi = await page.evaluate(() => {
          const bodyText = document.body?.innerText || '';
          const hasComposer = Boolean(
            document.querySelector(
              'div[contenteditable="true"], [contenteditable="true"], textarea, [role="textbox"]'
            )
          );
          const hasClaudeComposerText = /Type\s*\/\s*for skills/i.test(bodyText);
          const hasLoggedInChrome =
            /Sonnet|Opus|Haiku|Claude(?:'|’)s choice/i.test(bodyText) &&
            !/Sign in|Log in|Continue with Google/i.test(bodyText);

          return hasComposer || hasClaudeComposerText || hasLoggedInChrome;
        });

        if (hasLoggedInUi) {
          console.log('Login detected!');
          return true;
        }
      }
    } catch {
      // Page may be navigating between Claude routes.
    }

    await sleep(interval);
    elapsed += interval;

    if (elapsed % 30000 === 0) {
      console.log('Still waiting for login... ' + Math.round(elapsed / 1000) + 's');
    }
  }

  throw new Error('Login timeout after 5 minutes');
}

module.exports = {
  BROWSER_USER_DATA_DIR,
  closeExistingProfileBrowsers,
  focusProfileBrowserWindow,
  isProfileAlreadyOpenError,
  launchBrowser,
  repairChromiumLaunch,
  waitForLogin,
};
