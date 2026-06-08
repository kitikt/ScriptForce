const {
  launchBrowser,
  waitForLogin,
} = require('./browser');
const { createClaudeWebProvider } = require('./providers/claudeWebProvider');
const { STEPS } = require('../prompts/templates');

const STEP_RETRY_LIMIT = 1;

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

class PipelineStoppedError extends Error {
  constructor(message = 'Pipeline da duoc dung boi nguoi dung.') {
    super(message);
    this.name = 'PipelineStoppedError';
    this.code = 'PIPELINE_STOPPED';
  }
}

function isPipelineStoppedError(error) {
  return error?.code === 'PIPELINE_STOPPED' || error?.name === 'PipelineStoppedError';
}

function isStopRequested(runtime = {}) {
  return typeof runtime.shouldStop === 'function' && runtime.shouldStop();
}

function throwIfStopped(runtime = {}) {
  if (isStopRequested(runtime)) {
    throw new PipelineStoppedError();
  }
}

async function sleepUntil(ms, runtime = {}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < ms) {
    throwIfStopped(runtime);
    await sleep(Math.min(250, ms - (Date.now() - startedAt)));
  }

  throwIfStopped(runtime);
}

function getMinResponseCharsForStep(stepNumber) {
  return MIN_RESPONSE_CHARS_BY_STEP[stepNumber] || 500;
}

function normalizeStepResponse(response) {
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    return {
      text: String(response.text || ''),
      artifacts: Array.isArray(response.artifacts) ? response.artifacts : [],
    };
  }

  return {
    text: String(response || ''),
    artifacts: [],
  };
}

function applyOriginalScriptToPrompt(prompt, originalScript, options = {}) {
  const sourcePrompt = String(prompt || '');
  const script = String(originalScript || '').trim();
  const hasOriginalScriptToken = sourcePrompt.includes('{{originalScript}}');
  const promptWithTokenValue = sourcePrompt.replaceAll('{{originalScript}}', script);

  if (!options.appendWhenMissing || hasOriginalScriptToken || !script) {
    return promptWithTokenValue;
  }

  return `${promptWithTokenValue}\n\nKịch bản gốc:\n${script}`;
}

function getPipelineSteps(config) {
  const configuredSteps = Array.isArray(config.promptSteps)
    ? config.promptSteps
        .map((step, index) => {
          const stepNumber = Number(step.stepNumber) || index + 1;
          const name = String(step.name || `Bước ${stepNumber}`).trim();
          const prompt = String(step.prompt || '').trim();

          if (!prompt) {
            return null;
          }

          return {
            stepNumber,
            name,
            buildPrompt(originalScript) {
              return applyOriginalScriptToPrompt(prompt, originalScript, {
                appendWhenMissing: index === 0,
              });
            },
          };
        })
        .filter(Boolean)
    : [];

  if (configuredSteps.length > 0) {
    return configuredSteps;
  }

  const customSteps = Array.isArray(config.customPromptSteps)
    ? config.customPromptSteps
        .map((step, index) => {
          const stepNumber = Number(step.stepNumber) || STEPS.length + index + 1;
          const name = String(step.name || `Bước tùy chỉnh ${index + 1}`).trim();
          const prompt = String(step.prompt || '').trim();

          if (!prompt) {
            return null;
          }

          return {
            stepNumber,
            name,
            buildPrompt(originalScript) {
              return applyOriginalScriptToPrompt(prompt, originalScript);
            },
          };
        })
        .filter(Boolean)
    : [];

  return [...STEPS, ...customSteps];
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
    prompt: applyOriginalScriptToPrompt(override, config.originalScript, {
      appendWhenMissing: step.stepNumber === 1,
    }),
    source: 'custom',
  };
}

async function randomStepDelay(runtime = {}, options = {}) {
  const stepNumber = Number(options.stepNumber || 0);
  const hasArtifact = Array.isArray(options.artifacts) && options.artifacts.length > 0;
  const longCooldown = stepNumber >= 7 || hasArtifact;
  const minMs = longCooldown ? 45000 : 5000;
  const maxMs = longCooldown ? 75000 : 15000;
  const delayMs = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  console.log(`[Pipeline] Waiting ${delayMs}ms before next step...`);
  await sleepUntil(delayMs, runtime);
}

