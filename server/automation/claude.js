const fs = require('fs/promises');
const path = require('path');

const CLAUDE_ORIGIN = 'https://claude.ai';
const RESPONSE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_RESPONSE_RETRIES = 2;
const MIN_PARTIAL_RESPONSE_CHARS = 100;
const MIN_FINAL_RESPONSE_CHARS = 240;
const DEFAULT_MIN_RESPONSE_CHARS = 240;
const SHORT_RESPONSE_ACCEPT_MS = 90 * 1000;
const MIN_ARTIFACT_RESPONSE_CHARS = 2000;
const ARTIFACT_EXPORT_DIR = path.join(__dirname, '..', 'exports');
const CONTEXT_LIMIT_PATTERNS = [
  /context (window )?(is )?(full|too long|exceeded)/i,
  /conversation (is )?too long/i,
  /message (is )?too long/i,
  /too many tokens/i,
  /prompt is too long/i,
  /context limit/i,
  /reduce the length/i,
];
const CLAUDE_CONNECTION_ERROR_PATTERNS = [
  /we (?:couldn['’]?t|could not) connect to claude/i,
  /(?:couldn['’]?t|could not) connect to claude/i,
  /unable to connect to claude/i,
  /problem connecting to claude/i,
  /connection (?:to claude )?(?:failed|lost|interrupted)/i,
  /network error/i,
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function randomDelay(minMs = 1000, maxMs = 3000) {
  const delay =
    Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;

  await sleep(delay);
}

function normalizeClaudeUrl(url, baseUrl = CLAUDE_ORIGIN) {
  return new URL(url, baseUrl).toString();
}

function createClaudeConnectionError(message) {
  const error = new Error(
    message || 'Claude connection error detected. The response was not completed.'
  );
  error.code = 'CLAUDE_CONNECTION_ERROR';
  return error;
}

function toRelativeClaudeUrl(url) {
  return new URL(url, CLAUDE_ORIGIN).pathname;
}

async function isLocatorVisible(locator, timeout = 1000) {
  try {
    return await locator.isVisible({ timeout });
  } catch {
    return false;
  }
}

async function isLocatorEnabled(locator, timeout = 1000) {
  try {
    return await locator.isEnabled({ timeout });
  } catch {
    return false;
  }
}

async function findFirstVisibleLocator(locators) {
  for (const locator of locators) {
    const candidate = locator.first();

    if (await isLocatorVisible(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function findSendButton(page) {
  return findFirstVisibleLocator([
    page.getByRole('button', { name: /Send|Submit/i }),
    page.locator('button[aria-label*="Send" i], button[title*="Send" i]'),
    page.locator('button[aria-label*="Submit" i], button[title*="Submit" i]'),
  ]);
}

async function findVisibleChatInput(page) {
  const inputs = page.locator('div[contenteditable="true"]');
  const count = await inputs.count();

  for (let index = count - 1; index >= 0; index -= 1) {
    const candidate = inputs.nth(index);

    if (await isLocatorVisible(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function hasTransientClaudeOverlay(page) {
  try {
    return await page.evaluate(() => {
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.pointerEvents !== 'none'
        );
      };

      return Array.from(document.querySelectorAll('[data-base-ui-portal], [data-radix-portal]'))
        .some((portal) => isVisible(portal));
    });
  } catch {
    return false;
  }
}

async function clearClaudePointerBlockers(page) {
  try {
    return await page.evaluate(() => {
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.pointerEvents !== 'none'
        );
      };
      const composer = Array.from(document.querySelectorAll('div[contenteditable="true"]'))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .pop();
      const composerRect = composer?.getBoundingClientRect();
      const points = composerRect
        ? [
            [composerRect.left + composerRect.width / 2, composerRect.top + composerRect.height / 2],
            [composerRect.left + 24, composerRect.top + Math.min(24, composerRect.height / 2)],
          ]
        : [];
      let disabled = 0;

      const disableElement = (element) => {
        if (!element || !isVisible(element)) {
          return;
        }

        element.style.pointerEvents = 'none';
        element.setAttribute('data-scriptforge-pointer-disabled', 'true');
        disabled += 1;
      };

      const blockerSelectors = [
        '[data-base-ui-portal] [data-base-ui-inert]',
        '[data-base-ui-portal] [role="presentation"]',
        '[data-radix-portal] [role="presentation"]',
        '[data-scriptforge-stale-overlay]',
      ];

      for (const blocker of document.querySelectorAll(blockerSelectors.join(','))) {
        const text = (blocker.innerText || blocker.textContent || '').trim();
        if (text.length > 0 && text.length < 120) {
          continue;
        }

        disableElement(blocker);
      }

      for (const [x, y] of points) {
        const target = document.elementFromPoint(x, y);
        if (!target || target === composer || composer?.contains(target)) {
          continue;
        }

        const blocker = target.closest('[data-base-ui-portal], [data-radix-portal], [role="presentation"], [data-base-ui-inert]');
        if (blocker && !composer?.contains(blocker)) {
          disableElement(blocker);
        }
      }

      return disabled;
    });
  } catch {
    return 0;
  }
}

async function closeTransientClaudeUi(page) {
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const disabledBlockers = await clearClaudePointerBlockers(page);
      if (disabledBlockers > 0) {
        console.warn('[Claude] Disabled stale Claude pointer blockers:', disabledBlockers);
        return true;
      }

      if (!await hasTransientClaudeOverlay(page)) {
        return false;
      }

      await page.keyboard.press('Escape');
      await sleep(300);
    }

    const disabledBlockers = await clearClaudePointerBlockers(page);

    if (disabledBlockers > 0) {
      console.warn('[Claude] Disabled stale Claude overlay blockers:', disabledBlockers);
      return true;
    }
  } catch (error) {
    console.warn('[Claude] Failed to close transient Claude UI:', error.message);
  }

  return false;
}

async function focusChatInput(page, input) {
  await closeTransientClaudeUi(page);

  try {
    await input.click({ timeout: 6000 });
    return;
  } catch (error) {
    console.warn('[Claude] Chat input click failed, clearing overlays and retrying:', error.message);
  }

  await closeTransientClaudeUi(page);
  const disabledBlockers = await clearClaudePointerBlockers(page);
  if (disabledBlockers > 0) {
    console.warn('[Claude] Cleared pointer blockers before forcing chat input click:', disabledBlockers);
  }
  await input.click({ timeout: 6000, force: true });
}

function normalizeTextForMatch(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function textLooksLikePrompt(candidateText, promptText) {
  const candidate = normalizeTextForMatch(candidateText);
  const prompt = normalizeTextForMatch(promptText);

  if (!candidate || !prompt) {
    return false;
  }

  if (candidate === prompt) {
    return true;
  }

  const meaningfulLength = Math.min(80, Math.max(12, Math.floor(prompt.length * 0.2)));

  if (candidate.length < meaningfulLength) {
    return false;
  }

  if (prompt.includes(candidate) || candidate.includes(prompt)) {
    return true;
  }

  const head = prompt.slice(0, 180);
  const tail = prompt.slice(-180);

  return (
    head.length >= 80 &&
    tail.length >= 80 &&
    candidate.includes(head) &&
    candidate.includes(tail)
  );
}

async function setComposerText(page, text) {
  const input = await findVisibleChatInput(page);

  if (!input) {
    throw new Error('Chat input not found while setting prompt text.');
  }

  await focusChatInput(page, input);
  await input.evaluate((element, value) => {
    element.focus();

    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('insertText', false, value);
    } catch {
      element.innerHTML = '';
      element.textContent = value;
    }

    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: value,
      inputType: 'insertText',
    }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, text);
}

async function ensureComposerHasPrompt(page, text) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const composerState = await getComposerState(page);

    if (textLooksLikePrompt(composerState.text, text)) {
      return true;
    }

    if (attempt === 0) {
      console.warn(
        '[Claude] Prompt paste was not reflected in composer, applying DOM insertion fallback.'
      );
    }

    await setComposerText(page, text);
    await sleep(700);
  }

  const composerState = await getComposerState(page);
  throw new Error(
    `Prompt was not loaded into the composer. Composer text length: ${composerState.text.length}.`
  );
}

async function findComposerSubmitButtonTarget(page) {
  try {
    return await page.evaluate(() => {
      const isVisible = (element) => {
        if (!element) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.pointerEvents !== 'none'
        );
      };

      const isDisabled = (element) =>
        Boolean(
          element.disabled ||
          element.getAttribute('aria-disabled') === 'true' ||
          element.closest('[aria-disabled="true"], [disabled], [inert]')
        );

      const composers = Array.from(document.querySelectorAll('[contenteditable="true"]'))
        .filter((element) => isVisible(element));
      const composer = composers[composers.length - 1];

      if (!composer) {
        return { found: false, reason: 'composer-not-found' };
      }

      const composerRect = composer.getBoundingClientRect();
      const containers = [];
      let cursor = composer;

      for (let depth = 0; cursor && depth < 10; depth += 1) {
        containers.push(cursor);
        cursor = cursor.parentElement;
      }

      const buttons = Array.from(new Set(
        containers.flatMap((container) => Array.from(container.querySelectorAll('button')))
      ));

      const excludedLabels =
        /attach|upload|file|image|photo|mic|voice|dictation|model|search|settings|tool|project|menu|more|close|stop|cancel|retry|copy|download|print|publish|thumb|like|dislike/i;
      const candidates = [];

      for (const button of buttons) {
        if (!isVisible(button) || isDisabled(button)) {
          continue;
        }

        const rect = button.getBoundingClientRect();
        const rawLabel = [
          button.innerText,
          button.textContent,
          button.getAttribute('aria-label'),
          button.getAttribute('title'),
          button.getAttribute('data-testid'),
          button.className,
        ].filter(Boolean).join(' ');
        const label = String(rawLabel || '').trim();
        const normalizedLabel = label.toLowerCase();
        const hasSendLabel = /send|submit/i.test(label);

        if (!hasSendLabel && excludedLabels.test(label)) {
          continue;
        }

        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const targetX = composerRect.right - 24;
        const targetY = composerRect.bottom - 24;
        const rightSide = centerX >= composerRect.left + composerRect.width * 0.55;
        const nearComposerBottom =
          centerY >= composerRect.top - 20 &&
          centerY <= composerRect.bottom + 70;
        const squareish =
          rect.width >= 20 &&
          rect.height >= 20 &&
          rect.width <= 70 &&
          rect.height <= 70 &&
          Math.abs(rect.width - rect.height) <= 24;

        let score = 0;
        if (hasSendLabel) score += 100;
        if (rightSide) score += 35;
        if (nearComposerBottom) score += 35;
        if (squareish) score += 15;
        if (button.querySelector('svg')) score += 8;
        if (!normalizedLabel) score += 5;
        score -= (Math.abs(centerX - targetX) + Math.abs(centerY - targetY)) / 20;

        candidates.push({
          x: centerX,
          y: centerY,
          score,
          label: label.slice(0, 120),
          width: rect.width,
          height: rect.height,
        });
      }

      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];

      if (!best || best.score < 10) {
        return {
          found: false,
          reason: 'submit-button-not-found',
          candidateCount: candidates.length,
          best,
        };
      }

      return {
        found: true,
        ...best,
        candidateCount: candidates.length,
      };
    });
  } catch (error) {
    return {
      found: false,
      reason: error.message,
    };
  }
}

async function clickComposerSubmitButton(page) {
  const sendButton = await findSendButton(page);

  if (sendButton && await isLocatorEnabled(sendButton)) {
    console.log('[Claude] Clicking send button...');
    await sendButton.click();
    return true;
  }

  const target = await findComposerSubmitButtonTarget(page);

  if (!target.found) {
    console.log('[Claude] Composer submit button fallback did not find a target:', target.reason);
    return false;
  }

  console.log(
    '[Claude] Clicking composer submit fallback at',
    Math.round(target.x),
    Math.round(target.y),
    'score:',
    Math.round(target.score),
    'label:',
    target.label || '(unlabeled)'
  );
  await page.mouse.click(target.x, target.y);
  return true;
}

async function waitForPromptSubmitted(page, promptText, timeoutMs = 12000) {
  const interval = 800;
  let elapsed = 0;

  while (elapsed < timeoutMs) {
    if (await hasStopGenerating(page)) {
      return { submitted: true, reason: 'stop-visible' };
    }

    const composerState = await getComposerState(page);

    if (
      composerState.available &&
      composerState.text.length < 30 &&
      !textLooksLikePrompt(composerState.text, promptText)
    ) {
      return { submitted: true, reason: 'composer-cleared' };
    }

    await sleep(interval);
    elapsed += interval;
  }

  const composerState = await getComposerState(page);
  return {
    submitted: false,
    reason: 'prompt-still-in-composer',
    composerTextLength: composerState.text.length,
  };
}

async function submitPrompt(page, text) {
  const submitAttempts = [
    {
      name: 'composer submit button',
      run: async () => clickComposerSubmitButton(page),
    },
    {
      name: 'Control+Enter',
      run: async () => {
        await page.keyboard.press('Control+Enter');
        return true;
      },
    },
    {
      name: 'Enter',
      run: async () => {
        await page.keyboard.press('Enter');
        return true;
      },
    },
  ];

  for (let round = 0; round < 2; round += 1) {
    for (const attempt of submitAttempts) {
      await ensureComposerHasPrompt(page, text);
      console.log(`[Claude] Submit attempt: ${attempt.name} (round ${round + 1})`);
      const attempted = await attempt.run();

      if (!attempted) {
        continue;
      }

      const result = await waitForPromptSubmitted(page, text);

      if (result.submitted) {
        console.log('[Claude] Prompt submitted successfully via', attempt.name, `(${result.reason}).`);
        return true;
      }

      console.warn(
        '[Claude] Prompt did not submit after',
        attempt.name,
        `(${result.reason}, composer length: ${result.composerTextLength}).`
      );

      try {
        await page.keyboard.press('Escape');
      } catch {
        // Ignore menu cleanup failures and keep the next submit attempt moving.
      }
      await sleep(500);
    }
  }

  throw new Error(
    'Prompt was not submitted to Claude. The send button was not found/clicked successfully, and keyboard submit did not clear the composer.'
  );
}

async function hasVisibleText(page, patterns) {
  try {
    return await page.evaluate((rawPatterns) => {
      const bodyText = document.body.innerText || '';

      return rawPatterns.some((pattern) => {
        const regex = new RegExp(pattern.source, pattern.flags);
        return regex.test(bodyText);
      });
    }, patterns);
  } catch {
    return false;
  }
}

async function findRetryButton(page) {
  const retryButtons = page.locator(
    'main button, main [role="button"], button[aria-label*="Retry"], button[aria-label*="Try again"]'
  ).filter({ hasText: /Retry|Try again/i });
  const count = await retryButtons.count();

  for (let index = count - 1; index >= 0; index -= 1) {
    const candidate = retryButtons.nth(index);

    if (await isLocatorVisible(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function clickIfVisible(locator) {
  if (!locator) {
    return false;
  }

  if (await isLocatorVisible(locator)) {
    await locator.click();
    return true;
  }

  return false;
}

async function clickClaudeUi(locator, page, label = 'Claude UI control') {
  if (!locator) {
    return false;
  }

  try {
    await locator.click({ timeout: 8000 });
    return true;
  } catch (error) {
    console.warn(`[Claude] ${label} click was blocked. Clearing overlays and retrying:`, error.message);
  }

  const disabledBlockers = await clearClaudePointerBlockers(page);
  if (disabledBlockers > 0) {
    console.warn(`[Claude] Cleared pointer blockers before ${label} click:`, disabledBlockers);
  }

  await sleep(250);

  try {
    await locator.click({ timeout: 8000, force: true });
    return true;
  } catch (error) {
    console.warn(`[Claude] ${label} force click failed:`, error.message);
    return false;
  }
}

async function scrollConversationToBottom(page) {
  try {
    await page.evaluate(() => {
      const scrollToBottom = (element) => {
        if (!element) {
          return;
        }

        try {
          element.scrollTop = element.scrollHeight;
        } catch {
          // Ignore elements that do not support scrolling.
        }
      };

      scrollToBottom(document.scrollingElement || document.documentElement);
      scrollToBottom(document.body);

      for (const element of document.querySelectorAll('main, [role="main"], [class*="overflow"], [class*="scroll"]')) {
        const style = window.getComputedStyle(element);
        const canScroll =
          element.scrollHeight > element.clientHeight + 20 &&
          /(auto|scroll)/.test(`${style.overflowY} ${style.overflow}`);

        if (canScroll) {
          scrollToBottom(element);
        }
      }
    });
    await sleep(300);
  } catch {
    // Scrolling is a best-effort stabilization step.
  }
}

async function extractConversationMessages(page) {
  return page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll(
        'main article, main [data-testid*="message"], main [class*="message"], main [class*="prose"], main [class*="markdown"]'
      )
    );

    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      );
    };

    return nodes
      .filter((element) => isVisible(element))
      .map((element) => {
        const text = (element.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
        const rawRole =
          element.getAttribute('data-testid') ||
          element.getAttribute('data-message-author-role') ||
          element.getAttribute('aria-label') ||
          '';

        let role = 'unknown';
        const normalizedRole = rawRole.toLowerCase();

        if (
          normalizedRole.includes('assistant') ||
          normalizedRole.includes('claude')
        ) {
          role = 'assistant';
        } else if (
          normalizedRole.includes('user') ||
          normalizedRole.includes('human')
        ) {
          role = 'user';
        }

        return { role, text };
      })
      .filter((item) => item.text.length > 0);
  });
}

function inferPipelineState(messages) {
  const assistantMessages = messages.filter((message) => message.role !== 'user');
  const fallbackText =
    assistantMessages.at(-1)?.text ||
    messages.at(-1)?.text ||
    '';

  let outlineText = assistantMessages[2]?.text || fallbackText;
  let highestStep = 0;

  for (const message of messages) {
    const matches = message.text.matchAll(/(?:buoc|step)\s*(\d+)/gi);

    for (const match of matches) {
      const stepNumber = Number.parseInt(match[1], 10);

      if (Number.isFinite(stepNumber) && stepNumber > highestStep) {
        highestStep = stepNumber;
      }
    }
  }

  if (!outlineText) {
    outlineText = 'Chua trich xuat duoc noi dung outline tu cuoc hoi thoai truoc.';
  }

  const nextStep = highestStep > 0 ? highestStep + 1 : 4;

  return { outlineText, nextStep, messages };
}

async function detectContextLimit(page) {
  return hasVisibleText(page, CONTEXT_LIMIT_PATTERNS);
}

async function getProjects(page) {
  try {
    console.log('[Claude] Fetching projects via API...');
    
    const projects = await page.evaluate(async () => {
      try {
        // Lấy organization ID từ API
        const orgRes = await fetch('https://claude.ai/api/organizations', {
          credentials: 'include'
        });
        const orgs = await orgRes.json();
        const orgId = orgs[0]?.uuid;
        
        if (!orgId) return [];
        
        // Lấy danh sách projects
        const projRes = await fetch(`https://claude.ai/api/organizations/${orgId}/projects`, {
          credentials: 'include'
        });
        const projData = await projRes.json();
        
        console.log('[Claude] Raw API response type:', typeof projData, Array.isArray(projData));
        console.log('[Claude] First item:', JSON.stringify(projData[0] || projData?.results?.[0] || projData?.data?.[0]));
        
        const projectList = Array.isArray(projData)
          ? projData
          : Array.isArray(projData?.results)
            ? projData.results
            : Array.isArray(projData?.data)
              ? projData.data
              : [];
        
        // Lọc bỏ archived projects
        return projectList
          .filter(p => !p.archived_at)
          .map(p => ({
            name: p.name,
            url: `/project/${p.uuid}`
          }));
      } catch (e) {
        console.error('Failed to fetch projects:', e);
        return [];
      }
    });
    
    console.log(`[Claude] Found ${projects.length} projects`);
    return projects;
  } catch (e) {
    console.error('[Claude] getProjects failed:', e);
    return [];
  }
}

async function navigateToProject(page, projectUrl) {
  try {
    // projectUrl dạng "/project/019c2756-86fd-721b-8014-415c03061a3b"
    const fullUrl = 'https://claude.ai' + projectUrl;
    console.log('[Claude] Navigating to project:', fullUrl);
    await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 3000));
    await createNewChat(page);
    
    // Verify đã vào đúng project
    const currentUrl = page.url();
    console.log('[Claude] Current URL after navigate:', currentUrl);
    const composerState = await getComposerState(page);
    
    if (currentUrl.includes('/project/') || composerState.available) {
      console.log('[Claude] Successfully navigated to project');
      return true;
    } else {
      console.error('[Claude] Failed to navigate to project, current URL:', currentUrl);
      return false;
    }
  } catch (e) {
    console.error('[Claude] navigateToProject failed:', e);
    return false;
  }
}

async function hasVisibleConversationHistory(page) {
  try {
    return await page.evaluate(() => {
      const isVisible = (element) => {
        if (!element) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden'
        );
      };

      const composers = Array.from(document.querySelectorAll('[contenteditable="true"]'))
        .filter((element) => isVisible(element));
      const composer = composers[composers.length - 1];
      const composerTop = composer
        ? composer.getBoundingClientRect().top
        : Number.POSITIVE_INFINITY;
      const messageNodes = Array.from(document.querySelectorAll(
        'main [data-message-author-role], main [data-testid*="message" i], main [data-testid*="assistant" i], main [data-testid*="user" i]'
      ));

      return messageNodes.some((element) => {
        if (!isVisible(element)) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        const text = (element.innerText || element.textContent || '').trim();

        return (
          rect.top < composerTop - 4 &&
          text.length >= 80 &&
          !/write a message|claude is ai and can make mistakes|want to be notified when claude responds/i.test(text)
        );
      });
    });
  } catch {
    return false;
  }
}

