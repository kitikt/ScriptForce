const CLAUDE_ORIGIN = 'https://claude.ai';
const RESPONSE_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_RESPONSE_RETRIES = 2;
const CONTEXT_LIMIT_PATTERNS = [
  /context (window )?(is )?(full|too long|exceeded)/i,
  /conversation (is )?too long/i,
  /message (is )?too long/i,
  /too many tokens/i,
  /prompt is too long/i,
  /context limit/i,
  /reduce the length/i,
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

async function findFirstVisibleLocator(locators) {
  for (const locator of locators) {
    const candidate = locator.first();

    if (await isLocatorVisible(candidate)) {
      return candidate;
    }
  }

  return null;
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
  return findFirstVisibleLocator([
    page.getByRole('button', { name: /Retry|Try again/i }),
    page.locator('button[aria-label*="Retry"], button[aria-label*="Try again"]'),
    page.getByText(/Retry|Try again/i),
  ]);
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
    
    // Verify đã vào đúng project
    const currentUrl = page.url();
    console.log('[Claude] Current URL after navigate:', currentUrl);
    
    if (currentUrl.includes('/project/')) {
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

async function selectModel(page, modelName) {
  try {
    console.log(`[Claude] Selecting model: ${modelName}`);

    const keyword = String(modelName || '').toLowerCase();
    let modelPattern = /Sonnet/i;

    if (keyword.includes('opus')) {
      modelPattern = /Opus/i;
    } else if (keyword.includes('haiku')) {
      modelPattern = /Haiku/i;
    } else if (keyword.includes('sonnet')) {
      modelPattern = /Sonnet/i;
    }

    const modelButton = await findFirstVisibleLocator([
      page.getByRole('button', { name: /Sonnet|Opus|Haiku|Claude/i }),
      page
        .locator('button[aria-haspopup="menu"], button[aria-haspopup="listbox"]')
        .filter({ hasText: /Sonnet|Opus|Haiku|Claude/i }),
      page.locator('[data-testid*="model"] button'),
    ]);

    if (!modelButton) {
      console.warn('[Claude] Model selector button not found.');
      return false;
    }

    console.log('[Claude] Opening model selector...');
    await modelButton.click();
    await randomDelay();

    const modelOption = await findFirstVisibleLocator([
      page.getByRole('option', { name: modelPattern }),
      page.getByRole('menuitem', { name: modelPattern }),
      page.getByRole('button', { name: modelPattern }),
      page
        .locator('button, [role="option"], [role="menuitem"]')
        .filter({ hasText: modelPattern }),
      page.getByText(modelPattern),
    ]);

    if (!modelOption) {
      console.warn(`[Claude] Model option not found for: ${modelName}`);
      return false;
    }

    console.log('[Claude] Clicking model option...');
    await modelOption.click();
    await randomDelay();

    return true;
  } catch (error) {
    console.warn('[Claude] selectModel failed:', error.message);
    return false;
  }
}

async function createNewChat(page) {
  try {
    console.log('[Claude] Checking if chat input is ready...');
    
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

async function renameChat(page, chatName) {
  try {
    console.log(`[Claude] Renaming chat to: ${chatName}`);

    const editButton = await findFirstVisibleLocator([
      page.getByRole('button', { name: /Rename|Edit title|Edit chat|Edit conversation/i }),
      page.locator('button[aria-label*="Rename"], button[title*="Rename"]'),
      page.locator('button[aria-label*="Edit"], button[title*="Edit"]'),
    ]);

    if (editButton) {
      console.log('[Claude] Opening rename UI via edit button...');
      await editButton.click();
      await randomDelay();
    } else {
      const titleHeading = await findFirstVisibleLocator([
        page.locator('main h1'),
        page.locator('header h1'),
        page.locator('h1'),
      ]);

      if (!titleHeading) {
        console.warn('[Claude] Rename controls not found. Skipping rename.');
        return false;
      }

      console.log('[Claude] Trying double-click on chat title...');
      await titleHeading.dblclick();
      await randomDelay();
    }

    const renameField = await findFirstVisibleLocator([
      page.locator('[role="dialog"] input[type="text"]'),
      page.locator('header input[type="text"]'),
      page.locator('input[type="text"]'),
      page.locator('[role="dialog"] textarea'),
      page.locator('header [contenteditable="true"]'),
      page.locator('[role="dialog"] [contenteditable="true"]'),
    ]);

    if (!renameField) {
      console.warn('[Claude] Rename field not found. Skipping rename.');
      return false;
    }

    const tagName = await renameField.evaluate((element) =>
      element.tagName.toLowerCase()
    );
    const isContentEditable = await renameField.evaluate(
      (element) => element.getAttribute('contenteditable') === 'true'
    );

    console.log('[Claude] Applying new chat name...');
    await renameField.click();

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
      console.warn('[Claude] Unsupported rename field type. Skipping rename.');
      return false;
    }

    await page.keyboard.press('Enter');
    await randomDelay();

    return true;
  } catch (error) {
    console.warn('[Claude] renameChat failed:', error.message);
    return false;
  }
}

async function sendMessage(page, text) {
  try {
    console.log('[Claude] Sending message...');

    const input = await findVisibleChatInput(page);

    if (!input) {
      throw new Error('Chat input not found.');
    }

    console.log('[Claude] Focusing chat input...');
    await input.click();
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
      await input.evaluate((element, value) => {
        element.innerHTML = '';
        element.textContent = value;
        element.dispatchEvent(new InputEvent('input', { bubbles: true }));
      }, text);
    }

    await sleep(1000);

    console.log('[Claude] Looking for send button...');
    const sendButton = await findFirstVisibleLocator([
      page.getByRole('button', { name: /Send/i }),
      page.locator('button[aria-label*="Send"]'),
      page.locator('button[title*="Send"]'),
      page.locator('button:has(svg)').filter({ hasNotText: /Stop generating/i }),
    ]);

    if (sendButton) {
      console.log('[Claude] Clicking send button...');
      await sendButton.click();
    } else {
      console.log('[Claude] Send button not found, trying keyboard submit...');

      try {
        await page.keyboard.press('Control+Enter');
      } catch {
        await page.keyboard.press('Enter');
      }
    }

    await sleep(2000);
  } catch (error) {
    console.warn('[Claude] sendMessage failed:', error.message);
    throw error;
  }
}

async function hasStopGenerating(page) {
  const stopButton = await findFirstVisibleLocator([
    page.getByRole('button', { name: /Stop generating/i }),
    page.locator('button[aria-label*="Stop generating"]'),
    page.getByText(/Stop generating/i),
  ]);

  return Boolean(stopButton);
}

async function findContinueGeneratingButton(page) {
  return findFirstVisibleLocator([
    page.getByRole('button', { name: /Continue generating/i }),
    page.locator('button[aria-label*="Continue generating"]'),
    page.getByText(/Continue generating/i),
  ]);
}

async function extractLatestResponseText(page) {
  return page.evaluate(() => {
    const selectors = [
      'main [data-testid*="assistant"]',
      'main [data-testid*="message"]',
      'main article',
      'main [class*="prose"]',
      'main [class*="markdown"]',
    ];
    const seen = new Set();
    const texts = [];

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

    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (!isVisible(element)) {
          continue;
        }

        const text = (element.innerText || '')
          .replace(/\n{3,}/g, '\n\n')
          .trim();

        if (!text || text.length < 20 || seen.has(text)) {
          continue;
        }

        seen.add(text);
        texts.push(text);
      }
    }

    return texts[texts.length - 1] || '';
  });
}

async function waitForResponse(page) {
  console.log('[Claude] Waiting for response (baseline mode)...');
  var maxWait = 15 * 60 * 1000;
  var interval = 3000;
  var elapsed = 0;
  var lastNewText = '';
  var stableCount = 0;
  var retryCount = 0;

  // Lay baseline: toan bo text tren page truoc khi response xuat hien.
  var baselineLength = await page.evaluate(function() {
    return (document.body.innerText || '').length;
  });
  console.log('[Claude] Baseline text length: ' + baselineLength);

  await new Promise(function(r) { setTimeout(r, 5000); });

  while (elapsed < maxWait) {
    try {
      var retryBtn = await page.$('button:has-text("Retry"), button:has-text("Try again")');
      if (retryBtn && retryCount < 2) {
        console.log('[Claude] Clicking retry...');
        await retryBtn.click();
        retryCount++;
        await new Promise(function(r) { setTimeout(r, 5000); });
        stableCount = 0;
        lastNewText = '';
        elapsed += 5000;
        continue;
      }

      var stopBtn = await page.$('button[aria-label="Stop Response"], button:has-text("Stop")');
      if (stopBtn) {
        stableCount = 0;
        elapsed += interval;
        await new Promise(function(r) { setTimeout(r, interval); });
        continue;
      }

      var continueBtn = await page.$('button:has-text("Continue")');
      if (continueBtn) {
        console.log('[Claude] Clicking Continue...');
        await continueBtn.click();
        await new Promise(function(r) { setTimeout(r, 3000); });
        stableCount = 0;
        elapsed += 3000;
        continue;
      }

      // Lay text moi: phan text dai hon baseline.
      var currentNewText = await page.evaluate(function(bl) {
        var bodyText = document.body.innerText || '';
        if (bodyText.length > bl + 100) {
          return bodyText.substring(bl);
        }
        return '';
      }, baselineLength);

      if (currentNewText.length > 100 && currentNewText === lastNewText) {
        stableCount++;
      } else {
        stableCount = 0;
        if (currentNewText.length > 0) lastNewText = currentNewText;
      }

      // Text moi on dinh 3 lan (9 giay) = response xong.
      if (stableCount >= 3 && lastNewText.length > 100) {
        console.log('[Claude] Response done. New text length: ' + lastNewText.length);
        return lastNewText;
      }

    } catch (e) {
      console.log('[Claude] Poll error (ignoring)');
    }

    elapsed += interval;
    await new Promise(function(r) { setTimeout(r, interval); });

    if (elapsed % 30000 === 0) {
      console.log('[Claude] Still waiting... ' + Math.round(elapsed/1000) + 's, new text: ' + lastNewText.length + ' chars');
    }
  }

  if (lastNewText.length > 100) {
    console.log('[Claude] Timeout but has new text. Length: ' + lastNewText.length);
    return lastNewText;
  }
  throw new Error('Response timeout after 15 minutes');
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
  handleContextLimit,
};
