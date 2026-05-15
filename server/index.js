const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const { initBrowser, runPipeline, stopPipeline } = require('./automation/pipeline');
const { waitForLogin } = require('./automation/browser');
const { createClaudeWebProvider } = require('./automation/providers/claudeWebProvider');
const { STEPS } = require('./prompts/templates');

const PORT = Number(process.env.PORT || 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

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

function isBrowserPageAlive(page) {
  return Boolean(
    page &&
    typeof page.isClosed === 'function' &&
    !page.isClosed()
  );
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
    return 'Chromium automation profile is already open or locked. Close the old automation Chromium window, then click Connect Browser again.';
  }

  if (message.length > 500) {
    return `${message.slice(0, 500)}...`;
  }

  return message;
}

async function emitExistingBrowserReady(socket) {
  socket.emit('status', 'Browser is already connected. Reusing the current Claude.ai session...');
  socket.emit('log', {
    time: new Date().toLocaleTimeString('en-GB'),
    message: 'Browser already connected. Reusing current session.',
  });

  await waitForLogin(browserPage);
  const webProvider = createClaudeWebProvider(browserPage);
  const projects = await webProvider.getProjects();

  socket.emit('login_success', { projects });
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
    socket.emit('error', {
      stepNumber: 0,
      error: 'Browser was closed. Please click Connect Browser and login again.',
    });
  });

  context.once('close', () => {
    browserContext = null;
    browserPage = null;
    browserCloseHandlersAttached = false;
    console.error('[Server] Browser context was closed.');
    socket.emit('error', {
      stepNumber: 0,
      error: 'Browser was closed. Please click Connect Browser and login again.',
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

io.on('connection', (socket) => {
  console.log('Client connected');

  socket.on('init_browser', async () => {
    try {
      if (isBrowserPageAlive(browserPage)) {
        await emitExistingBrowserReady(socket);
        return;
      }

      if (browserInitPromise) {
        socket.emit('status', 'Browser is already launching. Waiting for the current launch...');
        const { context, page } = await browserInitPromise;
        browserContext = context;
        browserPage = page;
        attachBrowserCloseHandlers(context, page, socket);
        await emitExistingBrowserReady(socket);
        return;
      }

      browserInitPromise = initBrowser(socket);

      try {
        const { context, page } = await browserInitPromise;
        browserContext = context;
        browserPage = page;
        attachBrowserCloseHandlers(context, page, socket);
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
      if (
        !browserPage ||
        typeof browserPage.isClosed !== 'function' ||
        browserPage.isClosed()
      ) {
        browserPage = null;
        browserContext = null;
        socket.emit('error', {
          stepNumber: 0,
          error: 'Browser is not initialized or has been closed. Please run init_browser first.',
        });
        return;
      }

      await runPipeline(browserPage, data, socket);
    } catch (error) {
      console.error('[Server] start_pipeline failed:', error);
      socket.emit('error', {
        stepNumber: 0,
        error: getClientErrorMessage(error),
      });
    }
  });

  socket.on('stop_pipeline', () => {
    console.log('[Server] Stop pipeline requested.');
    stopPipeline();
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
