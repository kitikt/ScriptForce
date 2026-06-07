const {
  getProjects,
  navigateToProject,
  selectModel,
  renameChat,
  sendMessage,
  waitForResponse,
  extractClaudeArtifactText,
} = require('../claude');

function createClaudeWebProvider(page) {
  return {
    mode: 'web',

    ensureAvailable() {
      if (!page || typeof page.isClosed !== 'function' || page.isClosed()) {
        throw new Error('Trang browser đã đóng. Vui lòng kết nối lại browser.');
      }
    },

    getCurrentUrl() {
      return page.url();
    },

    async getProjects() {
      return getProjects(page);
    },

    async navigateToProject(projectUrl) {
      return navigateToProject(page, projectUrl);
    },

    async selectModel(modelName, options = {}) {
      return selectModel(page, modelName, options);
    },

    async renameChat(chatName) {
      return renameChat(page, chatName);
    },

    async recoverAfterStepError() {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(
        () => Boolean(document.querySelector('div[contenteditable="true"]')),
        { timeout: 30000 }
      );
    },

    async sendPrompt(prompt, options = {}) {
      const responseBaseline = await sendMessage(page, prompt);
      const responseText = await waitForResponse(page, responseBaseline, options);
      const shouldCheckArtifact =
        Number(options.stepNumber || 0) >= 7 ||
        /\b(?:artifact|txt|download)\b/i.test(responseText) ||
        /file.{0,80}(?:created|saved|attached|generated)|created.{0,80}file|saved.{0,80}file/i.test(responseText) ||
        /this block is not supported on your current device yet/i.test(responseText);

      if (!shouldCheckArtifact) {
        return {
          text: responseText,
          artifacts: [],
        };
      }

      const artifact = await extractClaudeArtifactText(page, {
        ...options,
        chatText: responseText,
        baselineArtifactSignature: responseBaseline.artifactSignature,
      });

      const artifacts = artifact
        ? [{
            stepNumber: options.stepNumber,
            stepName: options.stepName,
            fileName: artifact.fileName || artifact.name || `step-${options.stepNumber || 'artifact'}-artifact.txt`,
            source: artifact.source || 'artifact',
            text: artifact.text,
            path: artifact.path || '',
            createdAt: new Date().toISOString(),
          }]
        : [];

      return {
        text: artifact?.text || responseText,
        artifacts,
      };
    },
  };
}

module.exports = {
  createClaudeWebProvider,
};
