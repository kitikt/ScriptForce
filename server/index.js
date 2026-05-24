const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { randomUUID } = require('crypto');
const { EventEmitter } = require('events');
const { Server } = require('socket.io');

const { initBrowser, runPipeline } = require('./automation/pipeline');
const { waitForLogin } = require('./automation/browser');
const {
  createProfile,
  deleteProfile,
  getActiveProfile,
  getProfilesState,
  renameProfile,
  switchProfile,
  toPublicProfilesState,
} = require('./automation/profiles');
const { createClaudeWebProvider } = require('./automation/providers/claudeWebProvider');
const { readClaudeUsage } = require('./automation/usage');
const { STEPS } = require('./prompts/templates');

const PORT = Number(process.env.PORT || 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const CLIENT_DIST_DIR = process.env.CLIENT_DIST_DIR || '';
const MAX_ACTIVE_PIPELINES = 2;
const USAGE_POLL_INTERVAL_MS = 30000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ['GET', 'POST'],
  },
});

let browserPage = null;
let browserContext = null;
let browserInitPromise = null;
let browserCloseHandlersAttached = false;
let browserClosingIntentionally = false;
let activeProfile = null;
let usagePage = null;
let usagePollTimer = null;
let usageRefreshPromise = null;
let latestUsage = null;
const pipelineJobs = new Map();

function isBrowserPageAlive(page) {
  return Boolean(
    page &&
    typeof page.isClosed === 'function' &&
    !page.isClosed()
  );
}

function isBrowserContextAlive(context) {
  try {
    return Boolean(context && Array.isArray(context.pages()));
  } catch {
    return false;
  }
}

function isPipelineActive(job) {
  return job && !['done', 'stopped', 'error'].includes(job.status);
}

function getActivePipelineCount() {
  return Array.from(pipelineJobs.values()).filter(isPipelineActive).length;
}

