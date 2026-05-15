const { launchBrowser, waitForLogin } = require('./browser');
const { createClaudeWebProvider } = require('./providers/claudeWebProvider');
const { STEPS } = require('../prompts/templates');

const STEP_TIMEOUT_RETRY_LIMIT = 0;
let pipelineStopped = false;

const MIN_RESPONSE_CHARS_BY_STEP = {
  1: 500,
  2: 3000,
  3: 1500,
  4: 6000,
  5: 6000,
  6: 6000,
  7: 1000,
  8: 500,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopPipeline() {
  pipelineStopped = true;
}

function getMinResponseCharsForStep(stepNumber) {
  return MIN_RESPONSE_CHARS_BY_STEP[stepNumber] || 500;
}

function buildPromptForStep(step, config) {
  const rawOverride =
    config.stepPromptOverrides?.[step.stepNumber] ??
    config.stepPromptOverrides?.[String(step.stepNumber)] ??
    '';
  const override = typeof rawOverride === 'string' ? rawOverride.trim() : '';

  if (!override) {
    return {
      prompt: step.buildPrompt(config.originalScript),
      source: 'default',
    };
  }

  return {
    prompt: override.replaceAll('{{originalScript}}', config.originalScript),
    source: 'custom',
  };
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

function compactMessage(message, maxLength = 300) {
  const text = String(message || '').replace(/\s+/g, ' ').trim();

  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength) + '...';
}

function emitUrlLog(socket, page) {
  let currentUrl = 'unknown';
  try {
    currentUrl =
      page && typeof page.getCurrentUrl === 'function'
        ? page.getCurrentUrl()
        : page.url();
  } catch (error) {
    currentUrl = `unavailable (${error.message})`;
  }

  emitSocketEvent(socket, 'log', {
    time: new Date().toISOString(),
    message: '↳ URL: ' + currentUrl,
  });
}

function ensurePageAvailable(page) {
  if (page && typeof page.ensureAvailable === 'function') {
    page.ensureAvailable();
    return;
  }

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

      const { prompt, source } = buildPromptForStep(step, config);
      emitLog(
        socket,
        `${source === 'custom' ? 'Using custom prompt override' : 'Using default prompt'} for step ${stepNumber}. Prompt length: ${prompt.length}`
      );
      emitLog(socket, `Sending prompt for step ${stepNumber}: ${stepName}`);
      emitUrlLog(socket, page);
      const minResponseChars = getMinResponseCharsForStep(stepNumber);
      emitLog(socket, `Preferred response length for step ${stepNumber}: ${minResponseChars} chars`);
      const response = await page.sendPrompt(prompt, {
        stepNumber,
        stepName,
        minResponseChars,
      });
      emitLog(socket, 'Message sent and response received.');
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
    const webProvider = createClaudeWebProvider(page);
    const projects = await webProvider.getProjects();

    emitSocketEvent(socket, 'login_success', { projects });

    return { context, page };
  } catch (error) {
    console.error('[Pipeline] initBrowser failed:', error);
    emitLog(socket, `Browser init failed: ${compactMessage(error.message)}`);
    throw error;
  }
}