function emitSocketEvent(socket, eventName, payload) {
  if (socket && typeof socket.emit === 'function') {
    socket.emit(eventName, payload);
  }
}

function withPipelineId(payload, pipelineId) {
  if (!pipelineId) {
    return payload;
  }

  return {
    ...payload,
    pipelineId,
  };
}

function emitStatus(socket, message, pipelineId) {
  emitSocketEvent(
    socket,
    'status',
    pipelineId
      ? {
          pipelineId,
          message,
        }
      : message
  );
}

function emitLog(socket, message, pipelineId) {
  emitSocketEvent(
    socket,
    'log',
    withPipelineId(
      {
        time: new Date().toLocaleTimeString('en-GB'),
        message,
      },
      pipelineId
    )
  );
}

function compactMessage(message, maxLength = 300) {
  const text = String(message || '').replace(/\s+/g, ' ').trim();

  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength) + '...';
}

function emitUrlLog(socket, page, pipelineId) {
  let currentUrl = 'unknown';
  try {
    currentUrl =
      page && typeof page.getCurrentUrl === 'function'
        ? page.getCurrentUrl()
        : page.url();
  } catch (error) {
    currentUrl = `unavailable (${error.message})`;
  }

  emitSocketEvent(
    socket,
    'log',
    withPipelineId(
      {
        time: new Date().toISOString(),
        message: 'URL: ' + currentUrl,
      },
      pipelineId
    )
  );
}

function ensurePageAvailable(page) {
  if (page && typeof page.ensureAvailable === 'function') {
    page.ensureAvailable();
    return;
  }

  if (!page || typeof page.isClosed !== 'function' || page.isClosed()) {
    throw new Error('Trang browser đã đóng. Vui lòng kết nối lại browser.');
  }
}

function isClaudeTimeoutError(error) {
  const message = error?.message || '';
  return /timed out waiting for claude response/i.test(message);
}

function isClaudeCodeExecutionBusyError(error) {
  const message = error?.message || '';
  return /another response is already running/i.test(message) ||
    /code execution environment/i.test(message) ||
    /wait for it to finish before trying again/i.test(message);
}

function isClaudeTooManyChatsError(error) {
  return error?.code === 'CLAUDE_TOO_MANY_CHATS' ||
    /looks like you have too many chats going\.?\s*please close a tab to continue\.?/i.test(
      error?.message || ''
    ) ||
    /too many responses are running at once/i.test(error?.message || '') ||
    /you can stop a response or wait for one to finish, then try again/i.test(
      error?.message || ''
    );
}

