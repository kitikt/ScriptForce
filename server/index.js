const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const { initBrowser, runPipeline } = require('./automation/pipeline');

const PORT = 3001;
const CLIENT_ORIGIN = 'http://localhost:5173';

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

app.use(
  cors({
    origin: CLIENT_ORIGIN,
  })
);
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

io.on('connection', (socket) => {
  console.log('Client connected');

  socket.on('init_browser', async () => {
    try {
      const { context, page } = await initBrowser(socket);
      browserContext = context;
      browserPage = page;

      page.once('close', () => {
        browserPage = null;
        console.error('[Server] Browser page was closed.');
        socket.emit('error', {
          stepNumber: 0,
          error: 'Browser was closed. Please click Connect Browser and login again.',
        });
      });

      context.once('close', () => {
        browserContext = null;
        browserPage = null;
        console.error('[Server] Browser context was closed.');
        socket.emit('error', {
          stepNumber: 0,
          error: 'Browser was closed. Please click Connect Browser and login again.',
        });
      });
    } catch (error) {
      console.error('[Server] init_browser failed:', error);
      socket.emit('error', {
        stepNumber: 0,
        error: error.message,
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
        error: error.message,
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
