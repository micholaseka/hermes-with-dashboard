import patchright from 'patchright';
const { chromium } = patchright;

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();

    // Check current page content for the sent message
    const content = await page.content();
    const hasLocation = content.includes('durenan') && content.includes('COD');
    console.log('Message sent verification:', hasLocation ? 'SUCCESS' : 'FAILED');
    
    if (!hasLocation) {
      console.log('Current page title:', await page.title());
      console.log('Current URL:', page.url());
    }

    await browser.close();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