function getPublicJob(job) {
  return {
    pipelineId: job.pipelineId,
    status: job.status,
    config: {
      chatName: job.config.chatName,
      projectUrl: job.config.projectUrl,
      modelName: job.config.modelName,
      semiAuto: Boolean(job.config.semiAuto),
      adaptiveThinking: job.config.adaptiveThinking !== false,
      customPromptSteps: Array.isArray(job.config.customPromptSteps)
        ? job.config.customPromptSteps.map((step) => ({
            stepNumber: step.stepNumber,
            name: step.name,
          }))
        : [],
    },
    currentStep: job.currentStep,
    errorStep: job.errorStep || 0,
    reviewStep: job.reviewStep || null,
    statusMessage: job.statusMessage || '',
    logs: Array.isArray(job.logs) ? job.logs : [],
    steps: Object.values(job.results || {}).sort((a, b) => {
      const left = Number(a.stepNumber) || 0;
      const right = Number(b.stepNumber) || 0;
      return left - right;
    }),
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

function emitPipelineSnapshot(socket) {
  const jobs = Array.from(pipelineJobs.values()).map(getPublicJob);

  socket.emit('pipelines_snapshot', {
    jobs,
    activeCount: getActivePipelineCount(),
    maxActivePipelines: MAX_ACTIVE_PIPELINES,
  });
}

async function loadActiveProfile() {
  const active = await getActiveProfile();
  activeProfile = active.profile;
  return active;
}

async function emitProfiles(socket) {
  const state = await getProfilesState();
  socket.emit('profiles_update', toPublicProfilesState(state));
}

async function createPipelinePage(context) {
  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  return page;
}

async function createAutomationPage(context) {
  return createPipelinePage(context);
}

async function getReusableBrowserPage() {
  if (!isBrowserContextAlive(browserContext)) {
    return null;
  }

  if (isBrowserPageAlive(browserPage)) {
    return browserPage;
  }

  browserPage = await createPipelinePage(browserContext);
  await browserPage.goto('https://claude.ai', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  return browserPage;
}

async function getUsagePage() {
  if (!isBrowserContextAlive(browserContext)) {
    usagePage = null;
    throw new Error('Browser chưa được khởi tạo. Hãy kết nối browser trước khi đọc mức sử dụng.');
  }

  if (isBrowserPageAlive(usagePage)) {
    return usagePage;
  }

  usagePage = await createAutomationPage(browserContext);
  usagePage.once('close', () => {
    usagePage = null;
  });

  return usagePage;
}

async function refreshUsageNow() {
  if (usageRefreshPromise) {
    return usageRefreshPromise;
  }

  usageRefreshPromise = (async () => {
    const page = await getUsagePage();
    const usage = await readClaudeUsage(page);
    latestUsage = usage;
    io.emit('usage_update', usage);
    return usage;
  })();

  try {
    return await usageRefreshPromise;
  } finally {
    usageRefreshPromise = null;
  }
}

function startUsageMonitor() {
  if (latestUsage) {
    io.emit('usage_update', latestUsage);
  }

  if (!usagePollTimer) {
    usagePollTimer = setInterval(() => {
      refreshUsageNow().catch((error) => {
        console.warn('[Usage] Failed to refresh usage:', error.message);
        io.emit('usage_error', {
          error: getClientErrorMessage(error),
        });
      });
    }, USAGE_POLL_INTERVAL_MS);
  }

  refreshUsageNow().catch((error) => {
    console.warn('[Usage] Initial usage refresh failed:', error.message);
    io.emit('usage_error', {
      error: getClientErrorMessage(error),
    });
  });
}

function stopUsageMonitor() {
  if (usagePollTimer) {
    clearInterval(usagePollTimer);
    usagePollTimer = null;
  }

  usagePage = null;
  latestUsage = null;
}

async function closeBrowserContext() {
  browserClosingIntentionally = true;
  stopUsageMonitor();
  await browserContext?.close().catch(() => {});
  browserClosingIntentionally = false;
  browserContext = null;
  browserPage = null;
  browserInitPromise = null;
  usagePage = null;
  browserCloseHandlersAttached = false;
}

function ensureNoActivePipelines() {
  const activeCount = getActivePipelineCount();

  if (activeCount > 0) {
    throw new Error(`Hãy dừng ${activeCount} pipeline đang chạy trước khi đổi tài khoản Claude.`);
  }
}

function getClientErrorMessage(error) {
  const message = error?.message || 'Unknown automation error.';

  if (error?.code === 'BROWSER_PROFILE_LOCKED') {
    return message;
  }

  if (
    /Opening in existing browser session/i.test(message) ||
    /launchPersistentContext/i.test(message) ||
    /Target page, context or browser has been closed/i.test(message)
  ) {
    return 'Profile Chromium automation đang mở hoặc bị khóa. Hãy đóng cửa sổ Chromium cũ rồi bấm Kết nối browser lại.';
  }

  if (message.length > 500) {
    return `${message.slice(0, 500)}...`;
  }

  return message;
}

async function emitExistingBrowserReady(socket) {
  const profileLabel = activeProfile?.label || 'Claude profile';
  socket.emit('status', `Browser đã kết nối. Đang dùng lại ${profileLabel}...`);
  socket.emit('log', {
    time: new Date().toLocaleTimeString('en-GB'),
    message: `Browser đã kết nối. Đang dùng lại ${profileLabel}.`,
  });

  await waitForLogin(browserPage);
  const webProvider = createClaudeWebProvider(browserPage);
  const projects = await webProvider.getProjects();

  socket.emit('login_success', { projects });
  startUsageMonitor();
}

function attachBrowserCloseHandlers(context, page, socket) {
  if (browserCloseHandlersAttached) {
    return;
  }

  browserCloseHandlersAttached = true;

  page.once('close', () => {
    browserPage = null;
    browserCloseHandlersAttached = false;
    console.error('[Server] Browser page was closed.');
    if (!browserPage && !isBrowserContextAlive(context)) {
      socket.emit('error', {
        stepNumber: 0,
        error: 'Browser đã bị đóng. Vui lòng bấm Kết nối browser và đăng nhập lại.',
      });
    }
  });

  context.once('close', () => {
    browserContext = null;
    browserPage = null;
    stopUsageMonitor();
    browserCloseHandlersAttached = false;
    for (const job of pipelineJobs.values()) {
      if (isPipelineActive(job)) {
        job.status = 'error';
        job.stopped = true;
        job.finishedAt = new Date().toISOString();
      }
    }
    console.error('[Server] Browser context was closed.');
    if (browserClosingIntentionally) {
      return;
    }

    socket.emit('error', {
      stepNumber: 0,
      error: 'Browser đã bị đóng. Vui lòng bấm Kết nối browser và đăng nhập lại.',
    });
  });
}

function createJobSocket(socket, job) {
  return {
    emit(eventName, payload) {
      const targetPayload = payload;

      if (eventName === 'step_start') {
        job.currentStep = payload?.stepNumber || job.currentStep;
        job.status = 'running';
        job.errorStep = 0;
        job.reviewStep = null;
      }

      if (eventName === 'step_review') {
        job.currentStep = payload?.stepNumber || job.currentStep;
        job.status = 'review';
        job.reviewStep = {
          stepNumber: payload?.stepNumber,
          stepName: payload?.stepName,
        };
      }

      if (eventName === 'step_complete') {
        const stepNumber = payload?.stepNumber;
        if (stepNumber) {
          job.results[stepNumber] = {
            stepNumber,
            stepName: payload?.stepName || '',
            result: payload?.result || '',
          };
        }
        job.currentStep = stepNumber || job.currentStep;
        job.reviewStep = null;
      }

      if (eventName === 'pipeline_done') {
        job.status = 'done';
        job.results = payload?.results || job.results;
        job.reviewStep = null;
        job.finishedAt = new Date().toISOString();
      }

      if (eventName === 'pipeline_stopped') {
        job.status = 'stopped';
        job.results = payload?.results || job.results;
        job.reviewStep = null;
        job.finishedAt = new Date().toISOString();
      }

      if (eventName === 'error') {
        job.status = 'error';
        job.errorStep = payload?.stepNumber || job.currentStep || 0;
        job.finishedAt = new Date().toISOString();
      }

      if (eventName === 'status') {
        job.statusMessage = typeof payload === 'string' ? payload : payload?.message || job.statusMessage;
      }

      if (eventName === 'log') {
        const entry = {
          time: payload?.time || new Date().toLocaleTimeString('en-GB'),
          message: payload?.message || '',
        };
        job.logs.push(entry);
      }

      io.emit(eventName, targetPayload);
    },
    on(eventName, handler) {
      job.emitter.on(eventName, handler);
    },
    off(eventName, handler) {
      job.emitter.off(eventName, handler);
    },
  };
}

async function startPipelineJob(socket, config) {
  if (!isBrowserContextAlive(browserContext)) {
    browserContext = null;
    browserPage = null;
    socket.emit('error', {
      stepNumber: 0,
      error: 'Browser chưa được khởi tạo hoặc đã bị đóng. Vui lòng kết nối browser trước.',
    });
    return;
  }

  if (getActivePipelineCount() >= MAX_ACTIVE_PIPELINES) {
    socket.emit('pipeline_rejected', {
      error: `Chỉ có thể chạy tối đa ${MAX_ACTIVE_PIPELINES} pipeline cùng lúc.`,
      maxActivePipelines: MAX_ACTIVE_PIPELINES,
    });
    return;
  }

  const pipelineId = randomUUID();
  const page = await createPipelinePage(browserContext);
  const job = {
    pipelineId,
    page,
    config,
    status: 'starting',
    currentStep: 0,
    errorStep: 0,
    reviewStep: null,
    statusMessage: 'Pipeline đã được đưa vào hàng chạy.',
    logs: [
      {
        time: new Date().toLocaleTimeString('en-GB'),
        message: 'Pipeline đã được đưa vào hàng chạy từ client.',
      },
    ],
    results: {},
    emitter: new EventEmitter(),
    stopped: false,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    profileId: activeProfile?.id || null,
  };

  pipelineJobs.set(pipelineId, job);
  socket.emit('pipeline_started', {
    job: getPublicJob(job),
    activeCount: getActivePipelineCount(),
    maxActivePipelines: MAX_ACTIVE_PIPELINES,
  });

  const jobSocket = createJobSocket(socket, job);

  runPipeline(page, config, jobSocket, {
    pipelineId,
    shouldStop: () => job.stopped,
  })
    .then(() => {
      if (!job.finishedAt) {
        job.status = job.stopped ? 'stopped' : 'done';
        job.finishedAt = new Date().toISOString();
      }
    })
    .catch((error) => {
      console.error(`[Server] Pipeline ${pipelineId} failed:`, error);
      job.status = 'error';
      job.statusMessage = getClientErrorMessage(error);
      job.errorStep = job.currentStep || 0;
      job.finishedAt = new Date().toISOString();
      io.emit('pipeline_failed', {
        pipelineId,
        error: getClientErrorMessage(error),
      });
    })
    .finally(async () => {
      if (!job.finishedAt) {
        job.finishedAt = new Date().toISOString();
      }
      await page.close().catch(() => {});
      io.emit('pipeline_capacity', {
        activeCount: getActivePipelineCount(),
        maxActivePipelines: MAX_ACTIVE_PIPELINES,
      });
    });
}

app.use(
  cors({
    origin: CLIENT_ORIGIN,
  })
);
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/prompt-templates', (_req, res) => {
  res.json({
    steps: STEPS.map((step) => ({
      stepNumber: step.stepNumber,
      name: step.name,
      prompt: step.buildPrompt('{{originalScript}}'),
    })),
  });
});

if (CLIENT_DIST_DIR) {
  app.use(express.static(CLIENT_DIST_DIR));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST_DIR, 'index.html'));
  });
}

