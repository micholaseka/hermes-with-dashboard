import patchright from 'patchright';
const { chromium } = patchright;

(async () => {
  try {
    console.log('Connecting to existing browser via CDP...');
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
    console.log('Connected. Contexts:', browser.contexts().length);

    const context = browser.contexts()[0];
    if (!context) {
      throw new Error('No browser context found');
    }

    // Get existing pages or create new one
    const pages = context.pages();
    console.log('Pages:', pages.length);
    const page = pages[0] || await context.newPage();

    // Navigate to Facebook Marketplace seller inbox
    console.log('Navigating to Marketplace inbox...');
    await page.goto('https://www.facebook.com/marketplace/inbox', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // Look for Clara's conversation
    console.log('Looking for Clara conversation...');
    const conversationSelectors = [
      '[role="listitem"]',
      '[data-pagelet="MarketplaceInbox"]',
      'div[aria-label*="Clara"]',
      'div[aria-label*="clara"]',
    ];

    let found = false;
    for (const selector of conversationSelectors) {
      const elements = await page.locator(selector).all();
      console.log(`Selector "${selector}": ${elements.length} elements`);
      
      for (const el of elements) {
        const text = await el.innerText();
        if (text.toLowerCase().includes('clara')) {
          console.log('Found Clara:', text.substring(0, 100));
          await el.click();
          found = true;
          break;
        }
      }
      if (found) break;
    }

    if (!found) {
      console.log('Clara not found by exact match, trying first conversation...');
      const firstConv = page.locator('[role="listitem"]').first();
      if (await firstConv.count() > 0) {
        await firstConv.click();
      }
    }

    await page.waitForTimeout(2000);

    // Send the reply
    const replyText = `Lokasi kami di durenan kak
bisa COD dan bayar dirumah kak
free ongkir cek sepuasnya baru bayar
ada no wa kak saya share lokasinya?`;

    console.log('Sending reply...');
    const replyInput = page.locator('div[contenteditable="true"], textarea, input[aria-label*="pesan"], input[aria-label*="message"]').first();
    await replyInput.fill('');
    await replyInput.type(replyText, { delay: 50 });

    // Try to find and click send button
    const sendBtn = page.locator('button[aria-label*="Kirim"], button[aria-label*="Send"], [data-testid="send_button"]').first();
    if (await sendBtn.count() > 0) {
      await sendBtn.click();
      console.log('Reply sent via button click');
    } else {
      await page.keyboard.press('Enter');
      console.log('Reply sent via Enter key');
    }

    await page.waitForTimeout(2000);
    console.log('Done');
    await browser.close();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