async function findNewChatButton(page) {
  return findFirstVisibleLocator([
    page.getByRole('link', { name: /^(?:\+\s*)?(New chat|Start new chat|New conversation)$/i }),
    page.getByRole('button', { name: /^(?:\+\s*)?(New chat|Start new chat|New conversation)$/i }),
    page.locator('a, button, [role="button"]').filter({
      hasText: /^(?:\+\s*)?(New chat|Start new chat|New conversation)$/i,
    }),
    page.locator('a[href*="/new"], a[href*="/chat/new"], button[aria-label*="New chat" i], button[title*="New chat" i]'),
  ]);
}

async function findModelSelectorButton(page) {
  return findFirstVisibleLocator([
    page.getByRole('button', { name: /Sonnet|Opus|Haiku|Claude/i }),
    page
      .locator('button[aria-haspopup="menu"], button[aria-haspopup="listbox"]')
      .filter({ hasText: /Sonnet|Opus|Haiku|Claude/i }),
    page.locator('[data-testid*="model"] button'),
  ]);
}

async function setAdaptiveThinking(page, enabled) {
  try {
    console.log(`[Claude] Setting adaptive thinking: ${enabled ? 'on' : 'off'}`);

    const modelButton = await findModelSelectorButton(page);
    if (!modelButton) {
      console.warn('[Claude] Model selector button not found while setting adaptive thinking.');
      return false;
    }

    await clickClaudeUi(modelButton, page, 'model selector for adaptive thinking');
    await randomDelay(500, 1200);

    const result = await page.evaluate((desiredEnabled) => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const isVisible = (element) => {
        if (!element) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden'
        );
      };

      const readCheckedState = (element) => {
        if (!element) {
          return null;
        }

        const readDirectState = (target) => {
          if (!target) {
            return null;
          }

          if (target.matches('input[type="checkbox"]')) {
            return target.checked;
          }

          const ariaChecked = target.getAttribute('aria-checked');
          if (ariaChecked === 'true') {
            return true;
          }
          if (ariaChecked === 'false') {
            return false;
          }

          const ariaPressed = target.getAttribute('aria-pressed');
          if (ariaPressed === 'true') {
            return true;
          }
          if (ariaPressed === 'false') {
            return false;
          }

          const dataState = target.getAttribute('data-state');
          if (dataState === 'checked' || dataState === 'on') {
            return true;
          }
          if (dataState === 'unchecked' || dataState === 'off') {
            return false;
          }

          return null;
        };

        const directState = readDirectState(element);
        if (directState !== null) {
          return directState;
        }

        const childControl = element.querySelector?.(
          '[role="switch"], [aria-checked], input[type="checkbox"], [data-state="checked"], [data-state="unchecked"], [data-state="on"], [data-state="off"]'
        );

        if (childControl) {
          return readDirectState(childControl);
        }

        if (element.matches('input[type="checkbox"]')) {
          return element.checked;
        }

        const ariaChecked = element.getAttribute('aria-checked');
        if (ariaChecked === 'true') {
          return true;
        }
        if (ariaChecked === 'false') {
          return false;
        }

        const ariaPressed = element.getAttribute('aria-pressed');
        if (ariaPressed === 'true') {
          return true;
        }
        if (ariaPressed === 'false') {
          return false;
        }

        const dataState = element.getAttribute('data-state');
        if (dataState === 'checked' || dataState === 'on') {
          return true;
        }
        if (dataState === 'unchecked' || dataState === 'off') {
          return false;
        }

        return null;
      };

      const getVisibleText = (element) => normalize(element?.innerText || element?.textContent || '');
      const getRelatedText = (element, depthLimit = 5) => {
        const parts = [
          element?.getAttribute?.('aria-label'),
          element?.getAttribute?.('title'),
          getVisibleText(element),
        ];
        let current = element?.parentElement || null;

        for (let depth = 0; current && depth < depthLimit; depth += 1) {
          parts.push(current.getAttribute?.('aria-label'), current.getAttribute?.('title'), getVisibleText(current));
          current = current.parentElement;
        }

        return normalize(parts.filter(Boolean).join(' '));
      };
      const scoreControl = (element) => {
        const state = readCheckedState(element);
        const text = getRelatedText(element);
        const rect = element.getBoundingClientRect();
        let score = 0;

        if (state !== null) {
          score -= 1000;
        }

        if (element.matches('[role="switch"], input[type="checkbox"]')) {
          score -= 200;
        }

        if (/Adaptive thinking|Extended thinking/i.test(text)) {
          score -= 100;
        }

        score += Math.min(text.length, 1000);
        score += Math.max(0, rect.width - 120);

        return score;
      };
      const controls = Array.from(document.querySelectorAll(
        '[role="switch"], [aria-checked], input[type="checkbox"], button, [role="menuitem"], [role="option"]'
      ))
        .filter((element) => {
          if (!isVisible(element)) {
            return false;
          }

          const text = getRelatedText(element);
          return /(?:Adaptive|Extended) thinking/i.test(text) && text.length < 900;
        })
        .sort((a, b) => scoreControl(a) - scoreControl(b));
      const control = controls[0];

      if (!control) {
        return { found: false, changed: false, alreadyCorrect: false };
      }
      const currentState = readCheckedState(control);
      const beforeLabel = getRelatedText(control, 3);

      if (currentState === null) {
        return {
          found: false,
          changed: false,
          alreadyCorrect: false,
          reason: 'adaptive-state-unknown',
          label: beforeLabel,
        };
      }

      if (currentState === desiredEnabled) {
        return {
          found: true,
          changed: false,
          alreadyCorrect: true,
          currentState,
          label: beforeLabel,
        };
      }

      control.click();
      return {
        found: true,
        changed: true,
        alreadyCorrect: false,
        previousState: currentState,
        label: beforeLabel,
      };
    }, Boolean(enabled));

    await randomDelay(500, 1200);
    await page.keyboard.press('Escape').catch(() => {});

    if (!result.found) {
      console.warn('[Claude] Adaptive/Extended thinking toggle not found.');
      return false;
    }

    console.log(
      result.alreadyCorrect
        ? `[Claude] Adaptive thinking already ${enabled ? 'on' : 'off'}.`
        : `[Claude] Adaptive thinking changed from ${result.previousState} to ${enabled}.`
    );
    return true;
  } catch (error) {
    console.warn('[Claude] setAdaptiveThinking failed:', error.message);
    return false;
  }
}

