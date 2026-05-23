const { launchBrowser, waitForLogin } = require('./browser');
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

function getMinResponseCharsForStep(stepNumber) {
  return MIN_RESPONSE_CHARS_BY_STEP[stepNumber] || 500;
}

function getPipelineSteps(config) {
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
              return prompt.replaceAll('{{originalScript}}', originalScript);
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

function isRetriableStepError(error) {
  return (
    isClaudeTimeoutError(error) ||
    error?.code === 'CLAUDE_CONNECTION_ERROR' ||
    error?.code === 'CLAUDE_RESPONSE_TOO_SHORT'
  );
}

async function recoverBeforeStepRetry(page, socket, pipelineId) {
  if (page && typeof page.recoverAfterStepError === 'function') {
    await page.recoverAfterStepError();
    emitLog(socket, 'Đã làm mới chat sau lỗi tạm thời. Sẽ chạy lại đúng bước hiện tại.', pipelineId);
    return;
  }

  emitLog(socket, 'Sẽ chạy lại đúng bước hiện tại sau lỗi tạm thời.', pipelineId);
}

async function executeStep(page, step, config, socket, runtime = {}) {
  const { stepNumber, name: stepName } = step;
  const { pipelineId } = runtime;
  let attempt = 0;

  while (attempt <= STEP_RETRY_LIMIT) {
    try {
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
      const response = await page.sendPrompt(prompt, {
        stepNumber,
        stepName,
        minResponseChars,
      });
      emitLog(socket, 'Đã gửi tin nhắn và nhận phản hồi.', pipelineId);
      emitUrlLog(socket, page, pipelineId);

      return response;
    } catch (error) {
      if (isRetriableStepError(error) && attempt < STEP_RETRY_LIMIT) {
        attempt += 1;
        console.warn(
          `[Pipeline] Retriable error on step ${stepNumber}, retrying attempt ${attempt}/${STEP_RETRY_LIMIT}: ${error.message}`
        );
        emitLog(socket, `Bước ${stepNumber} gặp lỗi tạm thời: ${error.message}`, pipelineId);
        await recoverBeforeStepRetry(page, socket, pipelineId);
        await sleep(3000);
        continue;
      }

      throw error;
    }
  }
}

async function initBrowser(socket, options = {}) {
  try {
    console.log('[Pipeline] Launching browser...');
    emitLog(socket, 'Đang mở browser...');
    const { context, page } = await launchBrowser(options);

    console.log('[Pipeline] Waiting for manual login...');
    emitLog(socket, 'Đang chờ bạn đăng nhập thủ công...');
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

async function runPipeline(page, config, socket, runtime = {}) {
  const provider =
    page && typeof page.sendPrompt === 'function'
      ? page
      : createClaudeWebProvider(page);
  const results = {};
  let semiAutoEnabled = Boolean(config.semiAuto);
  const { pipelineId, shouldStop = () => false } = runtime;
  const pipelineSteps = getPipelineSteps(config);

  try {
    ensurePageAvailable(provider);
    console.log('[Pipeline] Starting pipeline with config:', config);
    emitLog(socket, 'Pipeline đã bắt đầu.', pipelineId);
    emitUrlLog(socket, provider, pipelineId);

    emitStatus(socket, 'Navigating to project...', pipelineId);
    emitLog(socket, `Đang mở project: ${config.projectUrl}`, pipelineId);
    emitUrlLog(socket, provider, pipelineId);
    await provider.navigateToProject(config.projectUrl);
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
    await provider.selectModel(config.modelName, { adaptiveThinking });
    emitLog(socket, 'Đã chọn model xong.', pipelineId);
    emitUrlLog(socket, provider, pipelineId);

    for (const step of pipelineSteps) {
      const { stepNumber, name: stepName } = step;

      try {
        if (shouldStop()) {
          emitLog(socket, 'Pipeline đã được người dùng dừng.', pipelineId);
          emitSocketEvent(socket, 'pipeline_stopped', withPipelineId({ results }, pipelineId));
          return results;
        }

        console.log(`[Pipeline] Starting step ${stepNumber}: ${stepName}`);
        emitLog(socket, `Bước ${stepNumber} đã bắt đầu: ${stepName}`, pipelineId);
        emitUrlLog(socket, provider, pipelineId);
        emitSocketEvent(socket, 'step_start', withPipelineId({ stepNumber, stepName }, pipelineId));

        const result = await executeStep(provider, step, config, socket, runtime);
        results[stepNumber] = {
          stepNumber,
          stepName,
          result,
        };

        emitSocketEvent(
          socket,
          'step_complete',
          withPipelineId({ stepNumber, stepName, result }, pipelineId)
        );
        emitLog(socket, `Bước ${stepNumber} đã hoàn thành: ${stepName}`, pipelineId);
        emitUrlLog(socket, provider, pipelineId);

        if (stepNumber === 1 && config.chatName) {
          emitStatus(socket, 'Renaming chat...', pipelineId);
          emitLog(socket, `Đang đổi tên chat thành: ${config.chatName}`, pipelineId);
          emitUrlLog(socket, provider, pipelineId);
          const chatRenamed = await provider.renameChat(config.chatName);
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
            emitLog(socket, 'Pipeline đã được dừng trong lúc kiểm tra.', pipelineId);
            emitSocketEvent(socket, 'pipeline_stopped', withPipelineId({ results }, pipelineId));
            return results;
          }

          if (userAction.action === 'edit') {
            emitLog(socket, 'Đang gửi yêu cầu chỉnh sửa: ' + userAction.message, pipelineId);
            const editResponse = await provider.sendPrompt(userAction.message, {
              stepNumber,
              stepName,
              minResponseChars: getMinResponseCharsForStep(stepNumber),
            });
            emitLog(socket, 'Đã xử lý chỉnh sửa. Độ dài phản hồi: ' + editResponse.length, pipelineId);
            results[stepNumber] = {
              stepNumber,
              stepName,
              result: editResponse,
            };
            emitSocketEvent(
              socket,
              'step_complete',
              withPipelineId({ stepNumber, stepName, result: editResponse }, pipelineId)
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
            emitSocketEvent(
              socket,
              'step_complete',
              withPipelineId({ stepNumber, stepName, result: redoResponse }, pipelineId)
            );
            emitLog(socket, 'Đã chạy lại xong bước ' + stepNumber, pipelineId);
            continue;
          }

          break;
        }

        if (stepNumber < pipelineSteps.length) {
          emitLog(socket, 'Đang chờ trước khi sang bước tiếp theo...', pipelineId);
          emitUrlLog(socket, provider, pipelineId);
          await randomStepDelay();
        }
      } catch (error) {
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
    console.error('[Pipeline] runPipeline failed:', error);
    throw error;
  }
}

module.exports = {
  initBrowser,
  runPipeline,
};