function isClaudeUsageLimitError(error) {
  return error?.code === 'CLAUDE_USAGE_LIMIT' ||
    /5-hour limit reached\s*[-·]?\s*resets?/i.test(error?.message || '') ||
    /you(?:'|’)?ve hit your limit/i.test(error?.message || '') ||
    /you have reached your message limit/i.test(error?.message || '');
}

function isRetriableStepError(error) {
  const message = error?.message || '';

  return (
    isClaudeTimeoutError(error) ||
    error?.code === 'CLAUDE_CONNECTION_ERROR' ||
    error?.code === 'CLAUDE_RESPONSE_TOO_SHORT' ||
    error?.code === 'CLAUDE_INPUT_NOT_READY' ||
    /chat input not found/i.test(message)
  );
}

async function recoverBeforeStepRetry(page, socket, pipelineId, error) {
  if (isClaudeCodeExecutionBusyError(error)) {
    emitLog(
      socket,
      'Claude van dang khoa code execution cua chat nay. Dang cho 90 giay roi thu lai dung buoc hien tai.',
      pipelineId
    );
    return;
  }

  if (page && typeof page.recoverAfterStepError === 'function') {
    await page.recoverAfterStepError();
    emitLog(socket, 'Đã làm mới chat sau lỗi tạm thời. Sẽ chạy lại đúng bước hiện tại.', pipelineId);
    return;
  }

  emitLog(socket, 'Sẽ chạy lại đúng bước hiện tại sau lỗi tạm thời.', pipelineId);
}

function getRetryDelayMs(error) {
  return isClaudeCodeExecutionBusyError(error) ? 90000 : 3000;
}

async function executeStep(page, step, config, socket, runtime = {}) {
  const { stepNumber, name: stepName } = step;
  const { pipelineId } = runtime;
  let attempt = 0;
  let tooManyChatsRetryCount = 0;

  while (attempt <= STEP_RETRY_LIMIT) {
    try {
      throwIfStopped(runtime);
      ensurePageAvailable(page);

      if (attempt > 0) {
        emitStatus(
          socket,
          `Step ${stepNumber} gặp lỗi tạm thời. Đang thử lại ${attempt}/${STEP_RETRY_LIMIT}...`,
          pipelineId
        );
        emitLog(
          socket,
          `Bước ${stepNumber} đang được chạy lại lần ${attempt}/${STEP_RETRY_LIMIT}.`,
          pipelineId
        );
        emitUrlLog(socket, page, pipelineId);
      }

      const { prompt, source } = buildPromptForStep(step, config);
      emitLog(
        socket,
        `${source === 'custom' ? 'Đang dùng prompt đã chỉnh sửa' : 'Đang dùng prompt mặc định'} cho bước ${stepNumber}. Độ dài prompt: ${prompt.length}`,
        pipelineId
      );
      emitLog(socket, `Đang gửi prompt cho bước ${stepNumber}: ${stepName}`, pipelineId);
      emitUrlLog(socket, page, pipelineId);
      const minResponseChars = getMinResponseCharsForStep(stepNumber);
      emitLog(socket, `Độ dài phản hồi ưu tiên cho bước ${stepNumber}: ${minResponseChars} ký tự`, pipelineId);
      throwIfStopped(runtime);
      const response = await page.sendPrompt(prompt, {
        stepNumber,
        stepName,
        minResponseChars,
        pipelineId,
        shouldStop: runtime.shouldStop,
        onWait(message) {
          emitStatus(socket, message, pipelineId);
          emitLog(socket, message, pipelineId);
        },
      });
      throwIfStopped(runtime);
      emitLog(socket, 'Đã gửi tin nhắn và nhận phản hồi.', pipelineId);
      emitUrlLog(socket, page, pipelineId);

      return normalizeStepResponse(response);
    } catch (error) {
      if (isPipelineStoppedError(error) || isStopRequested(runtime)) {
        throw new PipelineStoppedError();
      }

      if (isClaudeTooManyChatsError(error) || isClaudeUsageLimitError(error)) {
        tooManyChatsRetryCount += 1;
        emitLog(
          socket,
          isClaudeUsageLimitError(error)
            ? `Claude báo tài khoản đã hết usage. Pipeline giữ nguyên tại bước ${stepNumber} và đang chờ reset.`
            : `Claude báo đang có quá nhiều phản hồi hoặc account có thể đã hết usage. Đang kiểm tra trước khi thử lại đúng bước ${stepNumber}.`,
          pipelineId
        );
        if (page && typeof page.waitForAccountReady === 'function') {
          await page.waitForAccountReady(error, {
            pipelineId,
            modelName: config.modelName,
            retryCount: tooManyChatsRetryCount,
            shouldStop: runtime.shouldStop,
            onWait(message) {
              emitStatus(socket, message, pipelineId);
              emitLog(socket, message, pipelineId);
            },
          });
        } else {
          await sleepUntil(Math.min(60000, tooManyChatsRetryCount * 10000), runtime);
        }
        emitStatus(
          socket,
          `Tài khoản đã sẵn sàng. Đang thử lại đúng bước ${stepNumber}...`,
          pipelineId
        );
        continue;
      }

      if (isRetriableStepError(error) && attempt < STEP_RETRY_LIMIT) {
        attempt += 1;
        console.warn(
          `[Pipeline] Retriable error on step ${stepNumber}, retrying attempt ${attempt}/${STEP_RETRY_LIMIT}: ${error.message}`
        );
        emitLog(socket, `Bước ${stepNumber} gặp lỗi tạm thời: ${error.message}`, pipelineId);
        await recoverBeforeStepRetry(page, socket, pipelineId, error);
        await sleepUntil(getRetryDelayMs(error), runtime);
        continue;
      }

      throw error;
    }
  }
}

async function initBrowser(socket, options = {}) {
  try {
    console.log('[Pipeline] Launching browser...');
    emitLog(socket, 'Đang mở Chromium ở chế độ nền...');
    const { context, page } = await launchBrowser(options);

    console.log('[Pipeline] Waiting for manual login...');
    emitLog(socket, 'Chromium đang chạy nền. Nếu cần đăng nhập, hãy bấm vào cửa sổ Chromium trên taskbar.');
    await waitForLogin(page);

    console.log('[Pipeline] Login complete, fetching projects...');
    emitLog(socket, 'Đăng nhập xong. Đang lấy danh sách project...');
    const webProvider = createClaudeWebProvider(page);
    const projects = await webProvider.getProjects();

    emitSocketEvent(socket, 'login_success', { projects });

    return { context, page };
  } catch (error) {
    console.error('[Pipeline] initBrowser failed:', error);
    emitLog(socket, `Không mở được browser: ${compactMessage(error.message)}`);
    throw error;
  }
}

function waitForReviewAction(socket, pipelineId, shouldStop) {
  return new Promise((resolve) => {
    const matchesPipeline = (data) => data?.pipelineId === pipelineId;
    const stopInterval = setInterval(() => {
      if (shouldStop()) {
        cleanup();
        resolve({ action: 'stop' });
      }
    }, 1000);

    const onContinue = (data) => {
      if (!matchesPipeline(data)) {
        return;
      }
      cleanup();
      resolve({ action: 'continue' });
    };
    const onContinueAuto = (data) => {
      if (!matchesPipeline(data)) {
        return;
      }
      cleanup();
      resolve({ action: 'continue_auto' });
    };
    const onEdit = (data) => {
      if (!matchesPipeline(data)) {
        return;
      }
      cleanup();
      resolve({ action: 'edit', message: data?.message || '' });
    };
    const onRedo = (data) => {
      if (!matchesPipeline(data)) {
        return;
      }
      cleanup();
      resolve({ action: 'redo' });
    };
    const onStop = (data) => {
      if (!matchesPipeline(data)) {
        return;
      }
      cleanup();
      resolve({ action: 'stop' });
    };

    function cleanup() {
      clearInterval(stopInterval);
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
}

function emitPipelineStopped(socket, results, pipelineId) {
  emitLog(socket, 'Pipeline da duoc dung theo yeu cau.', pipelineId);
  emitSocketEvent(socket, 'pipeline_stopped', withPipelineId({ results }, pipelineId));
}

async function runPipeline(page, config, socket, runtime = {}) {
  const provider =
    page && typeof page.sendPrompt === 'function'
      ? page
      : createClaudeWebProvider(page);
  const results = { ...(runtime.initialResults || {}) };
  let semiAutoEnabled = Boolean(config.semiAuto);
  const { pipelineId, shouldStop = () => false } = runtime;
  const pipelineSteps = getPipelineSteps(config);
  const startStepNumber = Number(runtime.startStepNumber || 0);
  const skipSetup = Boolean(runtime.skipSetup);

  try {
    throwIfStopped(runtime);
    ensurePageAvailable(provider);
    console.log('[Pipeline] Starting pipeline with config:', config);
    emitLog(socket, 'Pipeline đã bắt đầu.', pipelineId);
    emitUrlLog(socket, provider, pipelineId);

    if (!skipSetup) {
    emitStatus(socket, 'Navigating to project...', pipelineId);
    emitLog(socket, `Đang mở project: ${config.projectUrl}`, pipelineId);
    emitUrlLog(socket, provider, pipelineId);
    await provider.navigateToProject(config.projectUrl);
    throwIfStopped(runtime);
    emitLog(socket, 'Đã mở project xong.', pipelineId);
    emitUrlLog(socket, provider, pipelineId);

    const adaptiveThinking = config.adaptiveThinking !== false;
    emitStatus(socket, 'Selecting model...', pipelineId);
    emitLog(
      socket,
      `Selecting model: ${config.modelName} (${adaptiveThinking ? 'Adaptive thinking on' : 'Adaptive thinking off'})`,
      pipelineId
    );
    emitUrlLog(socket, provider, pipelineId);
    const selectedModel = await provider.selectModel(config.modelName, { adaptiveThinking });
    throwIfStopped(runtime);
    if (!selectedModel) {
      throw new Error(`Khong chon duoc model ${config.modelName}. Pipeline da dung de tranh chay sai model.`);
    }
    emitLog(socket, 'Đã chọn model xong.', pipelineId);
    emitUrlLog(socket, provider, pipelineId);
    } else {
      emitLog(socket, `Dang thu lai pipeline tu buoc ${startStepNumber || 1} trong chat hien tai.`, pipelineId);
      emitUrlLog(socket, provider, pipelineId);
    }

    for (const step of pipelineSteps) {
      const { stepNumber, name: stepName } = step;

      if (startStepNumber && stepNumber < startStepNumber) {
        continue;
      }

      try {
        if (shouldStop()) {
          emitPipelineStopped(socket, results, pipelineId);
          return results;
        }

        console.log(`[Pipeline] Starting step ${stepNumber}: ${stepName}`);
        emitLog(socket, `Bước ${stepNumber} đã bắt đầu: ${stepName}`, pipelineId);
        emitUrlLog(socket, provider, pipelineId);
        emitSocketEvent(socket, 'step_start', withPipelineId({ stepNumber, stepName }, pipelineId));

        const stepResponse = await executeStep(provider, step, config, socket, runtime);
        const result = stepResponse.text;
        const artifacts = stepResponse.artifacts;
        results[stepNumber] = {
          stepNumber,
          stepName,
          result,
          artifacts,
        };

        emitSocketEvent(
          socket,
          'step_complete',
          withPipelineId({ stepNumber, stepName, result, artifacts }, pipelineId)
        );
        emitLog(socket, `Bước ${stepNumber} đã hoàn thành: ${stepName}`, pipelineId);
        emitUrlLog(socket, provider, pipelineId);

        if (stepNumber === 1 && config.chatName) {
          emitStatus(socket, 'Renaming chat...', pipelineId);
          emitLog(socket, `Đang đổi tên chat thành: ${config.chatName}`, pipelineId);
          emitUrlLog(socket, provider, pipelineId);
          const chatRenamed = await provider.renameChat(config.chatName);
          throwIfStopped(runtime);
          emitLog(
            socket,
            chatRenamed
              ? 'Đã đổi tên chat và xác minh thành công.'
              : 'Chưa xác minh được việc đổi tên chat. Pipeline vẫn tiếp tục.',
            pipelineId
          );
          emitUrlLog(socket, provider, pipelineId);
        }

        while (semiAutoEnabled && stepNumber < pipelineSteps.length) {
          emitLog(socket, 'Đang chờ bạn kiểm tra. Chọn tiếp tục, chỉnh sửa hoặc chạy lại.', pipelineId);
          emitSocketEvent(socket, 'step_review', withPipelineId({ stepNumber, stepName }, pipelineId));

          const userAction = await waitForReviewAction(socket, pipelineId, shouldStop);

          if (userAction.action === 'continue_auto') {
            semiAutoEnabled = false;
            emitLog(socket, 'Đã chuyển sang chế độ Auto từ bước này trở đi.', pipelineId);
            break;
          }

          if (userAction.action === 'stop') {
            emitPipelineStopped(socket, results, pipelineId);
            return results;
          }

          if (userAction.action === 'edit') {
            emitLog(socket, 'Đang gửi yêu cầu chỉnh sửa: ' + userAction.message, pipelineId);
            throwIfStopped(runtime);
            const editStepResponse = normalizeStepResponse(await provider.sendPrompt(userAction.message, {
              stepNumber,
              stepName,
              minResponseChars: getMinResponseCharsForStep(stepNumber),
            }));
            throwIfStopped(runtime);
            const editResponse = editStepResponse.text;
            const editArtifacts = editStepResponse.artifacts;
            emitLog(socket, 'Đã xử lý chỉnh sửa. Độ dài phản hồi: ' + editResponse.length, pipelineId);
            results[stepNumber] = {
              stepNumber,
              stepName,
              result: editResponse,
              artifacts: editArtifacts,
            };
            emitSocketEvent(
              socket,
              'step_complete',
              withPipelineId({ stepNumber, stepName, result: editResponse, artifacts: editArtifacts }, pipelineId)
            );
            continue;
          }

          if (userAction.action === 'redo') {
            emitLog(socket, 'Đang chạy lại bước ' + stepNumber + '...', pipelineId);
            const { prompt: redoPrompt, source: redoSource } = buildPromptForStep(step, config);
            emitLog(
              socket,
              `${redoSource === 'custom' ? 'Đang dùng prompt đã chỉnh sửa' : 'Đang dùng prompt mặc định'} để chạy lại bước ${stepNumber}. Độ dài prompt: ${redoPrompt.length}`,
              pipelineId
            );
            throwIfStopped(runtime);
            const redoStepResponse = normalizeStepResponse(await provider.sendPrompt(redoPrompt, {
              stepNumber,
              stepName,
              minResponseChars: getMinResponseCharsForStep(stepNumber),
            }));
            throwIfStopped(runtime);
            const redoResponse = redoStepResponse.text;
            const redoArtifacts = redoStepResponse.artifacts;
            results[stepNumber] = {
              stepNumber,
              stepName,
              result: redoResponse,
              artifacts: redoArtifacts,
            };
            emitSocketEvent(
              socket,
              'step_complete',
              withPipelineId({ stepNumber, stepName, result: redoResponse, artifacts: redoArtifacts }, pipelineId)
            );
            emitLog(socket, 'Đã chạy lại xong bước ' + stepNumber, pipelineId);
            continue;
          }

          break;
        }

        if (stepNumber < pipelineSteps.length) {
          emitLog(socket, 'Đang chờ trước khi sang bước tiếp theo...', pipelineId);
          emitUrlLog(socket, provider, pipelineId);
          await randomStepDelay(runtime, {
            stepNumber,
            artifacts,
          });
        }
      } catch (error) {
        if (isPipelineStoppedError(error) || shouldStop()) {
          emitPipelineStopped(socket, results, pipelineId);
          return results;
        }

        console.error(`[Pipeline] Step ${stepNumber} failed:`, error);
        emitLog(socket, `Bước ${stepNumber} gặp lỗi: ${error.message}`, pipelineId);
        emitUrlLog(socket, provider, pipelineId);
        emitSocketEvent(
          socket,
          'error',
          withPipelineId(
            {
              stepNumber,
              error: error.message,
            },
            pipelineId
          )
        );
        throw error;
      }
    }

    console.log('[Pipeline] Pipeline completed successfully.');
    emitLog(socket, 'Pipeline đã hoàn tất thành công.', pipelineId);
    emitUrlLog(socket, page, pipelineId);
    emitSocketEvent(socket, 'pipeline_done', withPipelineId({ results }, pipelineId));

    return results;
  } catch (error) {
    if (isPipelineStoppedError(error) || shouldStop()) {
      emitPipelineStopped(socket, results, pipelineId);
      return results;
    }

    console.error('[Pipeline] runPipeline failed:', error);
    throw error;
  }
}

module.exports = {
  initBrowser,
  runPipeline,
};
