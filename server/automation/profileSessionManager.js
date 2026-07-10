const { focusProfileBrowserWindow, launchBrowser, waitForLogin } = require('./browser');
const { createClaudeWebProvider } = require('./providers/claudeWebProvider');
const { getUsageBlock, readClaudeUsage } = require('./usage');

const IDLE_CLOSE_MS = 5 * 60 * 1000;
const USAGE_RECHECK_MS = 60 * 1000;
const RESPONSE_SLOT_POLL_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createStoppedError() {
  const error = new Error('Pipeline da duoc dung boi nguoi dung.');
  error.name = 'PipelineStoppedError';
  error.code = 'PIPELINE_STOPPED';
  return error;
}

function isPageAlive(page) {
  return Boolean(page && typeof page.isClosed === 'function' && !page.isClosed());
}

function isContextAlive(context) {
  try {
    return Boolean(context && Array.isArray(context.pages()));
  } catch {
    return false;
  }
}

async function createAutomationPage(context) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  return page;
}

function createProfileSessionManager(options = {}) {
  const {
    io,
    getClientErrorMessage = (error) => error?.message || 'Unknown browser error.',
    hasActivePipelines = () => false,
    onUnexpectedClose = () => {},
  } = options;
  const sessions = new Map();

  function getOrCreate(profile) {
    let session = sessions.get(profile.id);
    if (!session) {
      session = {
        profileId: profile.id,
        profile,
        context: null,
        controlPage: null,
        usagePage: null,
        initPromise: null,
        idleTimer: null,
        closing: false,
        status: 'disconnected',
        projects: [],
        usage: null,
        usageBlock: null,
        responseBusy: false,
        responseOwner: null,
        waitingResponses: 0,
        error: '',
      };
      sessions.set(profile.id, session);
    } else {
      session.profile = profile;
    }
    return session;
  }

  function toPublic(session) {
    return {
      profileId: session.profileId,
      status: session.status,
      connected: isContextAlive(session.context),
      projects: session.projects,
      usage: session.usage,
      usageBlock: session.usageBlock,
      responseBusy: session.responseBusy,
      responseOwner: session.responseOwner,
      waitingResponses: session.waitingResponses,
      error: session.error,
    };
  }

  function emitSession(session, socket = io) {
    socket?.emit('profile_session_update', toPublic(session));
  }

  function clearIdleTimer(session) {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
  }

  function attachCloseHandler(session) {
    session.context.once('close', () => {
      const wasIntentional = session.closing;
      session.context = null;
      session.controlPage = null;
      session.usagePage = null;
      session.initPromise = null;
      session.closing = false;
      session.status = 'disconnected';
      clearIdleTimer(session);
      emitSession(session);
      if (!wasIntentional) {
        onUnexpectedClose(session.profileId);
      }
    });
  }

  async function cleanupFailedSession(session) {
    clearIdleTimer(session);
    const context = session.context;
    session.closing = true;
    session.context = null;
    session.controlPage = null;
    session.usagePage = null;
    session.responseBusy = false;
    session.responseOwner = null;
    session.waitingResponses = 0;

    if (context) {
      await context.close().catch(() => {});
    }

    session.closing = false;
  }

  async function connect(profile, socket = io, options = {}) {
    const session = getOrCreate(profile);
    const focusWindow = Boolean(options.focusWindow);
    clearIdleTimer(session);

    if (isContextAlive(session.context)) {
      session.status = 'connected';
      if (focusWindow) {
        await focusProfileBrowserWindow(profile.userDataDir).catch(() => {});
      }
      emitSession(session, socket);
      return session;
    }

    if (session.initPromise) {
      if (focusWindow) {
        await focusProfileBrowserWindow(profile.userDataDir).catch(() => {});
      }
      await session.initPromise;
      emitSession(session, socket);
      return session;
    }

    session.status = 'connecting';
    session.error = '';
    emitSession(session);

    session.initPromise = (async () => {
      try {
        const { context, page } = await launchBrowser({
          focusWindow,
          userDataDir: profile.userDataDir,
        });
        session.context = context;
        session.controlPage = page;
        attachCloseHandler(session);
        await waitForLogin(page);
        const provider = createClaudeWebProvider(page);
        session.projects = await provider.getProjects();
        session.status = 'connected';
        session.error = '';
        emitSession(session);
        return session;
      } catch (error) {
        await cleanupFailedSession(session);
        session.status = 'error';
        session.error = getClientErrorMessage(error);
        emitSession(session);
        throw error;
      } finally {
        session.initPromise = null;
      }
    })();

    return session.initPromise;
  }

  async function createPipelinePage(profile, socket = io) {
    const session = await connect(profile, socket);
    clearIdleTimer(session);
    const page = await createAutomationPage(session.context);
    const provider = createClaudeWebProvider(page);

    return {
      ...provider,
      close: (...args) => page.close(...args),
      goto: (...args) => page.goto(...args),
      isClosed: () => page.isClosed(),
      url: () => page.url(),
      async sendPrompt(prompt, options = {}) {
        await waitForUsage(profile, socket, options);
        await acquireResponseSlot(session, socket, options);
        try {
          return await provider.sendPrompt(prompt, options);
        } finally {
          releaseResponseSlot(session);
        }
      },
      async waitForAccountReady(error, options = {}) {
        return waitForAccountReady(profile, socket, error, options);
      },
    };
  }

  async function refreshUsage(profile, socket = io) {
    const session = await connect(profile, socket);
    clearIdleTimer(session);

    if (!isPageAlive(session.usagePage)) {
      session.usagePage = await createAutomationPage(session.context);
      session.usagePage.once('close', () => {
        session.usagePage = null;
      });
    }

    session.usage = await readClaudeUsage(session.usagePage);
    session.usageBlock = getUsageBlock(session.usage);
    socket?.emit('usage_update', {
      profileId: profile.id,
      usage: session.usage,
    });
    return session.usage;
  }

  async function acquireResponseSlot(session, socket, options = {}) {
    const pipelineId = options.pipelineId || null;
    let announced = false;
    session.waitingResponses += 1;
    emitSession(session);

    try {
      while (session.responseBusy) {
        if (options.shouldStop?.()) {
          throw createStoppedError();
        }
        if (!announced) {
          options.onWait?.('Đang chờ pipeline khác của cùng tài khoản hoàn thành phản hồi...');
          announced = true;
        }
        await sleep(RESPONSE_SLOT_POLL_MS);
      }

      if (options.shouldStop?.()) {
        throw createStoppedError();
      }

      session.responseBusy = true;
      session.responseOwner = pipelineId;
      emitSession(session);
    } finally {
      session.waitingResponses = Math.max(0, session.waitingResponses - 1);
      emitSession(session);
    }
  }

  function releaseResponseSlot(session) {
    session.responseBusy = false;
    session.responseOwner = null;
    emitSession(session);
  }

  async function waitForUsage(profile, socket, options = {}) {
    const session = getOrCreate(profile);

    while (session.usageBlock) {
      if (options.shouldStop?.()) {
        throw createStoppedError();
      }

      const resetLabel =
        session.usageBlock.resetText ||
        (session.usageBlock.resetsAt
          ? `reset lúc ${new Date(session.usageBlock.resetsAt).toLocaleString()}`
          : 'đang chờ Claude reset usage');
      options.onWait?.(
        `Tài khoản đã hết usage (${session.usageBlock.usedPercent}%). ${resetLabel}. ScriptForge sẽ tự kiểm tra lại.`
      );

      const waitUntil = Date.now() + USAGE_RECHECK_MS;
      while (Date.now() < waitUntil) {
        if (options.shouldStop?.()) {
          throw createStoppedError();
        }
        await sleep(Math.min(1000, waitUntil - Date.now()));
      }

      await refreshUsage(profile, socket).catch((error) => {
        session.error = getClientErrorMessage(error);
        emitSession(session);
      });
    }
  }

  async function waitForAccountReady(profile, socket, error, options = {}) {
    const session = getOrCreate(profile);
    await refreshUsage(profile, socket).catch(() => null);
    let usageBlock = getUsageBlock(session.usage, options.modelName);

    if (!usageBlock && error?.code === 'CLAUDE_USAGE_LIMIT') {
      const currentMetric =
        session.usage?.currentSession ||
        (Array.isArray(session.usage?.weekly) ? session.usage.weekly[0] : null);
      usageBlock = {
        blocked: true,
        label: currentMetric?.label || 'Claude usage',
        usedPercent: currentMetric?.usedPercent ?? 100,
        resetsAt: currentMetric?.resetsAt || null,
        resetText: currentMetric?.resetText || '',
      };
    }

    if (usageBlock) {
      session.usageBlock = usageBlock;
      emitSession(session);
      await waitForUsage(profile, socket, options);
      return { reason: 'usage-reset' };
    }

    const delayMs = Math.min(
      60000,
      Math.max(10000, Number(options.retryCount || 1) * 10000)
    );
    options.onWait?.(
      `Claude vẫn có phản hồi khác đang chạy. Đang chờ ${Math.round(delayMs / 1000)} giây trước khi kiểm tra lại.`
    );
    const waitUntil = Date.now() + delayMs;
    while (Date.now() < waitUntil) {
      if (options.shouldStop?.()) {
        throw createStoppedError();
      }
      await sleep(Math.min(1000, waitUntil - Date.now()));
    }
    return { reason: 'concurrency-backoff', error: error?.message || '' };
  }

  async function close(profileId) {
    const session = sessions.get(profileId);
    if (!session) {
      return;
    }
    clearIdleTimer(session);
    session.closing = true;
    await session.context?.close().catch(() => {});
    session.context = null;
    session.controlPage = null;
    session.usagePage = null;
    session.status = 'disconnected';
    session.responseBusy = false;
    session.responseOwner = null;
    session.waitingResponses = 0;
    session.closing = false;
    emitSession(session);
  }

  function scheduleIdleClose(profileId) {
    const session = sessions.get(profileId);
    if (!session || !isContextAlive(session.context)) {
      return;
    }
    clearIdleTimer(session);
    session.idleTimer = setTimeout(() => {
      if (!hasActivePipelines(profileId)) {
        close(profileId).catch(() => {});
      }
    }, IDLE_CLOSE_MS);
  }

  function getPublicSessions() {
    return Array.from(sessions.values()).map(toPublic);
  }

  function remove(profileId) {
    return close(profileId).finally(() => {
      sessions.delete(profileId);
    });
  }

  return {
    connect,
    createPipelinePage,
    getPublicSessions,
    refreshUsage,
    remove,
    scheduleIdleClose,
  };
}

module.exports = {
  IDLE_CLOSE_MS,
  USAGE_RECHECK_MS,
  createProfileSessionManager,
};