async function runPipeline(page, config, socket) {
  const provider =
    page && typeof page.sendPrompt === 'function'
      ? page
      : createClaudeWebProvider(page);
  const results = {};
  let semiAutoEnabled = Boolean(config.semiAuto);

  try {
    pipelineStopped = false;
    ensurePageAvailable(provider);
    console.log('[Pipeline] Starting pipeline with config:', config);
    emitLog(socket, 'Pipeline started.');
    emitUrlLog(socket, provider);

    emitSocketEvent(socket, 'status', 'Navigating to project...');
    emitLog(socket, `Navigating to project: ${config.projectUrl}`);
    emitUrlLog(socket, provider);
    await provider.navigateToProject(config.projectUrl);
    emitLog(socket, 'Project navigation finished.');
    emitUrlLog(socket, provider);

    const adaptiveThinking = config.adaptiveThinking !== false;
    emitSocketEvent(socket, 'status', 'Selecting model...');
    emitLog(
      socket,
      `Selecting model: ${config.modelName} (${adaptiveThinking ? 'Adaptive thinking on' : 'Adaptive thinking off'})`
    );
    emitUrlLog(socket, provider);
    await provider.selectModel(config.modelName, { adaptiveThinking });
    emitLog(socket, 'Model selection finished.');
    emitUrlLog(socket, provider);

    for (const step of STEPS) {
      const { stepNumber, name: stepName } = step;

      try {
        if (pipelineStopped) {
          emitLog(socket, 'Pipeline stopped by user.');
          emitSocketEvent(socket, 'pipeline_stopped', results);
          pipelineStopped = false;
          return results;
        }

        console.log(`[Pipeline] Starting step ${stepNumber}: ${stepName}`);
        emitLog(socket, `Step ${stepNumber} started: ${stepName}`);
        emitUrlLog(socket, provider);
        emitSocketEvent(socket, 'step_start', { stepNumber, stepName });

        const result = await executeStep(provider, step, config, socket);
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
        emitUrlLog(socket, provider);

        if (stepNumber === 1 && config.chatName) {
          emitSocketEvent(socket, 'status', 'Renaming chat...');
          emitLog(socket, `Renaming chat to: ${config.chatName}`);
          emitUrlLog(socket, provider);
          const chatRenamed = await provider.renameChat(config.chatName);
          emitLog(
            socket,
            chatRenamed
              ? 'Chat rename finished.'
              : 'Chat rename was not applied. Continuing pipeline.'
          );
          emitUrlLog(socket, provider);
        }

        while (semiAutoEnabled && stepNumber < STEPS.length) {
          emitLog(socket, 'Waiting for your review. Press Continue, Edit, or Redo.');
          emitSocketEvent(socket, 'step_review', { stepNumber, stepName });

          const userAction = await new Promise((resolve) => {
            const onContinue = () => {
              cleanup();
              resolve({ action: 'continue' });
            };
            const onContinueAuto = () => {
              cleanup();
              resolve({ action: 'continue_auto' });
            };
            const onEdit = (data) => {
              cleanup();
              resolve({ action: 'edit', message: data?.message || '' });
            };
            const onRedo = () => {
              cleanup();
              resolve({ action: 'redo' });
            };
            const onStop = () => {
              cleanup();
              resolve({ action: 'stop' });
            };

            function cleanup() {
              socket.off('review_continue', onContinue);
              socket.off('review_continue_auto', onContinueAuto);
              socket.off('review_edit', onEdit);
              socket.off('review_redo', onRedo);
              socket.off('stop_pipeline', onStop);
            }

            socket.on('review_continue', onContinue);
            socket.on('review_continue_auto', onContinueAuto);
            socket.on('review_edit', onEdit);
            socket.on('review_redo', onRedo);
            socket.on('stop_pipeline', onStop);
          });

          if (userAction.action === 'continue_auto') {
            semiAutoEnabled = false;
            emitLog(socket, 'Switched to Auto mode from this step onward.');
            break;
          }

          if (userAction.action === 'stop') {
            emitLog(socket, 'Pipeline stopped by user during review.');
            emitSocketEvent(socket, 'pipeline_stopped', results);
            pipelineStopped = false;
            return results;
          }

          if (userAction.action === 'edit') {
            emitLog(socket, 'Sending edit request: ' + userAction.message);
            const editResponse = await provider.sendPrompt(userAction.message, {
              stepNumber,
              stepName,
              minResponseChars: getMinResponseCharsForStep(stepNumber),
            });
            emitLog(socket, 'Edit processed. Response length: ' + editResponse.length);
            results[stepNumber] = {
              stepNumber,
              stepName,
              result: editResponse,
            };
            emitSocketEvent(socket, 'step_complete', {
              stepNumber,
              stepName,
              result: editResponse,
            });
            continue;
          }

          if (userAction.action === 'redo') {
            emitLog(socket, 'Redoing step ' + stepNumber + '...');
            const { prompt: redoPrompt, source: redoSource } = buildPromptForStep(step, config);
            emitLog(
              socket,
              `${redoSource === 'custom' ? 'Using custom prompt override' : 'Using default prompt'} for redo step ${stepNumber}. Prompt length: ${redoPrompt.length}`
            );
            const redoResponse = await provider.sendPrompt(redoPrompt, {
              stepNumber,
              stepName,
              minResponseChars: getMinResponseCharsForStep(stepNumber),
            });
            results[stepNumber] = {
              stepNumber,
              stepName,
              result: redoResponse,
            };
            emitSocketEvent(socket, 'step_complete', {
              stepNumber,
              stepName,
              result: redoResponse,
            });
            emitLog(socket, 'Redo complete for step ' + stepNumber);
            continue;
          }

          break;
        }

        if (stepNumber < STEPS.length) {
          emitLog(socket, 'Waiting before next step...');
          emitUrlLog(socket, provider);
          await randomStepDelay();
        }
      } catch (error) {
        console.error(`[Pipeline] Step ${stepNumber} failed:`, error);
        emitLog(socket, `Step ${stepNumber} failed: ${error.message}`);
        emitUrlLog(socket, provider);
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
  stopPipeline,
};
