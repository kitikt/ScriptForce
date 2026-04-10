const { chromium } = require('playwright');
const path = require('path');

async function launchBrowser() {
  const userDataDir = path.join(__dirname, '..', 'browser-data');
  
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: null,
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  // Lấy page đầu tiên, không đóng gì hết, không tạo mới
  const page = context.pages()[0];

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  // Navigate tới claude.ai trên page đầu tiên
  await page.goto('https://claude.ai', { 
    waitUntil: 'domcontentloaded', 
    timeout: 60000 
  });

  return { context, page };
}

async function waitForLogin(page) {
  console.log('Waiting for login... (you have 5 minutes)');
  
  // Chờ tối đa 5 phút, check mỗi 3 giây
  const maxWait = 5 * 60 * 1000;
  const interval = 3000;
  let elapsed = 0;
  
  while (elapsed < maxWait) {
    try {
      const url = page.url();
      
      // Check URL đã vào được trang chính chưa
      if (url.includes('claude.ai/new') || url.includes('claude.ai/chat') || url.includes('claude.ai/project')) {
        // Check có chat input không
        const hasInput = await page.evaluate(() => {
          return !!document.querySelector('div[contenteditable="true"]');
        });
        
        if (hasInput) {
          console.log('Login detected!');
          return true;
        }
      }
    } catch (e) {
      // Page đang navigate, bỏ qua lỗi
    }
    
    await new Promise((r) => setTimeout(r, interval));
    elapsed += interval;
    
    if (elapsed % 30000 === 0) {
      console.log('Still waiting for login... ' + Math.round(elapsed / 1000) + 's');
    }
  }
  
  throw new Error('Login timeout after 5 minutes');
}

module.exports = {
  launchBrowser,
  waitForLogin,
};
