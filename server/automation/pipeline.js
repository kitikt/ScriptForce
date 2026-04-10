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

function emitUrlLog(socket, message) {
  emitSocketEvent(socket, 'log', {
    time: new Date().toISOString(),
    message,
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
      }

      const prompt = step.buildPrompt(config.originalScript);
      emitLog(socket, `Sending prompt for step ${stepNumber}: ${stepName}`);
      await sendMessage(page, prompt);
      emitUrlLog(socket, 'Message sent. Current URL: ' + page.url());

      emitLog(socket, `Waiting for Claude response at step ${stepNumber}: ${stepName}`);
      const response = await waitForResponse(page);
      emitUrlLog(socket, 'Response received. Current URL: ' + page.url());
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

    emitSocketEvent(socket, 'status', 'Navigating to project...');
    emitLog(socket, `Navigating to project: ${config.projectUrl}`);
    await navigateToProject(page, config.projectUrl);
    emitUrlLog(socket, 'Current URL: ' + page.url());

    emitSocketEvent(socket, 'status', 'Selecting model...');
    emitLog(socket, `Selecting model: ${config.modelName}`);
    await selectModel(page, config.modelName);
    emitUrlLog(socket, 'Current URL: ' + page.url());

    for (const step of STEPS) {
      const { stepNumber, name: stepName } = step;

      try {
        console.log(`[Pipeline] Starting step ${stepNumber}: ${stepName}`);
        emitLog(socket, `Step ${stepNumber} started: ${stepName}`);
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

        if (stepNumber === 1 && config.chatName) {
          emitSocketEvent(socket, 'status', 'Renaming chat...');
          emitLog(socket, `Renaming chat to: ${config.chatName}`);
          await renameChat(page, config.chatName);
          emitUrlLog(socket, 'Current URL: ' + page.url());
        }

        if (stepNumber < STEPS.length) {
          emitLog(socket, 'Waiting before next step...');
          await randomStepDelay();
        }
      } catch (error) {
        console.error(`[Pipeline] Step ${stepNumber} failed:`, error);
        emitLog(socket, `Step ${stepNumber} failed: ${error.message}`);
        emitSocketEvent(socket, 'error', {
          stepNumber,
          error: error.message,
        });
        throw error;
      }
    }

    console.log('[Pipeline] Pipeline completed successfully.');
    emitLog(socket, 'Pipeline completed successfully.');
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
