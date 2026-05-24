const { app, BrowserWindow, dialog } = require('electron');
const http = require('http');
const net = require('net');
const path = require('path');

const DEFAULT_SERVER_PORT = Number(process.env.PORT || 3001);

let mainWindow = null;
let serverPort = DEFAULT_SERVER_PORT;
let serverUrl = `http://127.0.0.1:${serverPort}`;

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.focus();
});

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close(() => resolve(true));
    });

    server.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + 50; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(`Không tìm được port trống từ ${startPort} đến ${startPort + 49}.`);
}

function waitForServer(url, timeoutMs = 20000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tryRequest = () => {
      const request = http.get(`${url}/health`, (response) => {
        response.resume();

        if (response.statusCode >= 200 && response.statusCode < 500) {
          resolve();
          return;
        }

        retry();
      });

      request.on('error', retry);
      request.setTimeout(1500, () => {
        request.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('ScriptForge server did not start in time.'));
        return;
      }

      setTimeout(tryRequest, 500);
    };

    tryRequest();
  });
}

function configureServerEnvironment() {
  const appRoot = path.join(__dirname, '..');
  const clientDistDir = path.join(appRoot, 'client', 'dist');
  const dataDir = path.join(app.getPath('userData'), 'data');

  process.env.PORT = String(serverPort);
  process.env.CLIENT_ORIGIN = serverUrl;
  process.env.CLIENT_DIST_DIR = clientDistDir;
  process.env.SCRIPTFORGE_DATA_DIR = dataDir;
  process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '0';
}

async function startServer() {
  serverPort = await findAvailablePort(DEFAULT_SERVER_PORT);
  serverUrl = `http://127.0.0.1:${serverPort}`;
  configureServerEnvironment();
  require('../server/index');
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#151126',
    title: 'ScriptForge',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await mainWindow.loadURL(serverUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    await startServer();
    await waitForServer(serverUrl);
    await createMainWindow();
  } catch (error) {
    dialog.showErrorBox(
      'ScriptForge không mở được',
      `Không thể khởi động ScriptForge.\n\nChi tiết: ${error.message}`
    );
    app.quit();
  }
});

app.on('activate', () => {
  if (!mainWindow) {
    createMainWindow().catch((error) => {
      dialog.showErrorBox('ScriptForge không mở được', error.message);
    });
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
