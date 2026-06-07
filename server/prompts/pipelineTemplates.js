const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');

const { STEPS } = require('./templates');

const DATA_ROOT_DIR = process.env.SCRIPTFORGE_DATA_DIR || path.join(__dirname, '..');
const TEMPLATE_ROOT_DIR = path.join(DATA_ROOT_DIR, 'pipeline-templates');
const TEMPLATE_CONFIG_PATH = path.join(TEMPLATE_ROOT_DIR, 'templates.json');
const KIET_TEMPLATE_ID = 'kiet-video-viral';

function nowIso() {
  return new Date().toISOString();
}

function createKietTemplate() {
  const now = nowIso();

  return {
    id: KIET_TEMPLATE_ID,
    name: 'Template của Kiệt',
    description: 'Pipeline viết kịch bản video viral 1,5 tiếng.',
    modelName: 'Sonnet 4.6',
    adaptiveThinking: true,
    semiAuto: false,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
    steps: STEPS.map((step) => ({
      stepNumber: step.stepNumber,
      name: step.name,
      prompt: step.buildPrompt('{{originalScript}}'),
    })),
  };
}

function sanitizeText(value, fallback = '') {
  return String(value || '').replace(/\s+/g, ' ').trim() || fallback;
}

function sanitizePrompt(value) {
  return String(value || '').trim();
}

function normalizeStep(step, index) {
  const stepNumber = Number(step?.stepNumber) || index + 1;

  return {
    stepNumber,
    name: sanitizeText(step?.name, `Bước ${stepNumber}`),
    prompt: sanitizePrompt(step?.prompt),
  };
}

function normalizeTemplate(template, fallback = {}) {
  const id = sanitizeText(template?.id, fallback.id || `template_${randomUUID().replace(/-/g, '').slice(0, 12)}`);
  const steps = Array.isArray(template?.steps)
    ? template.steps.map(normalizeStep).filter((step) => step.name && step.prompt)
    : [];
  const now = nowIso();

  return {
    id,
    name: sanitizeText(template?.name, fallback.name || 'Pipeline template'),
    description: sanitizeText(template?.description, fallback.description || ''),
    modelName: sanitizeText(template?.modelName, fallback.modelName || 'Sonnet 4.6'),
    adaptiveThinking: template?.adaptiveThinking !== false,
    semiAuto: Boolean(template?.semiAuto),
    isDefault: Boolean(template?.isDefault || fallback.isDefault),
    createdAt: template?.createdAt || fallback.createdAt || now,
    updatedAt: now,
    steps,
  };
}

async function ensureTemplateRoot() {
  await fs.mkdir(TEMPLATE_ROOT_DIR, { recursive: true });
}

async function writeTemplates(templates) {
  await ensureTemplateRoot();
  await fs.writeFile(TEMPLATE_CONFIG_PATH, JSON.stringify({ templates }, null, 2), 'utf8');
}

async function readTemplates() {
  await ensureTemplateRoot();
  const defaultTemplate = createKietTemplate();

  try {
    const raw = await fs.readFile(TEMPLATE_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const templates = Array.isArray(parsed.templates)
      ? parsed.templates.map((template) => normalizeTemplate(template))
      : [];

    if (!templates.some((template) => template.id === KIET_TEMPLATE_ID)) {
      templates.unshift(defaultTemplate);
      await writeTemplates(templates);
    }

    return templates.map((template) => normalizeTemplate(template));
  } catch {
    await writeTemplates([defaultTemplate]);
    return [defaultTemplate];
  }
}

async function saveTemplate(payload) {
  const templates = await readTemplates();
  const existing = payload?.id
    ? templates.find((template) => template.id === payload.id)
    : null;
  const id = existing?.id || `template_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const template = normalizeTemplate(
    {
      ...payload,
      id,
      isDefault: existing?.isDefault || false,
      createdAt: existing?.createdAt,
    },
    existing || {}
  );

  if (template.steps.length === 0) {
    throw new Error('Template cần ít nhất 1 bước có tên và prompt.');
  }

  const nextTemplates = existing
    ? templates.map((candidate) => (candidate.id === id ? template : candidate))
    : [...templates, template];

  await writeTemplates(nextTemplates);
  return template;
}

async function deleteTemplate(templateId) {
  const templates = await readTemplates();
  const template = templates.find((candidate) => candidate.id === templateId);

  if (!template) {
    throw new Error('Không tìm thấy template.');
  }

  if (template.isDefault || template.id === KIET_TEMPLATE_ID) {
    throw new Error('Không thể xóa template mặc định của Kiệt.');
  }

  const nextTemplates = templates.filter((candidate) => candidate.id !== template.id);
  await writeTemplates(nextTemplates);
  return nextTemplates;
}

module.exports = {
  KIET_TEMPLATE_ID,
  createKietTemplate,
  deleteTemplate,
  readTemplates,
  saveTemplate,
};
