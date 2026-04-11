const { launchBrowser, waitForLogin } = require('./browser');
const {
  getProjects,
  navigateToProject,
  selectModel,
  renameChat,
  sendMessage,
  waitForResponse,
} = require('./claude');
const { STEPS } = require('../prompts/templates');

const STEP_TIMEOUT_RETRY_LIMIT = 1;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function randomStepDelay() {
  const delayMs = Math.floor(Math.random() * (15000 - 5000 + 1)) + 5000;
  console.log(`[Pipeline] Waiting ${delayMs}ms before next step...`);
  await sleep(delayMs);
}

function emitSocketEvent(socket, eventName, payload) {
  if (socket && typeof socket.emit === 'function') {
    socket.emit(eventName, payload);
  }
}

function emitLog(socket, message) {
  emitSocketEvent(socket, 'log', {
    time: new Date().toLocaleTimeString('en-GB'),
    message,
  });
}

function emitUrlLog(socket, page) {
  let currentUrl = 'unknown';
  try {
    currentUrl = page.url();
  } catch (error) {
    currentUrl = `unavailable (${error.message})`;
  }

  emitSocketEvent(socket, 'log', {
    time: new Date().toISOString(),
    message: '↳ URL: ' + currentUrl,
  });
}

function ensurePageAvailable(page) {
  if (!page || typeof page.isClosed !== 'function' || page.isClosed()) {
    throw new Error('Browser page is closed. Please reconnect the browser.');
  }
}

function isClaudeTimeoutError(error) {
  const message = error?.message || '';
  return /timed out waiting for claude response/i.test(message);
}

async function executeStep(page, step, config, socket) {
  const { stepNumber, name: stepName } = step;
  let attempt = 0;

  while (attempt <= STEP_TIMEOUT_RETRY_LIMIT) {
    try {
      ensurePageAvailable(page);

      if (attempt > 0) {
        emitSocketEvent(
          socket,
          'status',
          `Claude timeout at step ${stepNumber}. Retrying ${attempt}/${STEP_TIMEOUT_RETRY_LIMIT}...`
        );
        emitLog(
          socket,
          `Claude timeout at step ${stepNumber}. Retrying attempt ${attempt}/${STEP_TIMEOUT_RETRY_LIMIT}.`
        );
        emitUrlLog(socket, page);
      }

      const prompt = step.buildPrompt(config.originalScript);
      emitLog(socket, `Sending prompt for step ${stepNumber}: ${stepName}`);
      emitUrlLog(socket, page);
      await sendMessage(page, prompt);
      emitLog(socket, 'Message sent.');
      emitUrlLog(socket, page);

      emitLog(socket, `Waiting for Claude response at step ${stepNumber}: ${stepName}`);
      emitUrlLog(socket, page);
      const response = await waitForResponse(page);
      emitLog(socket, 'Response received.');
      emitUrlLog(socket, page);
      return response;
    } catch (error) {
      if (isClaudeTimeoutError(error) && attempt < STEP_TIMEOUT_RETRY_LIMIT) {
        attempt += 1;
        console.warn(
          `[Pipeline] Claude timeout on step ${stepNumber}, retrying attempt ${attempt}/${STEP_TIMEOUT_RETRY_LIMIT}...`
        );
        await sleep(2000);
        continue;
      }

      throw error;
    }
  }
}

async function initBrowser(socket) {
  try {
    console.log('[Pipeline] Launching browser...');
    emitLog(socket, 'Launching browser...');
    const { context, page } = await launchBrowser();

    console.log('[Pipeline] Waiting for manual login...');
    emitLog(socket, 'Waiting for manual login...');
    await waitForLogin(page);

    console.log('[Pipeline] Login complete, fetching projects...');
    emitLog(socket, 'Login complete. Fetching projects...');
    const projects = await getProjects(page);

    emitSocketEvent(socket, 'login_success', { projects });

    return { context, page };
  } catch (error) {
    console.error('[Pipeline] initBrowser failed:', error);
    emitSocketEvent(socket, 'error', {
      stepNumber: 0,
      error: error.message,
    });
    throw error;
  }
}

async function runPipeline(page, config, socket) {
  const results = {};

  try {
    ensurePageAvailable(page);
    console.log('[Pipeline] Starting pipeline with config:', config);
    emitLog(socket, 'Pipeline started.');
    emitUrlLog(socket, page);

    emitSocketEvent(socket, 'status', 'Navigating to project...');
    emitLog(socket, `Navigating to project: ${config.projectUrl}`);
    emitUrlLog(socket, page);
    await navigateToProject(page, config.projectUrl);
    emitLog(socket, 'Project navigation finished.');
    emitUrlLog(socket, page);

    emitSocketEvent(socket, 'status', 'Selecting model...');
    emitLog(socket, `Selecting model: ${config.modelName}`);
    emitUrlLog(socket, page);
    await selectModel(page, config.modelName);
    emitLog(socket, 'Model selection finished.');
    emitUrlLog(socket, page);

    for (const step of STEPS) {
      const { stepNumber, name: stepName } = step;

      try {
        console.log(`[Pipeline] Starting step ${stepNumber}: ${stepName}`);
        emitLog(socket, `Step ${stepNumber} started: ${stepName}`);
        emitUrlLog(socket, page);
        emitSocketEvent(socket, 'step_start', { stepNumber, stepName });

        const result = await executeStep(page, step, config, socket);
        results[stepNumber] = {
          stepNumber,
          stepName,
          result,
        };

        emitSocketEvent(socket, 'step_complete', {
          stepNumber,
          stepName,
          result,
        });
        emitLog(socket, `Step ${stepNumber} completed: ${stepName}`);
        emitUrlLog(socket, page);

        if (stepNumber === 1 && config.chatName) {
          emitSocketEvent(socket, 'status', 'Renaming chat...');
          emitLog(socket, `Renaming chat to: ${config.chatName}`);
          emitUrlLog(socket, page);
          await renameChat(page, config.chatName);
          emitLog(socket, 'Chat rename finished.');
          emitUrlLog(socket, page);
        }

        if (stepNumber < STEPS.length) {
          emitLog(socket, 'Waiting before next step...');
          emitUrlLog(socket, page);
          await randomStepDelay();
        }
      } catch (error) {
        console.error(`[Pipeline] Step ${stepNumber} failed:`, error);
        emitLog(socket, `Step ${stepNumber} failed: ${error.message}`);
        emitUrlLog(socket, page);
        emitSocketEvent(socket, 'error', {
          stepNumber,
          error: error.message,
        });
        throw error;
      }
    }

    console.log('[Pipeline] Pipeline completed successfully.');
    emitLog(socket, 'Pipeline completed successfully.');
    emitUrlLog(socket, page);
    emitSocketEvent(socket, 'pipeline_done', results);

    return results;
  } catch (error) {
    console.error('[Pipeline] runPipeline failed:', error);
    throw error;
  }
}

module.exports = {
  initBrowser,
  runPipeline,
};