function getModelNamePattern(modelName) {
  const normalized = String(modelName || '').trim().replace(/\s+/g, ' ');

  if (!normalized) {
    return /^Sonnet 4\.6$/i;
  }

  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}$`, 'i');
}

function getModelNameMatcherSource(modelName) {
  const normalized = String(modelName || 'Sonnet 4.6').trim().replace(/\s+/g, ' ');
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return `(?:^|\\n|\\s)${escaped}(?:\\s|\\n|$)`;
}

async function findExactModelOption(page, modelName) {
  const modelPattern = new RegExp(getModelNameMatcherSource(modelName), 'i');
  const candidates = page.locator('button, [role="option"], [role="menuitem"], [data-radix-collection-item], [data-base-ui-collection-item], [cmdk-item]');
  const count = await candidates.count();

  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);

    if (!await isLocatorVisible(candidate, 500)) {
      continue;
    }

    const text = await candidate.evaluate((element) =>
      String(element.innerText || element.textContent || '')
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n')
    ).catch(() => '');
    if (modelPattern.test(text)) {
      return candidate;
    }
  }

  return null;
}

async function clickExactModelOptionByText(page, modelName) {
  const clicked = await page.evaluate((targetName) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const expected = normalize(targetName).toLowerCase();

    if (!expected) {
      return false;
    }

    const isVisible = (element) => {
      if (!element) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || 1) > 0
      );
    };

    const getLines = (element) => {
      const raw = String(element.innerText || element.textContent || '');
      const lines = raw
        .split('\n')
        .map(normalize)
        .filter(Boolean);
      const compact = normalize(raw);

      if (compact && !lines.includes(compact)) {
        lines.push(compact);
      }

      return lines;
    };

    const hasExactModelText = (element) => {
      const lines = getLines(element).map((line) => line.toLowerCase());

      return lines.some((line) =>
        line === expected ||
        line.startsWith(`${expected} `) ||
        line.includes(` ${expected} `)
      );
    };

    const allCandidates = Array.from(document.querySelectorAll(
      'button, [role="option"], [role="menuitem"], [role="button"], [data-radix-collection-item], [data-base-ui-collection-item], [cmdk-item], div, span'
    ))
      .filter((element) => {
        if (!isVisible(element) || !hasExactModelText(element)) {
          return false;
        }

        if (element.closest('[contenteditable="true"]')) {
          return false;
        }

        const text = normalize(element.innerText || element.textContent);
        return text.length <= 240;
      })
      .map((element) => {
        const clickable = element.closest(
          'button, [role="option"], [role="menuitem"], [role="button"], [data-radix-collection-item], [data-base-ui-collection-item], [cmdk-item]'
        ) || element;
        const rect = clickable.getBoundingClientRect();

        return {
          element,
          clickable,
          area: rect.width * rect.height,
          top: rect.top,
          left: rect.left,
        };
      })
      .filter(({ clickable }) => isVisible(clickable))
      .sort((a, b) => {
        if (a.area !== b.area) {
          return a.area - b.area;
        }

        if (a.top !== b.top) {
          return a.top - b.top;
        }

        return a.left - b.left;
      });

    const target = allCandidates[0]?.clickable;

    if (!target) {
      return false;
    }

    target.click();
    return true;
  }, modelName).catch(() => false);

  if (clicked) {
    await randomDelay(500, 1200);
  }

  return clicked;
}

async function verifySelectedModel(page, modelName, timeoutMs = 5000) {
  const modelPatternSource = getModelNameMatcherSource(modelName);

  try {
    await page.waitForFunction(
      (source) => {
        const pattern = new RegExp(source, 'i');
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const isVisible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);

          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          );
        };

        const candidates = Array.from(document.querySelectorAll('button, [role="button"]'))
          .filter((element) => {
            if (!isVisible(element)) {
              return false;
            }

            const text = normalize(element.innerText || element.textContent || element.getAttribute('aria-label'));
            return /Sonnet|Opus|Haiku/i.test(text) && text.length <= 160;
          });

        return candidates.some((element) => {
          const text = normalize(
            String(element.innerText || element.textContent || element.getAttribute('aria-label') || '')
          );

          return pattern.test(text);
        });
      },
      modelPatternSource,
      { timeout: timeoutMs }
    );

    return true;
  } catch {
    return false;
  }
}

async function openMoreModelsMenu(page) {
  const moreModels = await findFirstVisibleLocator([
    page.getByRole('menuitem', { name: /More models/i }),
    page.getByRole('button', { name: /More models/i }),
    page.locator('button, [role="menuitem"]').filter({ hasText: /More models/i }),
  ]);

  if (!moreModels) {
    return false;
  }

  await moreModels.hover().catch(() => {});
  await sleep(300);

  if (await findExactModelOption(page, 'Opus 4.6')) {
    return true;
  }

  return clickClaudeUi(moreModels, page, 'more models menu');
}

async function selectModel(page, modelName, options = {}) {
  try {
    console.log(`[Claude] Selecting model: ${modelName}`);

    const modelButton = await findModelSelectorButton(page);

    if (!modelButton) {
      console.warn('[Claude] Model selector button not found.');
      return false;
    }

    console.log('[Claude] Opening model selector...');
    await clickClaudeUi(modelButton, page, 'model selector');
    await randomDelay();

    let modelOption = await findExactModelOption(page, modelName);

    if (!modelOption && /opus\s*4\.6/i.test(String(modelName || ''))) {
      console.log('[Claude] Exact Opus 4.6 not visible. Opening More models...');
      if (await openMoreModelsMenu(page)) {
        await randomDelay(400, 900);
        modelOption = await findExactModelOption(page, modelName);
      }
    }

    if (!modelOption) {
      console.warn(`[Claude] Exact model locator not found for: ${modelName}. Trying text fallback...`);
      if (!await clickExactModelOptionByText(page, modelName)) {
        console.warn(`[Claude] Model option not found for: ${modelName}`);
        await page.keyboard.press('Escape').catch(() => {});
        return false;
      }
    } else {
      console.log('[Claude] Clicking model option...');
      if (!await clickClaudeUi(modelOption, page, `model option ${modelName}`)) {
        await page.keyboard.press('Escape').catch(() => {});
        return false;
      }
      await randomDelay();
    }

    if (!await verifySelectedModel(page, modelName, 5000)) {
      console.warn(`[Claude] Selected model was not verified as: ${modelName}`);
      return false;
    }

    if (typeof options.adaptiveThinking === 'boolean') {
      await setAdaptiveThinking(page, options.adaptiveThinking);
    }

    return true;
  } catch (error) {
    console.warn('[Claude] selectModel failed:', error.message);
    return false;
  }
}

async function createNewChat(page) {
  try {
    console.log('[Claude] Checking if chat input is ready...');

    if (await hasVisibleConversationHistory(page)) {
      console.log('[Claude] Existing conversation content detected. Opening a fresh chat...');
      const newChatButton = await findNewChatButton(page);

      if (newChatButton) {
        await clickIfVisible(newChatButton);
        await sleep(2500);
      } else {
        console.warn('[Claude] New chat button not found; continuing with current project surface.');
      }
    }
    
    // Khi đã navigate vào project page, chat input đã sẵn sàng
    // Không cần click nút gì thêm
    // Chỉ cần verify chat input tồn tại
    
    let attempts = 0;
    while (attempts < 10) {
      const hasInput = await page.evaluate(() => {
        return !!document.querySelector('div[contenteditable="true"]');
      });
      
      if (hasInput) {
        console.log('[Claude] Chat input ready. URL:', page.url());
        return page.url();
      }
      
      attempts++;
      await new Promise((r) => setTimeout(r, 2000));
    }
    
    console.log('[Claude] Warning: chat input not found after waiting');
    return page.url();
  } catch (e) {
    console.error('[Claude] createNewChat failed:', e.message);
    return page.url();
  }
}

async function verifyChatName(page, chatName, timeoutMs = 5000) {
  const expectedName = String(chatName || '').trim();

  if (!expectedName) {
    return false;
  }

  try {
    await page.waitForFunction(
      (name) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const isVisible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);

          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity || 1) > 0
          );
        };

        const candidates = Array.from(document.querySelectorAll('header *, main *'))
          .filter((element) => {
            if (!isVisible(element)) {
              return false;
            }

            const rect = element.getBoundingClientRect();

            return (
              rect.top >= 0 &&
              rect.top <= 180 &&
              rect.left >= 60 &&
              rect.left <= 900
            );
          })
          .map((element) => normalize(element.innerText || element.textContent))
          .filter(Boolean);

        return candidates.some((text) => text === name || text.includes(name));
      },
      expectedName,
      { timeout: timeoutMs }
    );

    return true;
  } catch {
    return false;
  }
}

async function findChatTitleTrigger(page) {
  return await findFirstVisibleLocator([
    page.locator('[data-testid="chat-title-button"]'),
    page.locator('button[aria-label*="rename chat" i]'),
    page.locator('[role="button"][aria-label*="rename chat" i]'),
    page.locator('button[aria-label*="edit title" i]'),
    page.locator('[role="button"][aria-label*="edit title" i]'),
  ]);
}

async function openChatTitleMenu(page) {
  const titleTrigger = await findChatTitleTrigger(page);

  if (titleTrigger) {
    if (!await clickClaudeUi(titleTrigger, page, 'chat title trigger')) {
      return false;
    }
    await randomDelay(500, 1200);
    return true;
  }

  const directMenuButton = await findFirstVisibleLocator([
    page.getByRole('button', { name: /Chat options|Conversation options|More options/i }),
    page.locator('header button[aria-haspopup="menu"]'),
    page.locator('header [role="button"][aria-haspopup="menu"]'),
    page.locator('button[aria-haspopup="menu"]').filter({ hasNotText: /Share/i }),
  ]);

  if (directMenuButton) {
    if (!await clickClaudeUi(directMenuButton, page, 'chat title menu')) {
      return false;
    }
    await randomDelay(500, 1200);
    return true;
  }

  const clickedTitleButton = await page.evaluate(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      );
    };

    const candidates = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter((element) => {
        if (!isVisible(element)) {
          return false;
        }

        const text = (element.innerText || element.getAttribute('aria-label') || '').trim();
        const rect = element.getBoundingClientRect();

        return (
          text.length > 0 &&
          !/share|send|stop|continue|retry|new chat/i.test(text) &&
          rect.top >= 40 &&
          rect.top <= 180 &&
          rect.left >= 60 &&
          rect.width >= 80
        );
      })
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();

        if (aRect.top !== bRect.top) {
          return aRect.top - bRect.top;
        }

        return aRect.left - bRect.left;
      });

    const target = candidates[0];

    if (!target) {
      return false;
    }

    target.click();
    return true;
  });

  if (clickedTitleButton) {
    await randomDelay(500, 1200);
    return true;
  }

  return false;
}

async function findRenameMenuItem(page) {
  const candidates = page.locator(
    '[role="menuitem"], [cmdk-item], [data-radix-collection-item], [data-base-ui-collection-item], [data-testid*="menu" i] button, [role="menu"] button'
  );
  const count = await candidates.count();

  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);

    if (!await isLocatorVisible(candidate, 500)) {
      continue;
    }

    const info = await candidate.evaluate((element) => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      return {
        text: normalize(element.innerText || element.textContent),
        aria: normalize(element.getAttribute('aria-label')),
        testId: normalize(element.getAttribute('data-testid')),
        role: normalize(element.getAttribute('role')),
      };
    }).catch(() => null);
    const label = `${info?.text || ''} ${info?.aria || ''}`.trim();

    if (!/Rename|Edit title|Edit chat|Edit conversation/i.test(label)) {
      continue;
    }

    if (/chat-title-button/i.test(info?.testId || '')) {
      continue;
    }

    return candidate;
  }

  return null;
}

async function findRenameField(page) {
  const candidates = page.locator('input, textarea, [role="textbox"], [contenteditable="true"]');
  const count = await candidates.count();

  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);

    if (!await isLocatorVisible(candidate, 500)) {
      continue;
    }

    const info = await candidate.evaluate((element) => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const rect = element.getBoundingClientRect();
      const labelBits = [
        element.getAttribute('aria-label'),
        element.getAttribute('placeholder'),
        element.getAttribute('name'),
        element.getAttribute('data-testid'),
        element.textContent,
      ].map(normalize).join(' ');

      return {
        label: normalize(labelBits),
        top: rect.top,
        left: rect.left,
        focused: document.activeElement === element,
        inDialog: Boolean(element.closest('[role="dialog"]')),
        inHeader: Boolean(element.closest('header')),
        testId: normalize(element.getAttribute('data-testid')),
      };
    }).catch(() => null);

    if (!info) {
      continue;
    }

    if (/chat-input|write your prompt|write a message|search/i.test(info.label) || /chat-input/i.test(info.testId)) {
      continue;
    }

    if (
      info.inDialog ||
      info.inHeader ||
      /rename|title|conversation name|chat name|name/i.test(info.label) ||
      (info.focused && info.top >= 0 && info.top <= 180 && info.left >= 60)
    ) {
      return candidate;
    }
  }

  return null;
}

async function renameChatViaUi(page, chatName) {
  console.log('[Claude] Trying UI rename fallback...');

  const openedMenu = await openChatTitleMenu(page);
  let renameField = openedMenu ? await findRenameField(page) : null;
  const renameMenuItem = !renameField && openedMenu ? await findRenameMenuItem(page) : null;

  if (renameMenuItem) {
    if (!await clickClaudeUi(renameMenuItem, page, 'rename menu item')) {
      console.warn('[Claude] Rename menu item click failed.');
      return false;
    }
    await randomDelay(500, 1200);
    renameField = await findRenameField(page);
  }

  if (!renameField) {
    if (openedMenu) {
      await page.keyboard.press('Escape');
      await sleep(300);
    }

    const titleHeading = await findFirstVisibleLocator([
      page.locator('main h1'),
      page.locator('header h1'),
      page.locator('h1'),
    ]);

    if (!titleHeading) {
      const didDoubleClickTitle = await page.evaluate(() => {
        const isVisible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);

          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          );
        };

        const candidates = Array.from(document.querySelectorAll('h1, h2, button, [role="button"], span, div'))
          .filter((element) => {
            if (!isVisible(element)) {
              return false;
            }

            const text = (element.innerText || '').trim();
            const rect = element.getBoundingClientRect();

            return (
              text.length >= 4 &&
              text.length <= 120 &&
              !/share|send|reply|sonnet|opus|haiku/i.test(text) &&
              rect.top >= 80 &&
              rect.top <= 180 &&
              rect.left >= 60 &&
              rect.width >= 80
            );
          })
          .sort((a, b) => {
            const aRect = a.getBoundingClientRect();
            const bRect = b.getBoundingClientRect();

            if (aRect.top !== bRect.top) {
              return aRect.top - bRect.top;
            }

            return aRect.left - bRect.left;
          });

        const target = candidates[0];

        if (!target) {
          return false;
        }

        target.dispatchEvent(new MouseEvent('dblclick', {
          bubbles: true,
          cancelable: true,
          view: window,
        }));
        return true;
      });

      if (!didDoubleClickTitle) {
        console.warn('[Claude] Rename UI controls not found.');
        return false;
      }
    } else {
      console.log('[Claude] Rename menu not found. Trying double-click title...');
      try {
        await titleHeading.dblclick({ timeout: 8000 });
      } catch (error) {
        console.warn('[Claude] Title double-click was blocked. Clearing overlays and retrying:', error.message);
        await clearClaudePointerBlockers(page);
        await titleHeading.dblclick({ timeout: 8000, force: true });
      }
    }

    await randomDelay(500, 1200);
    renameField = await findRenameField(page);
  }

  if (!renameField) {
    console.warn('[Claude] Rename UI field not found.');
    return false;
  }

  console.log('[Claude] Applying chat rename in UI...');
  const tagName = await renameField.evaluate((element) =>
    element.tagName.toLowerCase()
  );
  const isContentEditable = await renameField.evaluate(
    (element) => element.getAttribute('contenteditable') === 'true'
  );

  if (!await clickClaudeUi(renameField, page, 'rename field')) {
    return false;
  }

  if (tagName === 'input' || tagName === 'textarea') {
    await renameField.fill('');
    await renameField.fill(chatName);
  } else if (isContentEditable) {
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await renameField.evaluate((element, value) => {
      element.innerHTML = '';
      element.textContent = value;
      element.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }, chatName);
  } else {
    console.warn('[Claude] Unsupported rename UI field type:', tagName);
    return false;
  }

  await sleep(500);

  const saveButton = await findFirstVisibleLocator([
    page.getByRole('button', { name: /Save|Done|Update|Confirm/i }),
    page.locator('button').filter({ hasText: /Save|Done|Update|Confirm/i }),
  ]);

  if (saveButton) {
    if (!await clickClaudeUi(saveButton, page, 'rename save button')) {
      return false;
    }
  } else {
    await page.keyboard.press('Enter');
  }

  await sleep(1500);
  await closeTransientClaudeUi(page);
  return await verifyChatName(page, chatName, 5000);
}

async function renameChat(page, chatName) {
  try {
    console.log('[Claude] Renaming chat to:', chatName);

    var currentUrl = page.url();
    var chatIdMatch = currentUrl.match(/\/chat\/([a-f0-9-]+)/);
    if (!chatIdMatch) {
      console.warn('[Claude] Cannot find chat ID in URL:', currentUrl);
      return false;
    }
    var chatId = chatIdMatch[1];

    const uiRenamed = await renameChatViaUi(page, chatName);
    await closeTransientClaudeUi(page);

    if (uiRenamed) {
      console.log('[Claude] Chat renamed successfully via UI.');
      return true;
    }

    console.warn('[Claude] UI rename did not verify the visible title.');
    return false;
  } catch (error) {
    console.warn('[Claude] renameChat failed:', error.message);
    await closeTransientClaudeUi(page);
    return false;
  }
}

async function sendMessage(page, text) {
  try {
    console.log('[Claude] Sending message...');
    const responseBaseline = await getLatestResponseSnapshot(page);
    responseBaseline.submittedText = text;
    responseBaseline.artifactSignature = await getVisibleArtifactSignature(page);

    const input = await findVisibleChatInput(page);

    if (!input) {
      throw new Error('Chat input not found.');
    }

    console.log('[Claude] Focusing chat input...');
    await focusChatInput(page, input);
    await randomDelay();

    console.log('[Claude] Clearing previous input...');
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');

    let pasted = false;

    try {
      console.log('[Claude] Pasting message via clipboard...');
      await page.evaluate(async (value) => {
        await navigator.clipboard.writeText(value);
      }, text);
      await page.keyboard.press('Control+V');
      pasted = true;
    } catch (error) {
      console.warn('[Claude] Clipboard paste failed, using fallback:', error.message);
    }

    if (!pasted) {
      console.log('[Claude] Applying fallback message insertion...');
      await setComposerText(page, text);
    }

    await sleep(1000);
    await ensureComposerHasPrompt(page, text);

    console.log('[Claude] Looking for send button...');
    await submitPrompt(page, text);
    await sleep(1200);
    await scrollConversationToBottom(page);
    return responseBaseline;
  } catch (error) {
    console.warn('[Claude] sendMessage failed:', error.message);
    throw error;
  }
}

async function hasStopGenerating(page) {
  const stopButton = await findFirstVisibleLocator([
    page.getByRole('button', { name: /Stop(?: generating| response)?|Cancel/i }),
    page.locator('button[aria-label*="Stop" i], button[title*="Stop" i]'),
    page.locator('button, [role="button"]').filter({ hasText: /^Stop(?: generating| response)?$/i }),
    page.getByText(/Stop generating|Stop response/i),
  ]);

  return Boolean(stopButton);
}

async function getGenerationControlState(page) {
  const [stopVisible, composerState] = await Promise.all([
    hasStopGenerating(page),
    getComposerState(page),
  ]);
  const sendButton = await findSendButton(page);
  const sendVisible = Boolean(sendButton);
  const sendEnabled = sendButton ? await isLocatorEnabled(sendButton) : false;

  return {
    stopVisible,
    sendVisible,
    sendEnabled,
    composerReady: composerState.available,
    composerText: composerState.text,
  };
}

async function getComposerState(page) {
  try {
    return await page.evaluate(() => {
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden'
        );
      };

      const composers = Array.from(document.querySelectorAll('[contenteditable="true"]'))
        .filter((element) => isVisible(element));
      const composer = composers[composers.length - 1];

      if (!composer) {
        return {
          available: false,
          text: '',
          disabled: true,
          ariaDisabled: '',
          inert: false,
          pointerEvents: '',
        };
      }

      const style = window.getComputedStyle(composer);
      const disabledContainer = composer.closest('[aria-disabled="true"], [disabled], [inert]');

      return {
        available: !disabledContainer && style.pointerEvents !== 'none',
        text: (composer.innerText || composer.textContent || '').trim(),
        disabled: Boolean(disabledContainer),
        ariaDisabled: composer.getAttribute('aria-disabled') || '',
        inert: Boolean(composer.closest('[inert]')),
        pointerEvents: style.pointerEvents,
      };
    });
  } catch {
    return {
      available: false,
      text: '',
      disabled: true,
      ariaDisabled: '',
      inert: false,
      pointerEvents: '',
    };
  }
}

function normalizeArtifactText(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function isUsableArtifactText(text, options = {}) {
  const normalized = normalizeArtifactText(text);
  const minChars = Math.max(
    MIN_ARTIFACT_RESPONSE_CHARS,
    Math.min(Number(options.minResponseChars || 0), 8000)
  );
  const wordCount = (normalized.match(/\S+/g) || []).length;

  if (normalized.length < minChars || wordCount < 250) {
    return false;
  }

  if (
    normalized.length < 5000 &&
    /Download as \.txt|Add to project|Print as PDF|Publish artifact|Write a message/i.test(normalized)
  ) {
    return false;
  }

  const chatText = normalizeArtifactText(options.chatText);
  if (chatText && normalized === chatText) {
    return false;
  }

  return true;
}

async function getVisibleArtifactSignature(page) {
  try {
    return await page.evaluate(() => {
      const normalizeText = (value) =>
        String(value || '')
          .replace(/\r/g, '')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n[ \t]+/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();

      const isVisibleBox = (rect) =>
        rect && rect.width > 0 && rect.height > 0;

      const isElementVisible = (element) => {
        if (!element) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return (
          isVisibleBox(rect) &&
          style.display !== 'none' &&
          style.visibility !== 'hidden'
        );
      };

      const viewportWidth =
        window.innerWidth || document.documentElement.clientWidth || 0;
      const minLeft = viewportWidth * 0.45;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const pieces = [];
      const seen = new Set();

      while (walker.nextNode()) {
        const node = walker.currentNode;
        const parent = node.parentElement;

        if (
          !parent ||
          !isElementVisible(parent) ||
          parent.closest('[contenteditable="true"], nav, header, footer, script, style, noscript')
        ) {
          continue;
        }

        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = Array.from(range.getClientRects());
        const isRightPanelText = rects.some((rect) =>
          isVisibleBox(rect) && rect.left >= minLeft
        );

        if (!isRightPanelText) {
          continue;
        }

        const text = normalizeText(node.nodeValue);
        if (!text || seen.has(text)) {
          continue;
        }

        seen.add(text);
        pieces.push(text);

        if (pieces.join('\n').length > 4000) {
          break;
        }
      }

      const text = normalizeText(pieces.join('\n'));

      if (
        !text ||
        (
          text.length < 500 &&
          !/Copy|TXT|Download as \.txt|Add to project|Print as PDF|Publish artifact/i.test(text)
        )
      ) {
        return '';
      }

      return `${text.length}:${text.slice(0, 300)}:${text.slice(-300)}`;
    });
  } catch {
    return '';
  }
}

async function findArtifactCopyButton(page) {
  const buttons = page
    .locator('button, [role="button"]')
    .filter({ hasText: /Copy/i });
  const count = await buttons.count();
  const viewport = page.viewportSize() || { width: 1600, height: 900 };
  let best = null;

  for (let index = 0; index < count; index += 1) {
    const candidate = buttons.nth(index);

    if (!(await isLocatorVisible(candidate, 500))) {
      continue;
    }

    const box = await candidate.boundingBox().catch(() => null);
    if (!box) {
      continue;
    }

    const text = await candidate
      .evaluate((element) => (element.innerText || element.textContent || '').trim())
      .catch(() => '');
    const aria = await candidate
      .evaluate((element) => element.getAttribute('aria-label') || element.getAttribute('title') || '')
      .catch(() => '');
    const label = `${text} ${aria}`.trim();

    if (!/Copy/i.test(label)) {
      continue;
    }

    let score = box.x;
    if (box.x >= viewport.width * 0.45) {
      score += 5000;
    }
    if (box.y <= 180) {
      score += 1500;
    }
    if (/^Copy$/i.test(text)) {
      score += 1000;
    }
    if (box.width <= 140 && box.height <= 60) {
      score += 300;
    }

    if (!best || score > best.score) {
      best = { locator: candidate, box, score };
    }
  }

  return best;
}

async function readClipboardText(page) {
  return page.evaluate(async () => navigator.clipboard.readText());
}

async function tryCopyArtifactText(page, options = {}) {
  try {
    await page.context().grantPermissions(
      ['clipboard-read', 'clipboard-write'],
      { origin: CLAUDE_ORIGIN }
    ).catch(() => {});

    const copyButton = await findArtifactCopyButton(page);
    if (!copyButton) {
      return null;
    }

    const sentinel = `SCRIPTFORGE_CLIPBOARD_SENTINEL_${Date.now()}`;
    await page.evaluate(async (value) => {
      await navigator.clipboard.writeText(value);
    }, sentinel).catch(() => {});

    await copyButton.locator.click();
    await sleep(700);

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const clipboardText = normalizeArtifactText(await readClipboardText(page).catch(() => ''));

      if (
        clipboardText &&
        clipboardText !== sentinel &&
        isUsableArtifactText(clipboardText, options)
      ) {
        return {
          source: 'artifact-copy',
          text: clipboardText,
        };
      }

      await sleep(500);
    }

    return null;
  } catch (error) {
    console.warn('[Claude] Artifact copy extraction failed:', error.message);
    return null;
  }
}

async function findArtifactMenuButton(page, copyButtonInfo) {
  if (!copyButtonInfo?.box) {
    return null;
  }

  const buttons = page.locator('button, [role="button"]');
  const count = await buttons.count();
  const copyBox = copyButtonInfo.box;
  let best = null;

  for (let index = 0; index < count; index += 1) {
    const candidate = buttons.nth(index);

    if (!(await isLocatorVisible(candidate, 500))) {
      continue;
    }

    const box = await candidate.boundingBox().catch(() => null);
    if (!box) {
      continue;
    }

    const sameRow =
      Math.abs((box.y + box.height / 2) - (copyBox.y + copyBox.height / 2)) <= 12;
    const rightOfCopy =
      box.x >= copyBox.x + copyBox.width - 4 &&
      box.x <= copyBox.x + copyBox.width + 80;

    if (!sameRow || !rightOfCopy) {
      continue;
    }

    const score = 1000 - Math.abs(box.x - (copyBox.x + copyBox.width));
    if (!best || score > best.score) {
      best = { locator: candidate, score };
    }
  }

  return best?.locator || null;
}

async function tryDownloadArtifactText(page, options = {}) {
  try {
    const copyButton = await findArtifactCopyButton(page);
    const menuButton = await findArtifactMenuButton(page, copyButton);

    if (!menuButton) {
      return null;
    }

    await menuButton.click();
    await sleep(500);

    const menuItem = await findFirstVisibleLocator([
      page.getByRole('menuitem', { name: /Download as \.txt/i }),
      page.getByRole('button', { name: /Download as \.txt/i }),
      page.locator('[role="menuitem"], button, [cmdk-item]').filter({ hasText: /Download as \.txt/i }),
      page.getByText(/Download as \.txt/i),
    ]);

    if (!menuItem) {
      await page.keyboard.press('Escape').catch(() => {});
      return null;
    }

    const downloadPromise = page.waitForEvent('download', { timeout: 8000 });
    await menuItem.click();
    const download = await downloadPromise;
    const downloadPath = await download.path();

    if (!downloadPath) {
      return null;
    }

    const text = normalizeArtifactText(await fs.readFile(downloadPath, 'utf8'));

    if (!isUsableArtifactText(text, options)) {
      return null;
    }

    await fs.mkdir(ARTIFACT_EXPORT_DIR, { recursive: true }).catch(() => {});
    const safeName = download
      .suggestedFilename()
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    const savedPath = path.join(
      ARTIFACT_EXPORT_DIR,
      `${Date.now()}_${safeName || 'claude-artifact.txt'}`
    );
    await fs.copyFile(downloadPath, savedPath).catch(() => {});

    return {
      source: 'artifact-download',
      text,
      path: savedPath,
    };
  } catch (error) {
    console.warn('[Claude] Artifact download extraction failed:', error.message);
    return null;
  }
}

async function extractClaudeArtifactText(page, options = {}) {
  const baselineSignature = options.baselineArtifactSignature || '';
  const currentSignature = await getVisibleArtifactSignature(page);
  const chatText = String(options.chatText || '');
  const responseMentionsArtifact =
    /artifact|txt|download|attached|saved|created.{0,60}file|generated.{0,60}file|file.{0,60}(?:created|saved|attached|generated)|t(?:a|\u1ea1)o file|d(?:a|\u00e3) t(?:a|\u1ea1)o/i.test(chatText);

  if (!currentSignature) {
    return null;
  }

  if (baselineSignature && currentSignature === baselineSignature && !responseMentionsArtifact) {
    console.log('[Claude] Artifact panel appears unchanged. Skipping artifact extraction.');
    return null;
  }

  const copyResult = await tryCopyArtifactText(page, options);
  if (copyResult) {
    console.log('[Claude] Extracted Claude artifact via Copy. Length:', copyResult.text.length);
    return copyResult;
  }

  const downloadResult = await tryDownloadArtifactText(page, options);
  if (downloadResult) {
    console.log(
      '[Claude] Extracted Claude artifact via Download as .txt. Length:',
      downloadResult.text.length
    );
    return downloadResult;
  }

  return null;
}

async function findContinueGeneratingButton(page) {
  return findFirstVisibleLocator([
    page.getByRole('button', { name: /Continue(?: generating| response)?/i }),
    page.locator('button[aria-label*="Continue" i], button[title*="Continue" i]'),
    page.locator('button, [role="button"]').filter({ hasText: /^Continue(?: generating| response)?$/i }),
    page.getByText(/Continue generating|Continue response/i),
  ]);
}

async function detectClaudeConnectionError(page) {
  try {
    return await page.evaluate((patterns) => {
      const regexes = patterns.map((pattern) => new RegExp(pattern.source, pattern.flags));
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const isVisible = (element) => {
        if (!element) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity || 1) > 0
        );
      };

      const selectors = [
        '[role="alert"]',
        '[role="status"]',
        '[aria-live]',
        '[data-testid*="toast" i]',
        '[data-testid*="notification" i]',
        '[class*="toast" i]',
        '[class*="notification" i]',
        '[class*="error" i]',
      ];
      const elements = Array.from(document.querySelectorAll(selectors.join(',')));
      const visibleMessages = elements
        .filter((element) => isVisible(element))
        .map((element) => normalize(element.innerText || element.textContent))
        .filter(Boolean);

      const bodyText = normalize(document.body?.innerText || '');
      if (bodyText.length < 20000) {
        visibleMessages.push(bodyText);
      }

      for (const message of visibleMessages) {
        for (const regex of regexes) {
          const match = message.match(regex);
          if (match) {
            const start = Math.max(0, match.index - 80);
            const end = Math.min(message.length, match.index + match[0].length + 120);
            return message.slice(start, end).trim();
          }
        }
      }

      return '';
    }, CLAUDE_CONNECTION_ERROR_PATTERNS.map((pattern) => ({
      source: pattern.source,
      flags: pattern.flags,
    })));
  } catch {
    return '';
  }
}

async function extractLatestResponseText(page) {
  const snapshot = await getLatestResponseSnapshot(page);
  return snapshot.text;
}

async function getLatestResponseSnapshot(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main') || document.body;

    const normalizeText = (value) =>
      (value || '')
        .replace(/\r/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\b(?:Retry|Try again|Continue generating|Stop generating)\b/g, '')
        .replace(/\b(?:Reply\.\.\.|Claude is AI and can make mistakes\. Please double-check responses\.)\b/g, '')
        .replace(/\bWant to be notified when Claude responds\?/gi, '')
        .replace(/^\s*(?:Share|Copy|Like|Dislike|Notify|Dismiss|Write a message\.\.\.)\s*$/gim, '')
        .replace(/^\s*(?:Sonnet|Opus|Haiku)\s+\d(?:\.\d)?(?:\s+Adaptive)?\s*$/gim, '')
        .replace(/^\s*(?:Adaptive thinking|Adaptive|More models|Most efficient for everyday tasks|Thinks for more complex tasks)\s*$/gim, '')
        .trim();

    const isVisibleBox = (rect) =>
      rect && rect.width > 0 && rect.height > 0;

    const isElementVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return (
        isVisibleBox(rect) &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      );
    };

    const getComposerTop = () => {
      const composers = Array.from(document.querySelectorAll('[contenteditable="true"]'))
        .filter((element) => isElementVisible(element));
      const composer = composers[composers.length - 1];

      if (!composer) {
        return Number.POSITIVE_INFINITY;
      }

      return composer.getBoundingClientRect().top;
    };

    const shouldSkipElement = (element) => {
      if (!element) {
        return true;
      }

      if (element.closest('[contenteditable="true"]')) {
        return true;
      }

      if (
        element.closest('button, [role="button"], input, textarea, select, nav, aside, header, footer, script, style, noscript')
      ) {
        return true;
      }

      if (
        element.closest('[data-testid*="toast" i], [data-testid*="notification" i], [class*="toast" i], [class*="notification" i]')
      ) {
        return true;
      }

      const elementText = element.innerText || element.textContent || '';
      if (
        elementText.length < 500 &&
        /Want to be notified when Claude responds|Claude is AI and can make mistakes|Write a message/i.test(elementText)
      ) {
        return true;
      }

      return false;
    };

    const composerTop = getComposerTop();
    const blockCandidates = [];
    const texts = [];
    const seenText = new Set();
    let candidateCount = 0;

    const addText = (text) => {
      const normalized = normalizeText(text);

      if (!normalized || normalized.length < 2 || seenText.has(normalized)) {
        return;
      }

      if (
        normalized.length > 40 &&
        texts.some((existing) => existing.includes(normalized))
      ) {
        return;
      }

      for (let index = texts.length - 1; index >= 0; index -= 1) {
        const existing = texts[index];

        if (
          existing.length > 40 &&
          normalized.length > existing.length &&
          normalized.includes(existing)
        ) {
          texts.splice(index, 1);
          seenText.delete(existing);
        }
      }

      seenText.add(normalized);
      texts.push(normalized);
    };

    const countMarker = (text, pattern) =>
      (text.match(pattern) || []).length;

    const getElementDepth = (element) => {
      let depth = 0;
      let current = element;

      while (current && current !== document.body) {
        depth += 1;
        current = current.parentElement;
      }

      return depth;
    };

    const getSourcePriority = (sourceName, element) => {
      const rawMeta = [
        element.getAttribute('data-message-author-role'),
        element.getAttribute('data-testid'),
        element.getAttribute('aria-label'),
        element.className,
      ].join(' ').toLowerCase();

      if (rawMeta.includes('assistant') || rawMeta.includes('claude')) {
        return 7000;
      }

      if (rawMeta.includes('message')) {
        return 4500;
      }

      if (/article|prose|markdown|font-claude-message/.test(sourceName)) {
        return 3500;
      }

      if (/pre|blockquote|table/.test(sourceName)) {
        return 2000;
      }

      if (/generic/.test(sourceName)) {
        return 500;
      }

      return 1000;
    };

    const addBlockCandidate = (element, sourceName) => {
      if (shouldSkipElement(element) || !isElementVisible(element)) {
        return;
      }

      const rect = element.getBoundingClientRect();
      if (rect.top >= composerTop - 4 || rect.bottom <= 0) {
        return;
      }

      const text = normalizeText(element.innerText || element.textContent || '');

      if (!text || text.length < 100) {
        return;
      }

      if (
        text.length < 500 &&
        /want to be notified when claude responds|write a message|claude is ai and can make mistakes/i.test(text)
      ) {
        return;
      }

      const distanceToComposer = Number.isFinite(composerTop)
        ? Math.max(0, composerTop - rect.bottom)
        : Math.max(0, window.innerHeight - rect.bottom);
      const messageTurnCount =
        countMarker(text, /\bYou said:/gi) +
        countMarker(text, /\bClaude responded:/gi);

      let score = 0;
      score += Math.max(0, 5000 - distanceToComposer) * 4;
      score += Math.min(text.length, 16000) / 4;
      score += getSourcePriority(sourceName, element);
      score += Math.min(getElementDepth(element), 40) * 15;

      if (messageTurnCount > 2) {
        score -= messageTurnCount * 1500;
      }

      if (text.length > 50000) {
        score -= 6000;
      } else if (text.length > 30000) {
        score -= 2500;
      }

      blockCandidates.push({
        element,
        text,
        sourceName,
        score,
        rectBottom: rect.bottom,
        textLength: text.length,
      });
    };

    const semanticBlockSelector = [
      '[data-message-author-role]',
      '[data-testid*="message" i]',
      '[data-testid*="assistant" i]',
      '[data-testid*="conversation" i]',
      '[class*="font-claude-message"]',
      '[class*="prose"]',
      '[class*="markdown"]',
      '[class*="message" i]',
      'article',
      'pre',
      'blockquote',
      'table',
    ].join(', ');

    for (const element of main.querySelectorAll(semanticBlockSelector)) {
      addBlockCandidate(element, 'semantic');
    }

    if (!blockCandidates.some((candidate) => candidate.textLength >= 500)) {
      for (const element of main.querySelectorAll('section, div')) {
        addBlockCandidate(element, 'generic');
      }
    }

    for (const candidate of blockCandidates) {
      const nestedEquivalent = blockCandidates.some((other) =>
        other !== candidate &&
        candidate.element.contains(other.element) &&
        Math.abs(other.rectBottom - candidate.rectBottom) <= 32 &&
        other.textLength >= candidate.textLength * 0.55 &&
        other.textLength < candidate.textLength * 0.98
      );

      if (nestedEquivalent) {
        candidate.score -= 2500;
      }
    }

    const bestBlockCandidate = blockCandidates
      .sort((left, right) => right.score - left.score)[0];

    if (bestBlockCandidate && bestBlockCandidate.text.length >= 100) {
      const text = bestBlockCandidate.text;
      const source = `latest-${bestBlockCandidate.sourceName}`;
      const signature = `${source}:${text.length}:${text.slice(0, 160)}:${text.slice(-300)}`;

      return {
        text,
        signature,
        count: blockCandidates.length,
        sourceWeight: bestBlockCandidate.score,
        source,
        candidateCount: blockCandidates.length,
      };
    }

    const blockSelector = [
      'main [data-message-author-role]',
      'main [data-testid*="message"]',
      'main [data-testid*="assistant"]',
      'main [class*="font-claude-message"]',
      'main [class*="prose"]',
      'main [class*="markdown"]',
      'main article',
      'main pre',
      'main blockquote',
      'main p',
      'main li',
      'main h2',
      'main h3',
      'main h4',
    ].join(', ');

    for (const element of main.querySelectorAll(blockSelector)) {
      if (shouldSkipElement(element) || !isElementVisible(element)) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      if (rect.top >= composerTop - 4) {
        continue;
      }

      candidateCount += 1;
      addText(element.innerText);
    }

    let source = 'blocks';
    let text = normalizeText(texts.join('\n\n'));

    const collectVisibleTextNodes = (root, minLeft = 0) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const fallbackTexts = [];
      const fallbackSeen = new Set();

      while (walker.nextNode()) {
        const node = walker.currentNode;
        const parent = node.parentElement;

        if (shouldSkipElement(parent)) {
          continue;
        }

        const rawText = node.nodeValue || '';
        const normalized = normalizeText(rawText);

        if (!normalized || fallbackSeen.has(normalized)) {
          continue;
        }

        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = Array.from(range.getClientRects());
        const isReadablePageText = rects.some((rect) =>
          isVisibleBox(rect) &&
          rect.top < composerTop - 4 &&
          rect.left >= minLeft
        );

        if (!isReadablePageText) {
          continue;
        }

        fallbackSeen.add(normalized);
        fallbackTexts.push(normalized);
      }

      return {
        text: normalizeText(fallbackTexts.join(' ')),
        count: fallbackTexts.length,
      };
    };

    if (text.length < 100) {
      const fallback = collectVisibleTextNodes(main);

      if (fallback.text.length > text.length) {
        source = 'text-nodes';
        text = fallback.text;
        candidateCount = fallback.count;
      }
    }

    if (text.length < 100 && main !== document.body) {
      const bodyFallback = collectVisibleTextNodes(document.body, 60);

      if (bodyFallback.text.length > text.length) {
        source = 'body-text-nodes';
        text = bodyFallback.text;
        candidateCount = bodyFallback.count;
      }
    }

    if (text.length < 100) {
      const rawMainText = normalizeText(main.innerText);

      if (rawMainText.length > text.length) {
        source = 'main';
        text = rawMainText;
        candidateCount = rawMainText ? 1 : 0;
      }
    }

    if (text.length < 100 && main !== document.body) {
      const rawBodyText = normalizeText(document.body.innerText);

      if (rawBodyText.length > text.length) {
        source = 'body';
        text = rawBodyText;
        candidateCount = rawBodyText ? 1 : 0;
      }
    }

    const signature = text
      ? `${source}:${text.length}:${text.slice(0, 160)}:${text.slice(-300)}`
      : `0:0`;

    return {
      text,
      signature,
      count: candidateCount,
      sourceWeight: 0,
      source,
      candidateCount,
    };
  });
}

async function getResponseSnapshotAfterSubmittedPrompt(page, submittedText) {
  if (!submittedText || String(submittedText).trim().length < 80) {
    return null;
  }

  try {
    return await page.evaluate((rawSubmittedText) => {
      const normalizeText = (value) =>
        (value || '')
          .replace(/\r/g, '')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n[ \t]+/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .replace(/\b(?:Retry|Try again|Continue generating|Stop generating)\b/g, '')
          .replace(/\b(?:Reply\.\.\.|Claude is AI and can make mistakes\. Please double-check responses\.)\b/g, '')
          .replace(/\bWant to be notified when Claude responds\?/gi, '')
          .replace(/^\s*(?:Share|Copy|Like|Dislike|Notify|Dismiss|Write a message\.\.\.)\s*$/gim, '')
          .replace(/^\s*(?:Sonnet|Opus|Haiku)\s+\d(?:\.\d)?(?:\s+Adaptive)?\s*$/gim, '')
          .replace(/^\s*(?:Adaptive thinking|Adaptive|More models|Most efficient for everyday tasks|Thinks for more complex tasks)\s*$/gim, '')
          .trim();

      const main = document.querySelector('main') || document.body;
      const pageText = normalizeText(main.innerText || document.body.innerText || '');
      const submitted = normalizeText(rawSubmittedText);

      if (!pageText || submitted.length < 80) {
        return null;
      }

      const sampleStarts = [
        0,
        Math.max(0, Math.floor(submitted.length * 0.35) - 300),
        Math.max(0, Math.floor(submitted.length * 0.7) - 300),
        Math.max(0, submitted.length - 1200),
        Math.max(0, submitted.length - 800),
        Math.max(0, submitted.length - 500),
      ];
      const samples = Array.from(new Set(sampleStarts))
        .map((start) => submitted.slice(start, start + 1200).trim())
        .concat([
          submitted.slice(-1000).trim(),
          submitted.slice(-700).trim(),
          submitted.slice(-450).trim(),
        ])
        .filter((sample) => sample.length >= 180)
        .sort((left, right) => right.length - left.length);

      let bestEnd = -1;
      let bestSample = '';

      for (const sample of samples) {
        const index = pageText.lastIndexOf(sample);
        if (index < 0) {
          continue;
        }

        const end = index + sample.length;
        if (end > bestEnd) {
          bestEnd = end;
          bestSample = sample;
        }
      }

      if (bestEnd < 0) {
        return null;
      }

      let text = pageText.slice(bestEnd);
      text = normalizeText(text)
        .replace(/^Claude responded:\s*/i, '')
        .replace(/^\s*(?:Show more|pasted)\s*$/gim, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      if (!text || text.length < 20) {
        return null;
      }

      return {
        text,
        signature: `after-submitted:${bestEnd}:${text.length}:${bestSample.slice(0, 80)}:${text.slice(-300)}`,
        count: 1,
        sourceWeight: bestEnd,
        source: 'after-submitted-prompt',
        candidateCount: 1,
      };
    }, submittedText);
  } catch {
    return null;
  }
}

async function getResponseSnapshotAfterBaseline(page, baselineText, submittedText) {
  if (!baselineText || String(baselineText).trim().length < 80) {
    return null;
  }

  try {
    return await page.evaluate(({ rawBaselineText, rawSubmittedText }) => {
      const normalizeText = (value) =>
        (value || '')
          .replace(/\r/g, '')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n[ \t]+/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .replace(/\b(?:Retry|Try again|Continue generating|Stop generating)\b/g, '')
          .replace(/\b(?:Reply\.\.\.|Claude is AI and can make mistakes\. Please double-check responses\.)\b/g, '')
          .replace(/\bWant to be notified when Claude responds\?/gi, '')
          .replace(/^\s*(?:Share|Copy|Like|Dislike|Notify|Dismiss|Write a message\.\.\.)\s*$/gim, '')
          .replace(/^\s*(?:Sonnet|Opus|Haiku)\s+\d(?:\.\d)?(?:\s+Adaptive)?\s*$/gim, '')
          .replace(/^\s*(?:Adaptive thinking|Adaptive|More models|Most efficient for everyday tasks|Thinks for more complex tasks)\s*$/gim, '')
          .trim();

      const normalizeComparableText = (value) =>
        normalizeText(value)
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();

      const isVisibleBox = (rect) =>
        rect && rect.width > 0 && rect.height > 0;

      const isElementVisible = (element) => {
        if (!element) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return (
          isVisibleBox(rect) &&
          style.display !== 'none' &&
          style.visibility !== 'hidden'
        );
      };

      const getComposerTop = () => {
        const composers = Array.from(document.querySelectorAll('[contenteditable="true"]'))
          .filter((element) => isElementVisible(element));
        const composer = composers[composers.length - 1];

        if (!composer) {
          return Number.POSITIVE_INFINITY;
        }

        return composer.getBoundingClientRect().top;
      };

      const shouldSkipElement = (element) => {
        if (!element) {
          return true;
        }

        if (element.closest('[contenteditable="true"]')) {
          return true;
        }

        if (
          element.closest('button, [role="button"], input, textarea, select, nav, aside, header, footer, script, style, noscript')
        ) {
          return true;
        }

        if (
          element.closest('[data-testid*="toast" i], [data-testid*="notification" i], [class*="toast" i], [class*="notification" i]')
        ) {
          return true;
        }

        const elementText = element.innerText || element.textContent || '';
        if (
          elementText.length < 500 &&
          /Want to be notified when Claude responds|Claude is AI and can make mistakes|Write a message/i.test(elementText)
        ) {
          return true;
        }

        return false;
      };

      const baseline = normalizeText(rawBaselineText);
      const baselineComparable = normalizeComparableText(rawBaselineText);
      const submittedComparable = normalizeComparableText(rawSubmittedText);

      if (!baseline || baselineComparable.length < 80) {
        return null;
      }

      const baselineHead = baselineComparable.slice(0, 220);
      const baselineTail = baselineComparable.slice(-320);

      const isBaselineText = (text) => {
        const comparable = normalizeComparableText(text);

        if (!comparable) {
          return false;
        }

        if (comparable === baselineComparable) {
          return true;
        }

        if (
          comparable.length >= baselineComparable.length * 0.9 &&
          comparable.includes(baselineHead) &&
          comparable.includes(baselineTail)
        ) {
          return true;
        }

        return (
          baselineComparable.length >= 500 &&
          comparable.length >= 500 &&
          baselineComparable.includes(comparable.slice(0, 240)) &&
          baselineComparable.includes(comparable.slice(-240))
        );
      };

      const isSubmittedPromptText = (text) => {
        if (!submittedComparable) {
          return false;
        }

        const comparable = normalizeComparableText(text);

        if (!comparable) {
          return false;
        }

        return (
          comparable === submittedComparable ||
          (
            comparable.length >= 120 &&
            comparable.length <= submittedComparable.length * 1.1 &&
            submittedComparable.includes(comparable)
          )
        );
      };

      const isUiNoise = (text) => {
        const comparable = normalizeComparableText(text);

        return (
          comparable.length <= 400 &&
          /want to be notified when claude responds|write a message|claude is ai and can make mistakes|sonnet \d|opus \d|haiku \d|adaptive thinking|more models|most efficient for everyday tasks/.test(comparable)
        );
      };

      const getSourcePriority = (element) => {
        const rawMeta = [
          element.getAttribute('data-message-author-role'),
          element.getAttribute('data-testid'),
          element.getAttribute('aria-label'),
          element.className,
        ].join(' ').toLowerCase();

        if (rawMeta.includes('assistant') || rawMeta.includes('claude')) {
          return 4;
        }

        if (rawMeta.includes('message')) {
          return 3;
        }

        return 1;
      };

      const main = document.querySelector('main') || document.body;
      const composerTop = getComposerTop();
      const semanticBlockSelector = [
        '[data-message-author-role]',
        '[data-testid*="message" i]',
        '[data-testid*="assistant" i]',
        '[data-testid*="conversation" i]',
        '[class*="font-claude-message"]',
        '[class*="prose"]',
        '[class*="markdown"]',
        '[class*="message" i]',
        'article',
        'pre',
        'blockquote',
        'table',
      ].join(', ');

      const elements = Array.from(main.querySelectorAll(semanticBlockSelector));
      let baselineIndex = -1;
      const candidates = [];

      elements.forEach((element, index) => {
        if (shouldSkipElement(element) || !isElementVisible(element)) {
          return;
        }

        const rect = element.getBoundingClientRect();
        if (rect.top >= composerTop - 4 || rect.bottom <= 0) {
          return;
        }

        const text = normalizeText(element.innerText || element.textContent || '');
        if (!text || text.length < 100 || isUiNoise(text)) {
          return;
        }

        if (isBaselineText(text)) {
          baselineIndex = Math.max(baselineIndex, index);
          return;
        }

        candidates.push({
          index,
          text,
          sourcePriority: getSourcePriority(element),
          textLength: text.length,
        });
      });

      if (baselineIndex < 0) {
        return null;
      }

      const afterBaseline = candidates
        .filter((candidate) =>
          candidate.index > baselineIndex &&
          !isSubmittedPromptText(candidate.text) &&
          !normalizeComparableText(candidate.text).includes(baselineTail)
        )
        .sort((left, right) => {
          if (left.index !== right.index) {
            return right.index - left.index;
          }

          if (left.sourcePriority !== right.sourcePriority) {
            return right.sourcePriority - left.sourcePriority;
          }

          return right.textLength - left.textLength;
        });

      const best = afterBaseline[0];

      if (!best) {
        return null;
      }

      return {
        text: best.text,
        signature: `after-baseline:${baselineIndex}:${best.index}:${best.text.length}:${best.text.slice(0, 80)}:${best.text.slice(-300)}`,
        count: afterBaseline.length,
        sourceWeight: best.index,
        source: 'after-baseline',
        candidateCount: afterBaseline.length,
      };
    }, {
      rawBaselineText: baselineText,
      rawSubmittedText: submittedText || '',
    });
  } catch {
    return null;
  }
}

async function getLastAssistantResponseSnapshot(page, baselineText, submittedText) {
  try {
    return await page.evaluate(({ rawBaselineText, rawSubmittedText }) => {
      const normalizeText = (value) =>
        (value || '')
          .replace(/\r/g, '')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n[ \t]+/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .replace(/\b(?:Retry|Try again|Continue generating|Stop generating)\b/g, '')
          .replace(/\b(?:Reply\.\.\.|Claude is AI and can make mistakes\. Please double-check responses\.)\b/g, '')
          .replace(/\bWant to be notified when Claude responds\?/gi, '')
          .replace(/^\s*(?:Share|Copy|Like|Dislike|Notify|Dismiss|Write a message\.\.\.)\s*$/gim, '')
          .replace(/^\s*(?:Sonnet|Opus|Haiku)\s+\d(?:\.\d)?(?:\s+Adaptive)?\s*$/gim, '')
          .replace(/^\s*(?:Adaptive thinking|Adaptive|More models|Most efficient for everyday tasks|Thinks for more complex tasks)\s*$/gim, '')
          .trim();

      const normalizeComparableText = (value) =>
        normalizeText(value)
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();

      const isVisibleBox = (rect) =>
        rect && rect.width > 0 && rect.height > 0;

      const isElementVisible = (element) => {
        if (!element) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return (
          isVisibleBox(rect) &&
          style.display !== 'none' &&
          style.visibility !== 'hidden'
        );
      };

      const getComposerTop = () => {
        const composers = Array.from(document.querySelectorAll('[contenteditable="true"]'))
          .filter((element) => isElementVisible(element));
        const composer = composers[composers.length - 1];

        if (!composer) {
          return Number.POSITIVE_INFINITY;
        }

        return composer.getBoundingClientRect().top;
      };

      const shouldSkipElement = (element) => {
        if (!element) {
          return true;
        }

        if (element.closest('[contenteditable="true"]')) {
          return true;
        }

        if (
          element.closest('button, [role="button"], input, textarea, select, nav, aside, header, footer, script, style, noscript')
        ) {
          return true;
        }

        if (
          element.closest('[data-testid*="toast" i], [data-testid*="notification" i], [class*="toast" i], [class*="notification" i]')
        ) {
          return true;
        }

        const elementText = element.innerText || element.textContent || '';
        if (
          elementText.length < 500 &&
          /Want to be notified when Claude responds|Claude is AI and can make mistakes|Write a message/i.test(elementText)
        ) {
          return true;
        }

        return false;
      };

      const stripKnownText = (candidateText, knownText, options = {}) => {
        if (!candidateText || !knownText || knownText.length < 80) {
          return candidateText || '';
        }

        if (candidateText === knownText) {
          return '';
        }

        const prefixOnly = Boolean(options.prefixOnly);
        const directIndex = candidateText.lastIndexOf(knownText);

        if (directIndex >= 0 && (!prefixOnly || directIndex <= 500)) {
          return candidateText.slice(directIndex + knownText.length).trim();
        }

        const knownTail = knownText.slice(-500).trim();
        if (knownTail.length >= 80) {
          const tailIndex = candidateText.lastIndexOf(knownTail);
          if (tailIndex >= 0 && (!prefixOnly || tailIndex <= 500)) {
            return candidateText.slice(tailIndex + knownTail.length).trim();
          }
        }

        const knownHead = knownText.slice(0, 500).trim();
        if (knownHead.length >= 80) {
          const headIndex = candidateText.indexOf(knownHead);
          if (headIndex >= 0 && candidateText.length > knownText.length) {
            return candidateText.slice(headIndex + knownText.length).trim();
          }
        }

        return candidateText;
      };

      const baseline = normalizeText(rawBaselineText);
      const submitted = normalizeText(rawSubmittedText);
      const baselineComparable = normalizeComparableText(rawBaselineText);
      const submittedComparable = normalizeComparableText(rawSubmittedText);

      const isBaselineText = (text) => {
        const comparable = normalizeComparableText(text);

        if (!comparable || !baselineComparable) {
          return false;
        }

        return (
          comparable === baselineComparable ||
          (
            comparable.length >= baselineComparable.length * 0.9 &&
            comparable.includes(baselineComparable.slice(0, 220)) &&
            comparable.includes(baselineComparable.slice(-320))
          )
        );
      };

      const isSubmittedPromptText = (text) => {
        const comparable = normalizeComparableText(text);

        if (!comparable || !submittedComparable) {
          return false;
        }

        return (
          comparable === submittedComparable ||
          (
            comparable.length >= 120 &&
            comparable.length <= submittedComparable.length * 1.1 &&
            submittedComparable.includes(comparable)
          )
        );
      };

      const isUiNoise = (text) => {
        const comparable = normalizeComparableText(text);

        return (
          comparable.length <= 400 &&
          /want to be notified when claude responds|write a message|claude is ai and can make mistakes|sonnet \d|opus \d|haiku \d|adaptive thinking|more models|most efficient for everyday tasks/.test(comparable)
        );
      };

      const getRole = (element, text) => {
        const rawMeta = [
          element.getAttribute('data-message-author-role'),
          element.getAttribute('data-testid'),
          element.getAttribute('aria-label'),
          element.className,
        ].join(' ').toLowerCase();

        if (rawMeta.includes('user') || rawMeta.includes('human')) {
          return 'user';
        }

        if (rawMeta.includes('assistant') || rawMeta.includes('claude')) {
          return 'assistant';
        }

        if (isSubmittedPromptText(text)) {
          return 'user';
        }

        return 'unknown';
      };

      const main = document.querySelector('main') || document.body;
      const composerTop = getComposerTop();
      const selector = [
        '[data-message-author-role]',
        '[data-testid*="message" i]',
        '[data-testid*="assistant" i]',
        '[data-testid*="conversation" i]',
        '[class*="font-claude-message"]',
        '[class*="prose"]',
        '[class*="markdown"]',
        '[class*="message" i]',
        'article'
      ].join(', ');

      const candidates = [];
      const seen = new Set();

      Array.from(main.querySelectorAll(selector)).forEach((element, index) => {
        if (shouldSkipElement(element) || !isElementVisible(element)) {
          return;
        }

        const rect = element.getBoundingClientRect();
        if (rect.top >= composerTop - 4 || rect.bottom <= 0) {
          return;
        }

        let text = normalizeText(element.innerText || element.textContent || '');
        if (!text || text.length < 100 || isUiNoise(text)) {
          return;
        }

        const role = getRole(element, text);
        if (role === 'user') {
          return;
        }

        text = stripKnownText(text, submitted);
        text = stripKnownText(text, baseline, { prefixOnly: true });
        text = stripKnownText(text, submitted).trim();

        if (!text || text.length < 100 || isBaselineText(text) || isSubmittedPromptText(text) || isUiNoise(text)) {
          return;
        }

        const comparable = normalizeComparableText(text);
        if (!comparable || seen.has(comparable)) {
          return;
        }

        seen.add(comparable);

        candidates.push({
          index,
          text,
          role,
          bottom: rect.bottom,
          priority: role === 'assistant' ? 2 : 1,
        });
      });

      const best = candidates
        .sort((left, right) => {
          if (left.index !== right.index) {
            return right.index - left.index;
          }

          if (left.priority !== right.priority) {
            return right.priority - left.priority;
          }

          return right.bottom - left.bottom;
        })[0];

      if (!best) {
        return null;
      }

      return {
        text: best.text,
        signature: `last-assistant:${best.index}:${best.text.length}:${best.text.slice(0, 80)}:${best.text.slice(-300)}`,
        count: candidates.length,
        sourceWeight: best.index,
        source: 'last-assistant',
        candidateCount: candidates.length,
      };
    }, {
      rawBaselineText: baselineText || '',
      rawSubmittedText: submittedText || '',
    });
  } catch {
    return null;
  }
}

async function getConversationResponseSnapshotViaApi(page, baselineText, submittedText) {
  try {
    return await page.evaluate(async ({ rawBaselineText, rawSubmittedText }) => {
      const normalizeText = (value) =>
        (value || '')
          .replace(/\r/g, '')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n[ \t]+/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();

      const normalizeComparableText = (value) =>
        normalizeText(value)
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();

      const baseline = normalizeText(rawBaselineText);
      const submitted = normalizeText(rawSubmittedText);
      const baselineComparable = normalizeComparableText(baseline);
      const submittedComparable = normalizeComparableText(submitted);
      const chatId = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/i)?.[1];

      if (!chatId) {
        return null;
      }

      const isBaselineText = (text) => {
        const comparable = normalizeComparableText(text);

        if (!comparable || !baselineComparable) {
          return false;
        }

        return (
          comparable === baselineComparable ||
          (
            comparable.length >= baselineComparable.length * 0.9 &&
            comparable.includes(baselineComparable.slice(0, 220)) &&
            comparable.includes(baselineComparable.slice(-320))
          )
        );
      };

      const isSubmittedPromptText = (text) => {
        const comparable = normalizeComparableText(text);

        if (!comparable || !submittedComparable) {
          return false;
        }

        return (
          comparable === submittedComparable ||
          (
            comparable.length >= 120 &&
            comparable.length <= submittedComparable.length * 1.1 &&
            submittedComparable.includes(comparable)
          )
        );
      };

      const collectTextParts = (value, depth = 0) => {
        if (depth > 8 || value == null) {
          return [];
        }

        if (typeof value === 'string') {
          const text = normalizeText(value);
          return text ? [text] : [];
        }

        if (Array.isArray(value)) {
          return value.flatMap((item) => collectTextParts(item, depth + 1));
        }

        if (typeof value !== 'object') {
          return [];
        }

        const textKeys = [
          'text',
          'content',
          'completion',
          'response',
          'message',
        ];
        const parts = [];

        for (const key of textKeys) {
          if (Object.prototype.hasOwnProperty.call(value, key)) {
            parts.push(...collectTextParts(value[key], depth + 1));
          }
        }

        return parts;
      };

      const readRole = (value) => {
        if (!value || typeof value !== 'object') {
          return '';
        }

        const rawRole = [
          value.role,
          value.sender,
          value.author,
          value.author_role,
          value.sender_role,
          value.message_author_role,
          value.type,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        if (/assistant|claude/.test(rawRole)) {
          return 'assistant';
        }

        if (/human|user/.test(rawRole)) {
          return 'user';
        }

        return '';
      };

      const findMessages = (value, depth = 0, output = []) => {
        if (depth > 10 || value == null) {
          return output;
        }

        if (Array.isArray(value)) {
          for (const item of value) {
            findMessages(item, depth + 1, output);
          }
          return output;
        }

        if (typeof value !== 'object') {
          return output;
        }

        const role = readRole(value);
        if (role) {
          const text = normalizeText(collectTextParts(value).join('\n\n'));

          if (text.length >= 20) {
            output.push({ role, text });
          }
        }

        for (const key of [
          'chat_messages',
          'messages',
          'turns',
          'conversation',
          'children',
          'items',
          'data',
          'results',
        ]) {
          if (Object.prototype.hasOwnProperty.call(value, key)) {
            findMessages(value[key], depth + 1, output);
          }
        }

        return output;
      };

      const orgRes = await fetch('https://claude.ai/api/organizations', {
        credentials: 'include',
      });

      if (!orgRes.ok) {
        return null;
      }

      const orgs = await orgRes.json();
      const orgList = Array.isArray(orgs) ? orgs : [];

      for (const org of orgList) {
        const orgId = org?.uuid;
        if (!orgId) {
          continue;
        }

        const url =
          `https://claude.ai/api/organizations/${orgId}/chat_conversations/${chatId}`;
        const response = await fetch(url, { credentials: 'include' });

        if (!response.ok) {
          continue;
        }

        const data = await response.json();
        const messages = findMessages(data);
        const assistantMessages = messages
          .filter((message) => message.role === 'assistant')
          .filter((message) =>
            message.text.length >= 100 &&
            !isBaselineText(message.text) &&
            !isSubmittedPromptText(message.text)
          );
        const best = assistantMessages.at(-1);

        if (!best) {
          continue;
        }

        return {
          text: best.text,
          signature: `api-conversation:${chatId}:${assistantMessages.length}:${best.text.length}:${best.text.slice(0, 80)}:${best.text.slice(-300)}`,
          count: assistantMessages.length,
          sourceWeight: assistantMessages.length,
          source: 'api-conversation',
          candidateCount: assistantMessages.length,
        };
      }

      return null;
    }, {
      rawBaselineText: baselineText || '',
      rawSubmittedText: submittedText || '',
    });
  } catch {
    return null;
  }
}

