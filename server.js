/**
 * Lovable AI Chat Automation Service
 * 
 * A lightweight Express + Puppeteer microservice that:
 *   1. Opens a Lovable project in headless Chrome
 *   2. Sends a fix prompt to Lovable's AI chat
 *   3. Returns the AI's response and status
 * 
 * Deploy on: Railway, Render, Fly.io, or any VPS with Node.js
 * n8n Cloud calls this via HTTP Request node.
 */

const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3000;
const LOVABLE_EMAIL = process.env.LOVABLE_EMAIL;
const LOVABLE_PASSWORD = process.env.LOVABLE_PASSWORD;
const LOVABLE_BASE_URL = process.env.LOVABLE_BASE_URL || 'https://lovable.dev';
const AUTH_TOKEN = process.env.SERVICE_AUTH_TOKEN || '';

function authenticate(req, res, next) {
  if (!AUTH_TOKEN) return next();
  const header = req.headers.authorization || '';
  if (header === `Bearer ${AUTH_TOKEN}`) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/run-fix', authenticate, async (req, res) => {
  const { projectUrl, fixPrompt, dryRun = false, timeoutMs = 120000 } = req.body;
  if (!projectUrl || !fixPrompt) return res.status(400).json({ error: 'Missing projectUrl or fixPrompt' });
  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    console.log('Logging in...');
    await page.goto(`${LOVABLE_BASE_URL}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', LOVABLE_EMAIL, { delay: 50 });
    await page.type('input[type="password"]', LOVABLE_PASSWORD, { delay: 50 });
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    console.log('Opening project...');
    await page.goto(projectUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 20000 });
    const prompt = dryRun ? `DIAGNOSE ONLY: ${fixPrompt}` : fixPrompt;
    const input = await page.$('textarea') || await page.$('[contenteditable="true"]');
    if (!input) throw new Error('Chat input not found');
    await input.click({ clickCount: 3 });
    await input.type(prompt, { delay: 20 });
    const sendBtn = await page.$('button[aria-label="Send"]') || await page.$('button[type="submit"]');
    if (sendBtn) await sendBtn.click(); else await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 5000));
    let lastText = '', stable = 0;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const txt = await page.evaluate(() => { const m = document.querySelectorAll('[class*="message"]'); return m.length ? m[m.length-1].innerText : ''; });
      if (txt === lastText && txt.length > 10) { stable++; if (stable >= 3) break; } else stable = 0;
      lastText = txt;
      await new Promise(r => setTimeout(r, 2000));
    }
    const screenshot = await page.screenshot({ encoding: 'base64' });
    res.json({ success: true, dryRun, aiResponse: lastText, screenshotBase64: screenshot });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally { if (browser) await browser.close(); }
});

app.listen(PORT, () => console.log(`Service running on port ${PORT}`));
