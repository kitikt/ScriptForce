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
        throw new Error('Browser page is closed. Please reconnect the browser.');
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

    async sendPrompt(prompt, options = {}) {
      const responseBaseline = await sendMessage(page, prompt);
      const responseText = await waitForResponse(page, responseBaseline, options);
      const shouldCheckArtifact = Number(options.stepNumber || 0) >= 7;

      if (!shouldCheckArtifact) {
        return responseText;
      }

      const artifact = await extractClaudeArtifactText(page, {
        ...options,
        chatText: responseText,
        baselineArtifactSignature: responseBaseline.artifactSignature,
      });

      return artifact?.text || responseText;
    },
  };
}

module.exports = {
  createClaudeWebProvider,
};
