import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  
  const consoleMessages = [];
  page.on('console', msg => consoleMessages.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  
  try {
    await page.goto('https://stocksintels.com/developers/api-keys', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(8000);
    
    console.log('Console messages:');
    consoleMessages.forEach(msg => console.log(`  [${msg.type}] ${msg.text}`));
    
    const content = await page.content();
    console.log('\nPage content length:', content.length);
    console.log('Has "Something went wrong":', content.includes('Something went wrong'));
    console.log('Has "Generate Sandbox Key":', content.includes('Generate Sandbox Key'));
    console.log('Has "Generate Production Key":', content.includes('Generate Production Key'));
    console.log('Has "Email Address":', content.includes('Email Address'));
    console.log('Has "Password":', content.includes('Password'));
    console.log('Has "Full Name":', content.includes('Full Name'));
    console.log('Has "Verification Code":', content.includes('Verification Code'));
    console.log('Has "Sign in to manage":', content.includes('Sign in to manage'));
    console.log('Has "Generate Sandbox Key":', content.includes('Generate Sandbox Key'));
    console.log('Has "Generate Production Key":', content.includes('Generate Production Key'));
    console.log('Has "Email Address":', content.includes('Email Address'));
    console.log('Has "Password":', content.includes('Password'));
    console.log('Has "Full Name":', content.includes('Full Name'));
    console.log('Has "Verification Code":', content.includes('Verification Code'));
    console.log('Has "Sign in to manage":', content.includes('Sign in to manage'));
    
    await browser.close();
  } catch (e) {
    console.error('Error:', e);
    process.exit(1);
  }
})();