io.on('connection', (socket) => {
  console.log('Client connected');

  emitProfiles(socket).catch((error) => {
    socket.emit('profile_error', {
      error: getClientErrorMessage(error),
    });
  });
  emitPipelineSnapshot(socket);

  socket.on('list_pipelines', () => {
    emitPipelineSnapshot(socket);
  });

  socket.on('init_browser', async () => {
    try {
      const { profile } = await loadActiveProfile();
      await emitProfiles(socket);
      const reusablePage = isBrowserPageAlive(browserPage)
        ? browserPage
        : await getReusableBrowserPage();

      if (reusablePage) {
        browserPage = reusablePage;
        await emitExistingBrowserReady(socket);
        return;
      }

      if (browserInitPromise) {
        socket.emit('status', 'Browser đang được mở. Đang chờ phiên mở hiện tại...')
        const { context, page } = await browserInitPromise;
        browserContext = context;
        browserPage = page;
        attachBrowserCloseHandlers(context, page, socket);
        await emitExistingBrowserReady(socket);
        return;
      }

      socket.emit('status', `Đang mở Claude profile: ${profile.label}`);
      browserInitPromise = initBrowser(socket, {
        userDataDir: profile.userDataDir,
      });

      try {
        const { context, page } = await browserInitPromise;
        browserContext = context;
        browserPage = page;
        attachBrowserCloseHandlers(context, page, socket);
        startUsageMonitor();
        await switchProfile(profile.id);
        await emitProfiles(socket);
      } finally {
        browserInitPromise = null;
      }
    } catch (error) {
      console.error('[Server] init_browser failed:', error);
      socket.emit('error', {
        stepNumber: 0,
        error: getClientErrorMessage(error),
      });
    }
  });

  socket.on('start_pipeline', async (data) => {
    try {
      await startPipelineJob(socket, data);
    } catch (error) {
      console.error('[Server] start_pipeline failed:', error);
      socket.emit('error', {
        stepNumber: 0,
        error: getClientErrorMessage(error),
      });
    }
  });

  socket.on('list_profiles', async () => {
    try {
      await emitProfiles(socket);
    } catch (error) {
      socket.emit('profile_error', {
        error: getClientErrorMessage(error),
      });
    }
  });

  socket.on('create_profile', async (payload = {}) => {
    try {
      ensureNoActivePipelines();
      const { profile } = await createProfile(payload.label);
      activeProfile = profile;
      await closeBrowserContext();
      await emitProfiles(socket);
      socket.emit('status', `Đã tạo Claude profile: ${profile.label}. Bấm Kết nối browser để đăng nhập.`);
      socket.emit('profile_ready_for_login', {
        profile: {
          id: profile.id,
          label: profile.label,
        },
      });
    } catch (error) {
      socket.emit('profile_error', {
        error: getClientErrorMessage(error),
      });
    }
  });

  socket.on('switch_profile', async (payload = {}) => {
    try {
      ensureNoActivePipelines();
      const { profile } = await switchProfile(payload.profileId);
      activeProfile = profile;
      await closeBrowserContext();
      await emitProfiles(socket);
      socket.emit('status', `Đã chuyển sang Claude profile: ${profile.label}. Bấm Kết nối browser để sử dụng.`);
      socket.emit('profile_ready_for_login', {
        profile: {
          id: profile.id,
          label: profile.label,
        },
      });
    } catch (error) {
      socket.emit('profile_error', {
        error: getClientErrorMessage(error),
      });
    }
  });

  socket.on('rename_profile', async (payload = {}) => {
    try {
      await renameProfile(payload.profileId, payload.label);
      await emitProfiles(socket);
    } catch (error) {
      socket.emit('profile_error', {
        error: getClientErrorMessage(error),
      });
    }
  });

  socket.on('delete_profile', async (payload = {}) => {
    try {
      ensureNoActivePipelines();
      await deleteProfile(payload.profileId);
      await emitProfiles(socket);
    } catch (error) {
      socket.emit('profile_error', {
        error: getClientErrorMessage(error),
      });
    }
  });

  socket.on('request_usage', async () => {
    try {
      if (latestUsage) {
        socket.emit('usage_update', latestUsage);
      }

      await refreshUsageNow();
    } catch (error) {
      socket.emit('usage_error', {
        error: getClientErrorMessage(error),
      });
    }
  });

  for (const reviewEvent of ['review_continue', 'review_continue_auto', 'review_edit', 'review_redo']) {
    socket.on(reviewEvent, (payload = {}) => {
      const pipelineId = payload?.pipelineId;
      const job = pipelineId ? pipelineJobs.get(pipelineId) : null;

      if (!job || !isPipelineActive(job) || !job.emitter) {
        return;
      }

      job.emitter.emit(reviewEvent, payload);
    });
  }

  socket.on('stop_pipeline', (payload = {}) => {
    const pipelineId = payload?.pipelineId;

    if (!pipelineId) {
      console.log('[Server] Stop all active pipelines requested.');
      for (const job of pipelineJobs.values()) {
        if (isPipelineActive(job)) {
          job.stopped = true;
        }
      }
      return;
    }

    const job = pipelineJobs.get(pipelineId);
    if (!job || !isPipelineActive(job)) {
      return;
    }

    console.log(`[Server] Stop pipeline requested: ${pipelineId}`);
    job.stopped = true;
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
