const { chromium } = require('playwright');
const { execFile } = require('child_process');
const path = require('path');

const BROWSER_USER_DATA_DIR = path.join(__dirname, '..', 'browser-data');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      'Chromium automation profile is already open or locked. Close the old automation Chromium window, then click Connect Browser again.'
    );
    friendlyError.code = 'BROWSER_PROFILE_LOCKED';
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

async function createPersistentContext(userDataDir) {
  return chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: null,
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });
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
    return url === 'about:blank' || url === 'chrome://new-tab-page/';
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

  await page.bringToFront().catch(() => {});
  return page;
}

async function launchBrowser(options = {}) {
  const { recoverProfileLock = true } = options;
  const userDataDir = BROWSER_USER_DATA_DIR;
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

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  if (!isClaudePage(page)) {
    await page.goto('https://claude.ai', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
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
        const hasInput = await page.evaluate(() => {
          return !!document.querySelector('div[contenteditable="true"]');
        });

        if (hasInput) {
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
  isProfileAlreadyOpenError,
  launchBrowser,
  waitForLogin,
};