function createResponseTooShortError({ stepNumber, minResponseChars, actualLength }) {
  const stepLabel = stepNumber ? ` for step ${stepNumber}` : '';
  const error = new Error(
    `Claude response too short${stepLabel}: ${actualLength} chars captured, expected at least ${minResponseChars}. Claude may have created an artifact or only returned a summary.`
  );
  error.code = 'CLAUDE_RESPONSE_TOO_SHORT';
  error.actualLength = actualLength;
  error.minResponseChars = minResponseChars;
  error.stepNumber = stepNumber;
  return error;
}

function canAcceptShortStableResponse(stepNumber) {
  return true;
}

async function waitForResponse(page, responseBaseline = null, options = {}) {
  console.log('[Claude] Waiting for response (message-scoped mode)...');

  const maxWait = RESPONSE_TIMEOUT_MS;
  const interval = 3000;
  const minResponseChars = Math.max(
    MIN_FINAL_RESPONSE_CHARS,
    Number(options.minResponseChars || DEFAULT_MIN_RESPONSE_CHARS)
  );
  const stepNumber = options.stepNumber;
  const minStableResponseChars = Number(stepNumber || 0) >= 7 ? 20 : MIN_FINAL_RESPONSE_CHARS;
  let elapsed = 0;
  let lastNewText = '';
  let stableCount = 0;
  let retryCount = 0;
  let stopComposerReadyLogged = false;
  let lastCapturedSource = '';
  const baseline = responseBaseline || await getLatestResponseSnapshot(page);
  console.log('[Claude] Baseline response length:', baseline.text.length);

  const normalizeComparableText = (value) =>
    String(value || '')
      .replace(/\r/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const isSubmittedPromptText = (candidateText) => {
    const submittedText = baseline.submittedText || '';

    if (!submittedText || !candidateText) {
      return false;
    }

    const candidateComparable = normalizeComparableText(candidateText);
    const submittedComparable = normalizeComparableText(submittedText);

    if (!candidateComparable || !submittedComparable) {
      return false;
    }

    if (candidateComparable === submittedComparable) {
      return true;
    }

    if (
      candidateComparable.length >= 120 &&
      submittedComparable.includes(candidateComparable)
    ) {
      return true;
    }

    if (
      submittedComparable.length >= 120 &&
      candidateComparable.includes(submittedComparable)
    ) {
      return true;
    }

    const head = candidateComparable.slice(0, 180);
    const tail = candidateComparable.slice(-180);

    if (
      candidateComparable.length > 240 &&
      submittedComparable.includes(head) &&
      submittedComparable.includes(tail)
    ) {
      return true;
    }

    const sampleStarts = [
      0,
      Math.max(0, Math.floor(candidateComparable.length * 0.25) - 60),
      Math.max(0, Math.floor(candidateComparable.length * 0.5) - 60),
      Math.max(0, Math.floor(candidateComparable.length * 0.75) - 60),
      Math.max(0, candidateComparable.length - 120),
    ];
    const samples = Array.from(new Set(sampleStarts))
      .map((start) => candidateComparable.slice(start, start + 120).trim())
      .filter((sample) => sample.length >= 80);
    const matchedSamples = samples.filter((sample) =>
      submittedComparable.includes(sample)
    ).length;

    return (
      samples.length >= 3 &&
      matchedSamples / samples.length >= 0.75
    );
  };

  const stripKnownText = (candidateText, knownText, options = {}) => {
    if (!candidateText || !knownText || knownText.length < 80) {
      return candidateText || '';
    }

    if (candidateText === knownText) {
      return '';
    }

    const prefixOnly = Boolean(options.prefixOnly);

    const directIndex = candidateText.lastIndexOf(knownText);
    if (directIndex >= 0 && (!prefixOnly || directIndex <= 500)) {
      return candidateText.slice(directIndex + knownText.length).trim();
    }

    const knownTail = knownText.slice(-500).trim();
    if (knownTail.length >= 80) {
      const tailIndex = candidateText.lastIndexOf(knownTail);
      if (tailIndex >= 0 && (!prefixOnly || tailIndex <= 500)) {
        return candidateText.slice(tailIndex + knownTail.length).trim();
      }
    }

    const knownHead = knownText.slice(0, 500).trim();
    if (knownHead.length >= 80) {
      const headIndex = candidateText.indexOf(knownHead);
      if (headIndex >= 0 && candidateText.length > knownText.length) {
        return candidateText.slice(headIndex + knownText.length).trim();
      }
    }

    return candidateText;
  };

  const isOnlySubmittedPromptText = (candidateText) => {
    const submittedText = baseline.submittedText || '';

    if (!submittedText || !candidateText) {
      return false;
    }

    const candidateComparable = normalizeComparableText(candidateText);
    const submittedComparable = normalizeComparableText(submittedText);

    if (!candidateComparable || !submittedComparable) {
      return false;
    }

    return (
      candidateComparable === submittedComparable ||
      (
        candidateComparable.length >= 120 &&
        candidateComparable.length <= submittedComparable.length * 1.1 &&
        submittedComparable.includes(candidateComparable)
      )
    );
  };

  const isUiNoiseResponse = (candidateText) => {
    const comparable = normalizeComparableText(candidateText);

    if (!comparable || comparable.length > 400) {
      return false;
    }

    return /want to be notified when claude responds|write a message|claude is ai and can make mistakes|sonnet \d|opus \d|haiku \d|adaptive thinking|more models|most efficient for everyday tasks/.test(comparable);
  };

  const getResponseTextFromSnapshot = (snapshot) => {
    const originalText = (snapshot?.text || '').trim();
    let candidateText = originalText;

    candidateText = stripKnownText(candidateText, baseline.submittedText);
    candidateText = stripKnownText(candidateText, baseline.text, { prefixOnly: true });
    candidateText = stripKnownText(candidateText, baseline.submittedText);

    if (isSubmittedPromptText(candidateText) || isUiNoiseResponse(candidateText)) {
      return '';
    }

    candidateText = candidateText.trim();

    if (
      candidateText.length < minResponseChars &&
      originalText.length >= minResponseChars &&
      !isOnlySubmittedPromptText(originalText) &&
      !isUiNoiseResponse(originalText)
    ) {
      return originalText;
    }

    return candidateText;
  };

  const readCurrentResponse = async () => {
    const snapshot = await getLatestResponseSnapshot(page);
    let text =
      snapshot.signature !== baseline.signature
        ? getResponseTextFromSnapshot(snapshot)
        : '';

    const submittedPromptSnapshot = await getResponseSnapshotAfterSubmittedPrompt(
      page,
      baseline.submittedText
    );

    if (submittedPromptSnapshot) {
      const submittedPromptText = getResponseTextFromSnapshot(submittedPromptSnapshot);
      if (submittedPromptText.length > text.length) {
        return {
          snapshot: submittedPromptSnapshot,
          text: submittedPromptText,
        };
      }
    }

    const afterBaselineSnapshot = await getResponseSnapshotAfterBaseline(
      page,
      baseline.text,
      baseline.submittedText
    );

    if (afterBaselineSnapshot) {
      const afterBaselineText = getResponseTextFromSnapshot(afterBaselineSnapshot);
      if (afterBaselineText.length > text.length) {
        return {
          snapshot: afterBaselineSnapshot,
          text: afterBaselineText,
        };
      }
    }

    const lastAssistantSnapshot = await getLastAssistantResponseSnapshot(
      page,
      baseline.text,
      baseline.submittedText
    );

    if (lastAssistantSnapshot) {
      const lastAssistantText = getResponseTextFromSnapshot(lastAssistantSnapshot);
      if (lastAssistantText.length > text.length) {
        return {
          snapshot: lastAssistantSnapshot,
          text: lastAssistantText,
        };
      }
    }

    const apiSnapshot = await getConversationResponseSnapshotViaApi(
      page,
      baseline.text,
      baseline.submittedText
    );

    if (apiSnapshot) {
      const apiText = getResponseTextFromSnapshot(apiSnapshot);
      if (apiText.length > text.length) {
        return {
          snapshot: apiSnapshot,
          text: apiText,
        };
      }
    }

    return { snapshot, text };
  };

  await sleep(5000);

  while (elapsed < maxWait) {
    try {
      const connectionErrorMessage = await detectClaudeConnectionError(page);
      if (connectionErrorMessage) {
        throw createClaudeConnectionError(connectionErrorMessage);
      }

      const immediateRetryButton = await findRetryButton(page);
      if (immediateRetryButton) {
        if (retryCount >= MAX_RESPONSE_RETRIES) {
          throw createClaudeConnectionError(
            `Claude đang hiện nút Try again/Retry sau ${retryCount} lần thử lại.`
          );
        }

        console.log('[Claude] Try again/Retry button is visible. Clicking retry... attempt', retryCount + 1);
        await clickIfVisible(immediateRetryButton);
        retryCount += 1;
        await sleep(5000);
        stableCount = 0;
        lastNewText = '';
        elapsed += 5000;
        continue;
      }

      const controlState = await getGenerationControlState(page);

      if (controlState.stopVisible) {
        await scrollConversationToBottom(page);
        const activeResponse = await readCurrentResponse();
        if (
          activeResponse.snapshot.signature !== baseline.signature &&
          activeResponse.text.length >= MIN_PARTIAL_RESPONSE_CHARS
        ) {
          lastNewText = activeResponse.text;
          if (activeResponse.snapshot.source !== lastCapturedSource) {
            lastCapturedSource = activeResponse.snapshot.source;
            console.log(
              '[Claude] Capturing response via',
              lastCapturedSource,
              'length:',
              lastNewText.length
            );
          }
        }

        if (!stopComposerReadyLogged) {
          console.log('[Claude] Stop control is visible. Claude is still generating.');
          stopComposerReadyLogged = true;
        }

        stableCount = 0;
        elapsed += interval;
        await sleep(interval);
        continue;
      }

      if (!controlState.composerReady) {
        stableCount = 0;
        elapsed += interval;
        await sleep(interval);
        continue;
      }

      const continueButton = await findContinueGeneratingButton(page);
      if (continueButton) {
        console.log('[Claude] Clicking Continue generating...');
        await clickIfVisible(continueButton);
        await sleep(3000);
        stableCount = 0;
        elapsed += 3000;
        continue;
      }

      await scrollConversationToBottom(page);
      const currentResponse = await readCurrentResponse();
      const currentNewText = currentResponse.text;

      if (
        currentNewText.length >= MIN_PARTIAL_RESPONSE_CHARS &&
        currentNewText === lastNewText
      ) {
        stableCount += 1;
      } else {
        stableCount = 0;
        if (currentNewText.length > 0) {
          lastNewText = currentNewText;
          if (currentResponse.snapshot.source !== lastCapturedSource) {
            lastCapturedSource = currentResponse.snapshot.source;
            console.log(
              '[Claude] Capturing response via',
              lastCapturedSource,
              'length:',
              lastNewText.length
            );
          }
        }
      }

      const hasEnoughFinalText = lastNewText.length >= minResponseChars;
      const hasStableButTooShortText =
        lastNewText.length >= minStableResponseChars &&
        lastNewText.length < minResponseChars &&
        elapsed >= SHORT_RESPONSE_ACCEPT_MS;

      if (stableCount >= 3 && hasEnoughFinalText) {
        console.log('[Claude] Response complete. New text length:', lastNewText.length);
        return lastNewText;
      }

      if (stableCount >= 3 && hasStableButTooShortText) {
        if (!canAcceptShortStableResponse(stepNumber)) {
          throw createResponseTooShortError({
            stepNumber,
            minResponseChars,
            actualLength: lastNewText.length,
          });
        }

        console.warn(
          '[Claude] Stable response is shorter than the preferred minimum. Continuing anyway. Length:',
          lastNewText.length,
          'preferred minimum:',
          minResponseChars
        );
        return lastNewText;
      }

    } catch (error) {
      if (
        error?.code === 'CLAUDE_RESPONSE_TOO_SHORT' ||
        error?.code === 'CLAUDE_CONNECTION_ERROR'
      ) {
        throw error;
      }

      console.log('[Claude] Poll check error (ignoring)');
    }

    elapsed += interval;
    await sleep(interval);

    if (elapsed % 30000 === 0) {
      const debugSnapshot = await getLatestResponseSnapshot(page);
      const debugControlState = await getGenerationControlState(page);
      console.log(
        '[Claude] Still waiting...',
        Math.round(elapsed / 1000) + 's, new text:',
        lastNewText.length,
        'chars, snapshot:',
        debugSnapshot.text.length,
        'chars via',
        debugSnapshot.source,
        'candidates:',
        debugSnapshot.candidateCount,
        'composerReady:',
        debugControlState.composerReady,
        'stopVisible:',
        debugControlState.stopVisible,
        'sendVisible:',
        debugControlState.sendVisible,
        'sendEnabled:',
        debugControlState.sendEnabled
      );
    }
  }

  if (lastNewText.length >= minResponseChars) {
    console.log('[Claude] Timeout but has new text. Length:', lastNewText.length);
    return lastNewText;
  }

  if (lastNewText.length > 0) {
    console.warn(
      '[Claude] Timeout captured text was shorter than preferred minimum. Continuing anyway. Length:',
      lastNewText.length,
      'preferred minimum:',
      minResponseChars
    );
    return lastNewText;
  }

  throw new Error(
    `Timed out waiting for Claude response. Last captured text was too short (${lastNewText.length} chars, minimum ${minResponseChars}).`
  );
}

async function handleContextLimit(page, socket) {
  try {
    console.log('[Claude] Checking for context limit...');

    const hasContextLimit = await detectContextLimit(page);

    if (!hasContextLimit) {
      console.log('[Claude] Context limit not detected.');
      return page;
    }

    console.log('[Claude] Context limit detected, extracting completed work...');
    const messages = await extractConversationMessages(page);
    const { outlineText, nextStep } = inferPipelineState(messages);
    const completedResults = messages.map((message, index) => ({
      index: index + 1,
      role: message.role,
      text: message.text,
    }));

    console.log('[Claude] Creating a new chat in the current project...');
    await createNewChat(page);

    const resetMessage =
      'Toi dang viet kich ban, day la dan y da hoan thanh:\n\n' +
      `${outlineText}\n\n` +
      `Hay tiep tuc tu buoc ${nextStep}.`;

    await sendMessage(page, resetMessage);

    if (socket && typeof socket.emit === 'function') {
      socket.emit('context_reset', {
        reason: 'context_limit',
        nextStep,
        completedResults,
      });
    }

    console.log('[Claude] context_reset emitted and recovery chat prepared.');

    return page;
  } catch (error) {
    console.warn('[Claude] handleContextLimit failed:', error.message);
    throw error;
  }
}

module.exports = {
  getProjects,
  navigateToProject,
  selectModel,
  createNewChat,
  renameChat,
  sendMessage,
  waitForResponse,
  extractClaudeArtifactText,
  handleContextLimit,
};
