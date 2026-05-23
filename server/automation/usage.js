const USAGE_URL = 'https://claude.ai/settings/usage';
const CLAUDE_ORIGIN = 'https://claude.ai';

function clampPercent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }

  return Math.max(0, Math.min(100, value));
}

function parsePercent(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return clampPercent(number);
}

function createUsageMetric({ label, usedPercent = null, resetText = '', note = '' }) {
  const normalizedUsedPercent = clampPercent(usedPercent);

  return {
    label,
    usedPercent: normalizedUsedPercent,
    remainingPercent:
      normalizedUsedPercent === null ? null : clampPercent(100 - normalizedUsedPercent),
    resetText,
    note,
  };
}

function formatResetText(resetsAt) {
  if (!resetsAt) {
    return '';
  }

  const date = new Date(resetsAt);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return `Resets ${date.toLocaleString('en-US', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

function metricFromApi(label, value, note = '') {
  if (!value) {
    return createUsageMetric({
      label,
      note,
    });
  }

  return {
    ...createUsageMetric({
      label,
      usedPercent: parsePercent(value.utilization),
      resetText: formatResetText(value.resets_at),
      note,
    }),
    resetsAt: value.resets_at || null,
  };
}

function findLine(lines, pattern) {
  return lines.find((line) => pattern.test(line)) || '';
}

function parseClaudeUsageText(text) {
  const lines = String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const compactText = lines.join('\n');
  const percentMatches = [...compactText.matchAll(/(\d{1,3})%\s+used/gi)].map((match) =>
    parsePercent(match[1])
  );
  const routineMatch = compactText.match(/(\d+)\s*\/\s*(\d+)/);
  const resetInLine = findLine(lines, /^Resets in\b/i);
  const weeklyResetLine =
    lines.find((line) => /^Resets\b/i.test(line) && !/^Resets in\b/i.test(line)) || '';
  const planMatch = compactText.match(/Plan usage limits\s*([^\n]+)/i);
  const lastUpdated = findLine(lines, /^Last updated:/i);

  return {
    fetchedAt: new Date().toISOString(),
    plan: planMatch?.[1] || '',
    currentSession: createUsageMetric({
      label: 'Current session',
      usedPercent: percentMatches[0] ?? null,
      resetText: resetInLine,
    }),
    weekly: [
      createUsageMetric({
        label: 'All models',
        usedPercent: percentMatches[1] ?? null,
        resetText: weeklyResetLine,
      }),
      createUsageMetric({
        label: 'Sonnet only',
        usedPercent: percentMatches[2] ?? null,
        note: findLine(lines, /Sonnet/i) ? findLine(lines, /haven't used Sonnet/i) : '',
      }),
      createUsageMetric({
        label: 'Claude Design',
        usedPercent: percentMatches[3] ?? null,
        note: findLine(lines, /Claude Design/i) ? findLine(lines, /haven't used Claude Design/i) : '',
      }),
    ],
    dailyRoutineRuns: routineMatch
      ? {
          used: Number(routineMatch[1]),
          limit: Number(routineMatch[2]),
        }
      : null,
    lastUpdated,
  };
}

function normalizeClaudeUsageApi(payload, organizationId, textFallback = null) {
  return {
    fetchedAt: new Date().toISOString(),
    organizationId,
    source: 'usage-api',
    plan: textFallback?.plan || '',
    currentSession: metricFromApi('Current session', payload?.five_hour),
    weekly: [
      metricFromApi('All models', payload?.seven_day),
      metricFromApi(
        'Sonnet only',
        payload?.seven_day_sonnet,
        payload?.seven_day_sonnet?.utilization === 0 ? "You haven't used Sonnet yet" : ''
      ),
      metricFromApi(
        'Claude Design',
        payload?.seven_day_omelette,
        payload?.seven_day_omelette?.utilization === 0
          ? "You haven't used Claude Design yet"
          : ''
      ),
    ],
    dailyRoutineRuns: textFallback?.dailyRoutineRuns || null,
    extraUsage: payload?.extra_usage || null,
    raw: payload,
    lastUpdated: `Fetched ${new Date().toLocaleTimeString('en-GB')}`,
  };
}

async function fetchUsageViaApi(page) {
  return page.evaluate(async (origin) => {
    const orgRes = await fetch(`${origin}/api/organizations`, {
      credentials: 'include',
    });

    if (!orgRes.ok) {
      throw new Error(`Failed to fetch organizations: ${orgRes.status}`);
    }

    const organizations = await orgRes.json();
    const organizationId = organizations?.[0]?.uuid;

    if (!organizationId) {
      throw new Error('Claude organization id not found.');
    }

    const usageRes = await fetch(`${origin}/api/organizations/${organizationId}/usage`, {
      credentials: 'include',
    });

    if (!usageRes.ok) {
      throw new Error(`Failed to fetch usage: ${usageRes.status}`);
    }

    return {
      organizationId,
      payload: await usageRes.json(),
    };
  }, CLAUDE_ORIGIN);
}

async function readClaudeUsage(page) {
  await page.goto(USAGE_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  await page.waitForTimeout(1500);

  const text = await page.evaluate(() => document.body?.innerText || '');
  const textUsage = parseClaudeUsageText(text);

  try {
    const { organizationId, payload } = await fetchUsageViaApi(page);
    const usage = normalizeClaudeUsageApi(payload, organizationId, textUsage);

    return {
      ...usage,
      sourceUrl: `${CLAUDE_ORIGIN}/api/organizations/${organizationId}/usage`,
    };
  } catch (error) {
    console.warn('[Usage] API fetch failed, falling back to page text:', error.message);
  }

  return {
    ...textUsage,
    source: 'usage-page-text',
    sourceUrl: page.url(),
  };
}

module.exports = {
  USAGE_URL,
  normalizeClaudeUsageApi,
  parseClaudeUsageText,
  readClaudeUsage,
};
