const nodemailer = require('nodemailer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

let transporter = null;
let useEnsend = false;

if (process.env.ENSEND_PROJECT_SECRET) {
  useEnsend = true;
  console.log('[MAILER] Using Ensend API');
}

// Embed logo as base64 for email clients that support images
let LOGO_BASE64 = '';
try {
  // Try thumbnail first (smaller), fall back to full logo
  let logoPath = path.join(__dirname, '..', 'frontend', 'dist', 'logo-thumb.jpg');
  if (!fs.existsSync(logoPath)) {
    logoPath = path.join(__dirname, '..', 'frontend', 'dist', 'logo1.jpg');
  }
  if (fs.existsSync(logoPath)) {
    LOGO_BASE64 = 'data:image/jpeg;base64,' + fs.readFileSync(logoPath).toString('base64');
    console.log('[MAILER] Logo loaded, base64 size:', LOGO_BASE64.length, 'chars');
  }
} catch (e) {
  console.warn('[MAILER] Could not load logo:', e.message);
}

async function getTransporter() {
  if (transporter) return transporter;

  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  } else {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    console.log('[MAILER] Using Ethereal test account:', testAccount.user);
  }

  await transporter.verify();
  return transporter;
}

async function sendViaEnsend({ to, subject, html, text }) {
  const secret = process.env.ENSEND_PROJECT_SECRET;
  const baseUrl = process.env.ENSEND_BASE_URL || 'https://api.ensend.co';
  const senderName = process.env.ENSEND_SENDER_NAME || 'StocksIntels';
  const senderAddress = process.env.ENSEND_SENDER_ADDRESS;

  if (!secret) {
    throw new Error('ENSEND_PROJECT_SECRET env var is required when using Ensend');
  }
  if (!senderAddress) {
    throw new Error('ENSEND_SENDER_ADDRESS env var is required when using Ensend');
  }

  const recipients = Array.isArray(to)
    ? to.map(addr => ({ address: addr }))
    : { address: to };

  try {
    const { data } = await axios.post(
      `${baseUrl}/send/mail`,
      {
        sender: { name: senderName, address: senderAddress },
        recipients,
        subject,
        message: html || text,
      },
      {
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('[MAILER] Sent via Ensend, ref:', data?.data?.ref);
    return data;
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error('[MAILER] Ensend send failed:', err.response?.status, detail);
    throw new Error(`Ensend failed: ${detail}`);
  }
}

const BRAND_COLOR = '#0D7490';
const BG_LIGHT = '#f4f6f8';
const CARD_WHITE = '#ffffff';
const TEXT_DARK = '#1e293b';
const TEXT_MED = '#475569';
const TEXT_LIGHT = '#94a3b8';
const BORDER = '#e2e8f0';
const GREEN = '#059669';
const RED = '#dc2626';
const AMBER = '#d97706';

function baseWrapper(innerHtml, extraHead = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>StocksIntels</title>
  ${extraHead}
</head>
<body style="margin:0;padding:0;background-color:${BG_LIGHT};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BG_LIGHT}">
    <tr>
      <td align="center" style="padding:32px 16px">
        <table role="presentation" width="100%" style="max-width:560px;background:${CARD_WHITE};border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06),0 1px 2px rgba(0,0,0,0.04)">
          <tr>
            <td style="background:linear-gradient(135deg,${BRAND_COLOR} 0%,#0a5f8a 100%);padding:20px 32px;text-align:center">
              ${LOGO_BASE64
                ? `<img src="${LOGO_BASE64}" alt="StocksIntels" style="max-width:180px;max-height:40px;height:auto;display:inline-block;border:0" />`
                : `<div style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.5px">StocksIntels</div>`
              }
              <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-top:4px">Market Intelligence Platform</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px">
              ${innerHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid ${BORDER};text-align:center">
              <div style="font-size:11px;color:${TEXT_LIGHT};line-height:1.6">
                <div style="font-weight:600;color:${TEXT_MED};margin-bottom:4px">StocksIntels</div>
                <div>This is an automated message from StocksIntels.</div>
                <div style="margin-top:4px">&copy; ${new Date().getFullYear()} StocksIntels. All rights reserved.</div>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;border-top:1px solid ${BORDER};background-color:${BG_LIGHT}">
              <div style="font-size:10px;color:${TEXT_LIGHT};line-height:1.6;text-align:justify">
                <div style="font-weight:600;color:${TEXT_MED};margin-bottom:4px;text-align:center">Risk Disclaimer</div>
                <div style="margin-bottom:6px">
                  Trading stocks, equities, and other financial instruments involves substantial risk of loss and is not suitable for all investors. The value of investments can fall as well as rise, and you may receive back less than you originally invested.
                </div>
                <div style="margin-bottom:6px">
                  AI Signals are not financial advice. All buy, sell, and hold signals generated by StocksIntels are produced by automated machine learning models and are provided for informational and research purposes only. They do not constitute personalized financial advice, investment recommendations, or solicitations to trade any security.
                </div>
                <div style="margin-bottom:6px">
                  Past performance is not a guarantee of future results. Quoted accuracy rates are based on historical backtesting and live performance data. Historical performance does not guarantee equivalent future results. Market conditions change, and model performance can and does vary.
                </div>
                <div style="margin-bottom:6px">
                  StocksIntels is not a licensed broker or financial advisor. We do not execute trades on your behalf, hold client funds, or provide regulated financial advice. We are a data and analytics platform. Before making any investment decision, you should consult a qualified and licensed financial advisor who understands your personal financial situation.
                </div>
                <div style="margin-bottom:6px">
                  Market data may be delayed or inaccurate. While we strive for real-time accuracy across all data feeds, StocksIntels cannot guarantee the completeness, timeliness, or accuracy of market data at all times. Do not rely solely on data from this platform for time-critical trading decisions.
                </div>
                <div>
                  By using StocksIntels, you acknowledge that you have read and understood this disclaimer in full. <a href="https://stocksintels.com/disclaimer" style="color:${BRAND_COLOR};text-decoration:underline">Read full disclaimer</a>
                </div>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function codeCardHtml(title, description, code, expiryMinutes) {
  return baseWrapper(`
    <div style="text-align:center">
      <div style="font-size:20px;font-weight:700;color:${TEXT_DARK};margin-bottom:4px">${title}</div>
      <div style="font-size:13px;color:${TEXT_MED};line-height:1.5;margin-bottom:24px">${description}</div>
      <div style="background:${BG_LIGHT};border:1px solid ${BORDER};border-radius:10px;padding:20px 24px;display:inline-block">
        <div style="font-size:36px;font-weight:700;color:${BRAND_COLOR};letter-spacing:6px;font-family:'Courier New',Courier,monospace">${code}</div>
      </div>
      <div style="font-size:12px;color:${TEXT_LIGHT};margin-top:16px">This code expires in ${expiryMinutes} minutes.</div>
      <div style="font-size:12px;color:${TEXT_LIGHT};margin-top:20px;padding-top:16px;border-top:1px solid ${BORDER}">If you did not request this, you can safely ignore this email.</div>
    </div>
  `);
}

async function sendViaTransport({ to, subject, text, html, label }) {
  if (useEnsend) {
    return sendViaEnsend({ to, subject, html, text });
  }
  const transport = await getTransporter();
  const result = await transport.sendMail({
    from: process.env.SMTP_FROM || '"StocksIntels" <noreply@stocksintels.com>',
    to,
    subject,
    text,
    html,
  });
  console.log(`[MAILER] ${label || 'Email'} sent to ${to}:`, result.messageId);
  return result;
}

async function sendResetCode(email, code, expiryMinutes) {
  const subject = 'Your StocksIntels Password Reset Code';
  const html = codeCardHtml('Password Reset', 'Use the code below to reset your password. This code is valid for a limited time.', code, expiryMinutes);
  return sendViaTransport({ to: email, subject, html, label: 'Reset code' });
}

async function sendOtpEmail(email, code, expiryMinutes) {
  const subject = 'Your StocksIntels Login Code';
  const html = codeCardHtml('Login Verification', 'Use the code below to complete your login. This code is valid for a limited time.', code, expiryMinutes);
  return sendViaTransport({ to: email, subject, html, label: 'OTP' });
}

async function sendVerificationEmail(email, code) {
  const subject = 'Verify your StocksIntels email';
  const html = baseWrapper(`
    <div style="text-align:center">
      <div style="font-size:20px;font-weight:700;color:${TEXT_DARK};margin-bottom:4px">Email Verification</div>
      <div style="font-size:13px;color:${TEXT_MED};margin-bottom:24px">Please verify your email address by clicking the button below.</div>
      <div style="background:${BG_LIGHT};border:1px solid ${BORDER};border-radius:10px;padding:20px 24px;display:inline-block">
        <div style="font-size:36px;font-weight:700;color:${BRAND_COLOR};letter-spacing:6px;font-family:'Courier New',Courier,monospace">${code}</div>
      </div>
      <div style="font-size:12px;color:${TEXT_LIGHT};margin-top:16px">Enter this code in the verification field to confirm your email.</div>
    </div>
  `);
  return sendViaTransport({ to: email, subject, html, label: 'Verification' });
}

async function sendWelcomeEmail(email, name) {
  const subject = 'Welcome to StocksIntels';
  const html = baseWrapper(`
    <div style="text-align:center">
      <div style="font-size:20px;font-weight:700;color:${TEXT_DARK};margin-bottom:4px">Welcome to StocksIntels</div>
      <div style="font-size:13px;color:${TEXT_MED};margin-bottom:24px">Hi ${name || 'there'}, your account is ready. Start tracking stocks and building your portfolio.</div>
      <a href="${process.env.APP_URL || 'http://localhost:5173'}/app/markets" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;padding:12px 36px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Explore Markets</a>
    </div>
  `);
  return sendViaTransport({ to: email, subject, html, label: 'Welcome' });
}

async function sendPortfolioReportEmail(email, data) {
  const { userName, generatedAt, summary, holdings, sectorAllocation, bestPerformers, worstPerformers, fxRate } = data;
  const dateStr = generatedAt
    ? new Date(generatedAt).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const subject = `StocksIntels Portfolio Report — ${dateStr}`;

  const pnlColor = summary.totalPnL >= 0 ? GREEN : RED;
  const pnlSign = summary.totalPnL >= 0 ? '+' : '';
  const arrow = summary.totalPnL >= 0 ? '&#9650;' : '&#9660;';

  const totalValue = (summary.totalValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const totalCost = (summary.totalCost || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const totalPnL = Math.abs(summary.totalPnL || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const CURR = { KES: 'KSh', USD: '$' };

  const holdingsRows = (holdings || []).slice(0, 20).map(h => {
    const hp = (h.pnl || 0) >= 0 ? GREEN : RED;
    const ha = (h.pnl || 0) >= 0 ? '&#9650;' : '&#9660;';
    const ticker = h.ticker || '?';
    const name = h.name || ticker;
    const shares = (h.shares || 0).toFixed(4);
    const prefix = CURR[h.currency] || '$';
    const price = prefix + (h.currentPrice || 0).toFixed(2);
    const value = prefix + (h.value || 0).toFixed(2);
    const pnl = prefix + Math.abs(h.pnl || 0).toFixed(2);
    const pnlPct = (h.pnlPercent || 0).toFixed(1);
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid ${BORDER};font-size:13px;font-weight:600;color:${TEXT_DARK}">${ticker}</td>
      <td style="padding:8px 10px;border-bottom:1px solid ${BORDER};font-size:12px;color:${TEXT_MED}">${name}</td>
      <td style="padding:8px 10px;border-bottom:1px solid ${BORDER};font-size:13px;text-align:right;color:${TEXT_DARK}">${shares}</td>
      <td style="padding:8px 10px;border-bottom:1px solid ${BORDER};font-size:13px;text-align:right;color:${TEXT_DARK}">${price}</td>
      <td style="padding:8px 10px;border-bottom:1px solid ${BORDER};font-size:13px;text-align:right;color:${TEXT_DARK}">${value}</td>
      <td style="padding:8px 10px;border-bottom:1px solid ${BORDER};font-size:13px;text-align:right;color:${hp}">${ha} ${pnl}</td>
      <td style="padding:8px 10px;border-bottom:1px solid ${BORDER};font-size:13px;text-align:right;color:${hp}">${pnlPct}%</td>
    </tr>`;
  }).join('');

  const sectorRows = (sectorAllocation || []).map(s => {
    const pct = Math.min(s.pct || 0, 100);
    const sector = s.sector || 'Other';
    const value = (s.value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid ${BORDER};font-size:13px;color:${TEXT_DARK}">${sector}</td>
      <td style="padding:8px 10px;border-bottom:1px solid ${BORDER};font-size:13px;text-align:right;color:${TEXT_DARK}">KSh${value}</td>
      <td style="padding:8px 10px;border-bottom:1px solid ${BORDER}">
        <div style="width:100%;height:6px;background:${BG_LIGHT};border-radius:3px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${BRAND_COLOR};border-radius:3px"></div>
        </div>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid ${BORDER};font-size:13px;text-align:right;color:${TEXT_DARK}">${pct}%</td>
    </tr>`;
  }).join('');

  const bestRows = (bestPerformers || []).slice(0, 5).map(h => `<tr>
    <td style="padding:6px 10px;border-bottom:1px solid ${BORDER};font-size:12px;color:${TEXT_DARK}">${h.ticker}</td>
    <td style="padding:6px 10px;border-bottom:1px solid ${BORDER};font-size:12px;text-align:right;color:${GREEN}">${h.pnlPercent >= 0 ? '+' : ''}${h.pnlPercent?.toFixed(1) || '0.0'}%</td>
  </tr>`).join('');

  const worstRows = (worstPerformers || []).slice(0, 5).map(h => `<tr>
    <td style="padding:6px 10px;border-bottom:1px solid ${BORDER};font-size:12px;color:${TEXT_DARK}">${h.ticker}</td>
    <td style="padding:6px 10px;border-bottom:1px solid ${BORDER};font-size:12px;text-align:right;color:${RED}">${h.pnlPercent?.toFixed(1) || '0.0'}%</td>
  </tr>`).join('');

  const fxNote = fxRate ? `<div style="font-size:11px;color:${TEXT_LIGHT};text-align:center;margin-bottom:16px">Global holdings (USD) converted at 1 USD = ${fxRate.toFixed(2)} KES</div>` : '';

  const html = baseWrapper(`
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:20px;font-weight:700;color:${TEXT_DARK}">Portfolio Report</div>
      <div style="font-size:13px;color:${TEXT_MED}">${dateStr}</div>
      ${userName ? `<div style="font-size:14px;color:${TEXT_MED};margin-top:8px">Hello ${userName}</div>` : ''}
    </div>

    <div style="background:linear-gradient(135deg,${pnlColor}15,${pnlColor}08);border:1px solid ${pnlColor}30;border-radius:10px;padding:24px;text-align:center;margin-bottom:20px">
      <div style="font-size:28px;font-weight:800;color:${pnlColor}">${pnlSign}KSh${totalPnL}</div>
      <div style="font-size:13px;color:${TEXT_MED};margin-top:4px">${arrow} ${summary.pnlPercent?.toFixed(1) || '0.0'}% return</div>
      <div style="font-size:13px;color:${TEXT_DARK};margin-top:12px">Total Value: KSh${totalValue} · Total Cost: KSh${totalCost}</div>
    </div>

    ${fxNote}

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:20px">
      <thead><tr style="background:${BG_LIGHT}"><th style="padding:8px 10px;text-align:left;font-size:12px;color:${TEXT_MED}">Ticker</th><th style="padding:8px 10px;text-align:left;font-size:12px;color:${TEXT_MED}">Name</th><th style="padding:8px 10px;text-align:right;font-size:12px;color:${TEXT_MED}">Shares</th><th style="padding:8px 10px;text-align:right;font-size:12px;color:${TEXT_MED}">Price</th><th style="padding:8px 10px;text-align:right;font-size:12px;color:${TEXT_MED}">Value</th><th style="padding:8px 10px;text-align:right;font-size:12px;color:${TEXT_MED}">P/L</th><th style="padding:8px 10px;text-align:right;font-size:12px;color:${TEXT_MED}">P/L %</th></tr></thead>
      <tbody>${holdingsRows || '<tr><td colspan="7" style="padding:12px;text-align:center;color:#94a3b8;font-size:12px">No holdings</td></tr>'}</tbody>
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:20px">
      <thead><tr style="background:${BG_LIGHT}"><th style="padding:8px 10px;text-align:left;font-size:12px;color:${TEXT_MED}">Sector</th><th style="padding:8px 10px;text-align:right;font-size:12px;color:${TEXT_MED}">Value</th><th style="padding:8px 10px;font-size:12px;color:${TEXT_MED}">Allocation</th><th style="padding:8px 10px;text-align:right;font-size:12px;color:${TEXT_MED}">%</th></tr></thead>
      <tbody>${sectorRows || '<tr><td colspan="4" style="padding:12px;text-align:center;color:#94a3b8;font-size:12px">No sector data</td></tr>'}</tbody>
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:20px">
      <tr>
        <td style="width:50%;padding:0 6px 0 0;vertical-align:top">
          <div style="background:${CARD_WHITE};border:1px solid ${BORDER};border-radius:10px;overflow:hidden">
            <div style="background:${GREEN};color:#ffffff;padding:8px 12px;font-size:12px;font-weight:600">Best Performers</div>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:11px">
              <thead><tr style="background:${BG_LIGHT}"><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Ticker</th><th style="padding:4px 8px;text-align:right;color:${TEXT_MED}">P/L %</th></tr></thead>
              <tbody>${bestRows || '<tr><td colspan="2" style="padding:12px;text-align:center;color:#94a3b8;font-size:12px">No data</td></tr>'}</tbody>
            </table>
          </div>
        </td>
        <td style="width:50%;padding:0 0 0 6px;vertical-align:top">
          <div style="background:${CARD_WHITE};border:1px solid ${BORDER};border-radius:10px;overflow:hidden">
            <div style="background:${RED};color:#ffffff;padding:8px 12px;font-size:12px;font-weight:600">Worst Performers</div>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:11px">
              <thead><tr style="background:${BG_LIGHT}"><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Ticker</th><th style="padding:4px 8px;text-align:right;color:${TEXT_MED}">P/L %</th></tr></thead>
              <tbody>${worstRows || '<tr><td colspan="2" style="padding:12px;text-align:center;color:#94a3b8;font-size:12px">No data</td></tr>'}</tbody>
            </table>
          </div>
        </td>
      </tr>
    </table>
  `);

  return sendViaTransport({ to: email, subject, html, label: 'Portfolio report' });
}

async function sendDailySentimentEmail(email, data) {
  const {
    userName, summary, sentiment, confidence, dateStr,
    nseGainers, nseLosers, globalGainers, globalLosers,
    signals
  } = data;

  const sentimentColor = sentiment === 'Bullish' ? GREEN : sentiment === 'Bearish' ? RED : AMBER;
  const subject = `Market Sentiment Report — ${dateStr}`;

  const gainerRows = (nseGainers || []).slice(0, 8).map(s =>
    `<tr>
      <td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;font-weight:600;color:${TEXT_DARK}">${s.symbol}</td>
      <td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;color:${TEXT_MED}">${s.company_name || ''}</td>
      <td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;text-align:right;color:${GREEN}">+${s.changePercent?.toFixed(2) || '0.00'}%</td>
    </tr>`
  ).join('');

  const loserRows = (nseLosers || []).slice(0, 8).map(s =>
    `<tr>
      <td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;font-weight:600;color:${TEXT_DARK}">${s.symbol}</td>
      <td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;color:${TEXT_MED}">${s.company_name || ''}</td>
      <td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;text-align:right;color:${RED}">${s.changePercent?.toFixed(2) || '0.00'}%</td>
    </tr>`
  ).join('');

  const globalGainerRows = (globalGainers || []).slice(0, 8).map(s =>
    `<tr>
      <td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;font-weight:600;color:${TEXT_DARK}">${s.symbol}</td>
      <td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;color:${TEXT_MED}">${s.company_name || ''}</td>
      <td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;text-align:right;color:${GREEN}">+${s.changePercent?.toFixed(2) || '0.00'}%</td>
    </tr>`
  ).join('');

  const globalLoserRows = (globalLosers || []).slice(0, 8).map(s =>
    `<tr>
      <td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;font-weight:600;color:${TEXT_DARK}">${s.symbol}</td>
      <td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;color:${TEXT_MED}">${s.company_name || ''}</td>
      <td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;text-align:right;color:${RED}">${s.changePercent?.toFixed(2) || '0.00'}%</td>
    </tr>`
  ).join('');

  const strongBuys = signals?.strongBuys || 0;
  const totalSignals = signals?.total || 0;
  const buys = signals?.buys || 0;
  const sells = signals?.sells || 0;
  const buyPct = totalSignals > 0 ? Math.round((buys / totalSignals) * 100) : 0;
  const sellPct = totalSignals > 0 ? Math.round((sells / totalSignals) * 100) : 0;

  const html = baseWrapper(`
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:20px;font-weight:700;color:${TEXT_DARK}">Market Sentiment</div>
      <div style="font-size:13px;color:${TEXT_MED}">${dateStr}</div>
      ${userName ? `<div style="font-size:14px;color:${TEXT_MED};margin-top:8px">Hello ${userName}</div>` : ''}
    </div>

    <div style="background:linear-gradient(135deg,${sentimentColor}15,${sentimentColor}08);border:1px solid ${sentimentColor}30;border-radius:10px;padding:24px;text-align:center;margin-bottom:20px">
      <div style="font-size:28px;font-weight:800;color:${sentimentColor}">${sentiment}</div>
      <div style="font-size:13px;color:${TEXT_MED};margin-top:4px">Confidence: ${confidence}</div>
      <div style="font-size:13px;color:${TEXT_DARK};margin-top:12px;line-height:1.6">${summary}</div>
    </div>

    <div style="background:${CARD_WHITE};border:1px solid ${BORDER};border-radius:10px;padding:18px;margin-bottom:20px">
      <div style="font-size:14px;font-weight:600;color:${TEXT_DARK};margin-bottom:14px">Signal Overview</div>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:13px">
        <tr>
          <td style="padding:6px 0;color:${TEXT_MED}">Total Signals</td>
          <td style="padding:6px 0;text-align:right;font-weight:700;color:${TEXT_DARK}">${totalSignals}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:${GREEN}">Buy Signals</td>
          <td style="padding:6px 0;text-align:right;font-weight:700;color:${GREEN}">${buys} (${buyPct}%)</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:${RED}">Sell Signals</td>
          <td style="padding:6px 0;text-align:right;font-weight:700;color:${RED}">${sells} (${sellPct}%)</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:${BRAND_COLOR}">Strong Buy Signals</td>
          <td style="padding:6px 0;text-align:right;font-weight:700;color:${BRAND_COLOR}">${strongBuys}</td>
        </tr>
      </table>
    </div>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:20px">
      <tr>
        <td style="width:50%;padding:0 6px 0 0;vertical-align:top">
          <div style="background:${CARD_WHITE};border:1px solid ${BORDER};border-radius:10px;overflow:hidden">
            <div style="background:${GREEN};color:#ffffff;padding:8px 12px;font-size:12px;font-weight:600">NSE Top Gainers</div>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:11px">
              <thead><tr style="background:${BG_LIGHT}"><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Symbol</th><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Name</th><th style="padding:4px 8px;text-align:right;color:${TEXT_MED}">Change</th></tr></thead>
              <tbody>${gainerRows || '<tr><td colspan="3" style="padding:12px;text-align:center;color:#94a3b8;font-size:12px">No data</td></tr>'}</tbody>
            </table>
          </div>
        </td>
        <td style="width:50%;padding:0 0 0 6px;vertical-align:top">
          <div style="background:${CARD_WHITE};border:1px solid ${BORDER};border-radius:10px;overflow:hidden">
            <div style="background:${RED};color:#ffffff;padding:8px 12px;font-size:12px;font-weight:600">NSE Top Losers</div>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:11px">
              <thead><tr style="background:${BG_LIGHT}"><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Symbol</th><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Name</th><th style="padding:4px 8px;text-align:right;color:${TEXT_MED}">Change</th></tr></thead>
              <tbody>${loserRows || '<tr><td colspan="3" style="padding:12px;text-align:center;color:#94a3b8;font-size:12px">No data</td></tr>'}</tbody>
            </table>
          </div>
        </td>
      </tr>
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:20px">
      <tr>
        <td style="width:50%;padding:0 6px 0 0;vertical-align:top">
          <div style="background:${CARD_WHITE};border:1px solid ${BORDER};border-radius:10px;overflow:hidden">
            <div style="background:${GREEN};color:#ffffff;padding:8px 12px;font-size:12px;font-weight:600">Global Top Gainers</div>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:11px">
              <thead><tr style="background:${BG_LIGHT}"><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Symbol</th><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Name</th><th style="padding:4px 8px;text-align:right;color:${TEXT_MED}">Change</th></tr></thead>
              <tbody>${globalGainerRows || '<tr><td colspan="3" style="padding:12px;text-align:center;color:#94a3b8;font-size:12px">No data</td></tr>'}</tbody>
            </table>
          </div>
        </td>
        <td style="width:50%;padding:0 0 0 6px;vertical-align:top">
          <div style="background:${CARD_WHITE};border:1px solid ${BORDER};border-radius:10px;overflow:hidden">
            <div style="background:${RED};color:#ffffff;padding:8px 12px;font-size:12px;font-weight:600">Global Top Losers</div>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:11px">
              <thead><tr style="background:${BG_LIGHT}"><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Symbol</th><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Name</th><th style="padding:4px 8px;text-align:right;color:${TEXT_MED}">Change</th></tr></thead>
              <tbody>${globalLoserRows || '<tr><td colspan="3" style="padding:12px;text-align:center;color:#94a3b8;font-size:12px">No data</td></tr>'}</tbody>
            </table>
          </div>
        </td>
      </tr>
    </table>
  `);

  return sendViaTransport({ to: email, subject, html, label: 'Sentiment report' });
}

async function sendHotNewsEmail(email, data) {
  const { userName, dateStr, hotNews } = data;
  const displayDate = dateStr || new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const subject = `Hot Market News — ${displayDate}`;

  const hotNewsRows = (hotNews || []).slice(0, 15).map(n => {
    const typeColor = {
      'IPO': '#8b5cf6',
      'Earnings': '#0D7490',
      'Merger': '#d946ef',
      'Partnership': '#06b6d4',
      'Regulatory': '#f59e0b',
      'Expansion': '#10b981',
      'Funding': '#6366f1',
      'Leadership': '#84cc16',
      'Crisis': '#ef4444'
    }[n.hotType] || BRAND_COLOR;

    const sentimentColor = n.sentiment === 'positive' ? GREEN : n.sentiment === 'negative' ? RED : TEXT_MED;
    const stockTags = (n.relatedStocks || []).slice(0, 3).map(s =>
      `<span style="display:inline-block;background:${BG_LIGHT};color:${TEXT_MED};padding:2px 6px;border-radius:4px;font-size:10px;margin-right:4px">${s}</span>`
    ).join('');

    return `<tr>
      <td style="padding:12px;border-bottom:1px solid ${BORDER}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="background:${typeColor}20;color:${typeColor};padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;text-transform:uppercase">${n.hotType}</span>
          <span style="color:${sentimentColor};font-size:11px;font-weight:500;text-transform:capitalize">${n.sentiment}</span>
        </div>
        <div style="font-size:14px;font-weight:600;color:${TEXT_DARK};margin-bottom:4px">${n.headline}</div>
        <div style="font-size:12px;color:${TEXT_MED};margin-bottom:6px">${n.excerpt || ''}</div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div>${stockTags}</div>
          <div style="font-size:11px;color:${TEXT_LIGHT}">${n.source} · ${n.timestamp}</div>
        </div>
      </td>
    </tr>`;
  }).join('');

  const html = baseWrapper(`
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:20px;font-weight:700;color:${TEXT_DARK}">Hot Market News</div>
      <div style="font-size:13px;color:${TEXT_MED}">${displayDate}</div>
      ${userName ? `<div style="font-size:14px;color:${TEXT_MED};margin-top:8px">Hello ${userName}</div>` : ''}
    </div>

    <div style="background:linear-gradient(135deg,${BRAND_COLOR}15,${BRAND_COLOR}08);border:1px solid ${BRAND_COLOR}30;border-radius:10px;padding:20px;text-align:center;margin-bottom:20px">
      <div style="font-size:24px;font-weight:800;color:${BRAND_COLOR}">${hotNews.length || 0}</div>
      <div style="font-size:13px;color:${TEXT_MED};margin-top:4px">Breaking news items that could move markets</div>
    </div>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:20px">
      <tbody>${hotNewsRows || '<tr><td style="padding:12px;text-align:center;color:#94a3b8;font-size:12px">No hot news today</td></tr>'}</tbody>
    </table>

    <div style="text-align:center;margin-bottom:16px">
      <a href="${process.env.APP_URL || 'http://localhost:5173'}/app/news" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;padding:12px 36px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">View All News</a>
    </div>
  `);

  return sendViaTransport({ to: email, subject, html, label: 'Hot news' });
}

async function sendPaymentReceiptEmail(email, data) {
  const { userName, planName, amount, currency, dateStr, paidAt } = data;
  const displayDate = dateStr || (paidAt
    ? new Date(paidAt).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
  const subject = `Payment Receipt — ${planName}`;
  const html = baseWrapper(`
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:20px;font-weight:700;color:${TEXT_DARK}">Payment Receipt</div>
      <div style="font-size:13px;color:${TEXT_MED}">${displayDate}</div>
      ${userName ? `<div style="font-size:14px;color:${TEXT_MED};margin-top:8px">Hello ${userName}</div>` : ''}
    </div>

    <div style="background:${CARD_WHITE};border:1px solid ${BORDER};border-radius:10px;padding:24px;margin-bottom:20px">
      <div style="font-size:16px;font-weight:600;color:${TEXT_DARK};margin-bottom:16px">Payment Details</div>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:13px">
        <tr>
          <td style="padding:8px 0;color:${TEXT_MED}">Plan</td>
          <td style="padding:8px 0;text-align:right;font-weight:700;color:${TEXT_DARK}">${planName}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:${TEXT_MED}">Amount</td>
          <td style="padding:8px 0;text-align:right;font-weight:700;color:${TEXT_DARK}">${currency} ${amount}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:${TEXT_MED}">Status</td>
          <td style="padding:8px 0;text-align:right;font-weight:700;color:${GREEN}">Paid</td>
        </tr>
      </table>
    </div>

    <div style="text-align:center;margin-bottom:16px">
      <a href="${process.env.APP_URL || 'http://localhost:5173'}/app/subscription" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;padding:12px 36px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Manage Subscription</a>
    </div>
  `);
  return sendViaTransport({ to: email, subject, html, label: 'Payment receipt' });
}

async function sendSubscriptionExpiryReminder(email, data) {
  const { userName, planName, daysLeft, expiryDate } = data;
  const subject = `Your ${planName} subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
  const html = baseWrapper(`
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:20px;font-weight:700;color:${TEXT_DARK}">Subscription Expiring Soon</div>
      <div style="font-size:13px;color:${TEXT_MED}">Hello ${userName || 'there'}</div>
    </div>

    <div style="background:linear-gradient(135deg,${AMBER}15,${AMBER}08);border:1px solid ${AMBER}30;border-radius:10px;padding:24px;text-align:center;margin-bottom:20px">
      <div style="font-size:28px;font-weight:800;color:${AMBER}">${daysLeft}</div>
      <div style="font-size:13px;color:${TEXT_MED};margin-top:4px">day${daysLeft === 1 ? '' : 's'} remaining</div>
      <div style="font-size:13px;color:${TEXT_DARK};margin-top:12px">Your ${planName} subscription expires on ${expiryDate}</div>
    </div>

    <div style="text-align:center;margin-bottom:16px">
      <a href="${process.env.APP_URL || 'http://localhost:5173'}/pricing" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;padding:12px 36px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Renew Subscription</a>
    </div>
  `);
  return sendViaTransport({ to: email, subject, html, label: 'Expiry reminder' });
}

async function sendSubscriptionExpiredEmail(email, data) {
  const { userName, planName } = data;
  const subject = `Your ${planName} subscription has expired`;
  const html = baseWrapper(`
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:20px;font-weight:700;color:${TEXT_DARK}">Subscription Expired</div>
      <div style="font-size:13px;color:${TEXT_MED}">Hello ${userName || 'there'}</div>
    </div>

    <div style="background:linear-gradient(135deg,${RED}15,${RED}08);border:1px solid ${RED}30;border-radius:10px;padding:24px;text-align:center;margin-bottom:20px">
      <div style="font-size:16px;font-weight:600;color:${RED}">Your ${planName} subscription has expired</div>
      <div style="font-size:13px;color:${TEXT_MED};margin-top:8px">Renew now to continue enjoying premium features.</div>
    </div>

    <div style="text-align:center;margin-bottom:16px">
      <a href="${process.env.APP_URL || 'http://localhost:5173'}/pricing" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;padding:12px 36px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Renew Subscription</a>
    </div>

    <div style="font-size:12px;color:${TEXT_LIGHT};text-align:center;padding-top:16px;border-top:1px solid ${BORDER}">
      Need help? Reply to this email or contact our support team.
    </div>
  `);

  return sendViaTransport({ to: email, subject, html, label: 'Expired notice' });
}

// ── Section render helpers ──

function section(title, bodyHtml) {
  if (!bodyHtml) return '';
  return `
    <div style="background:${CARD_WHITE};border:1px solid ${BORDER};border-radius:10px;overflow:hidden;margin-bottom:16px">
      <div style="background:${BRAND_COLOR};color:#ffffff;padding:10px 14px;font-size:13px;font-weight:600">${title}</div>
      <div style="padding:14px;font-size:13px;color:${TEXT_MED};line-height:1.7">${bodyHtml}</div>
    </div>`;
}

function gainerTable(title, rows) {
  const r = (rows || []).slice(0, 6).map(s => `<tr><td style="padding:4px 8px;border-bottom:1px solid ${BORDER};font-size:12px;font-weight:600;color:${TEXT_DARK}">${s.symbol}</td><td style="padding:4px 8px;border-bottom:1px solid ${BORDER};font-size:12px;color:${TEXT_MED}">${s.company_name || ''}</td><td style="padding:4px 8px;border-bottom:1px solid ${BORDER};font-size:12px;text-align:right;color:${GREEN}">+${s.changePercent?.toFixed(2) || '0.00'}%</td></tr>`).join('');
  return `<div style="background:${CARD_WHITE};border:1px solid ${BORDER};border-radius:10px;overflow:hidden"><div style="background:${GREEN};color:#ffffff;padding:8px 12px;font-size:12px;font-weight:600">${title}</div><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:11px"><thead><tr style="background:${BG_LIGHT}"><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Symbol</th><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Name</th><th style="padding:4px 8px;text-align:right;color:${TEXT_MED}">Chg</th></tr></thead><tbody>${r || '<tr><td colspan="3" style="padding:12px;text-align:center;color:#94a3b8;font-size:12px">No data</td></tr>'}</tbody></table></div>`;
}

function loserTable(title, rows) {
  const r = (rows || []).slice(0, 6).map(s => `<tr><td style="padding:4px 8px;border-bottom:1px solid ${BORDER};font-size:12px;font-weight:600;color:${TEXT_DARK}">${s.symbol}</td><td style="padding:4px 8px;border-bottom:1px solid ${BORDER};font-size:12px;color:${TEXT_MED}">${s.company_name || ''}</td><td style="padding:4px 8px;border-bottom:1px solid ${BORDER};font-size:12px;text-align:right;color:${RED}">${s.changePercent?.toFixed(2) || '0.00'}%</td></tr>`).join('');
  return `<div style="background:${CARD_WHITE};border:1px solid ${BORDER};border-radius:10px;overflow:hidden"><div style="background:${RED};color:#ffffff;padding:8px 12px;font-size:12px;font-weight:600">${title}</div><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:11px"><thead><tr style="background:${BG_LIGHT}"><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Symbol</th><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Name</th><th style="padding:4px 8px;text-align:right;color:${TEXT_MED}">Chg</th></tr></thead><tbody>${r || '<tr><td colspan="3" style="padding:12px;text-align:center;color:#94a3b8;font-size:12px">No data</td></tr>'}</tbody></table></div>`;
}

// ── 1. WEEKLY MARKET DIGEST ──

async function sendWeeklyDigestEmail(email, data) {
  const {
    userName, dateStr,
    nseGainers, nseLosers, globalGainers, globalLosers,
    newsHeadlines, totalSignals,
    nseSummary, storyOfWeek, milestone,
    globalTheme, macroBackdrop, whatToWatch,
    nseGlobalConnection,
  } = data;

  const subject = `Your Weekly Market Digest — ${dateStr}`;

  const newsRows = (newsHeadlines || []).slice(0, 8).map(n =>
    `<tr><td style="padding:6px 8px;border-bottom:1px solid ${BORDER};font-size:12px;color:${TEXT_DARK};line-height:1.5">${n.headline}</td><td style="padding:6px 8px;border-bottom:1px solid ${BORDER};font-size:11px;color:${TEXT_LIGHT};text-align:right">${n.source || ''}</td></tr>`
  ).join('');

  const html = baseWrapper(`
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:20px;font-weight:700;color:${TEXT_DARK}">Weekly Market Digest</div>
      <div style="font-size:13px;color:${TEXT_MED}">${dateStr}</div>
      ${userName ? `<div style="font-size:14px;color:${TEXT_MED};margin-top:8px">Hello ${userName}</div>` : ''}
    </div>

    ${totalSignals !== undefined ? `
    <div style="background:linear-gradient(135deg,${BRAND_COLOR}10,${BRAND_COLOR}05);border:1px solid ${BRAND_COLOR}30;border-radius:10px;padding:16px;margin-bottom:20px;text-align:center">
      <div style="font-size:28px;font-weight:800;color:${BRAND_COLOR}">${totalSignals}</div>
      <div style="font-size:12px;color:${TEXT_MED}">Active AI Signals This Week</div>
    </div>` : ''}

    ${section('NSE — What Happened Last Week', nseSummary || '' )}
    ${section('Story of the Week', storyOfWeek || '')}
    ${section('Milestone to Note', milestone || '')}

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:16px">
      <tr>
        <td style="width:50%;padding:0 6px 0 0;vertical-align:top">${gainerTable('NSE Top Gainers', nseGainers)}</td>
        <td style="width:50%;padding:0 0 0 6px;vertical-align:top">${loserTable('NSE Top Losers', nseLosers)}</td>
      </tr>
    </table>

    ${section('Global Markets — Key Themes This Week', globalTheme || '')}
    ${section('Macro Backdrop', macroBackdrop || '')}
    ${section('What to Watch This Week', whatToWatch || '')}

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:16px">
      <tr>
        <td style="width:50%;padding:0 6px 0 0;vertical-align:top">${gainerTable('Global Top Gainers', globalGainers)}</td>
        <td style="width:50%;padding:0 0 0 6px;vertical-align:top">${loserTable('Global Top Losers', globalLosers)}</td>
      </tr>
    </table>

    ${section('NSE — Global Connection', nseGlobalConnection || '')}

    <div style="background:${CARD_WHITE};border:1px solid ${BORDER};border-radius:10px;overflow:hidden;margin-bottom:16px">
      <div style="background:${BRAND_COLOR};color:#ffffff;padding:10px 14px;font-size:13px;font-weight:600">Top Market News</div>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:11px">
        ${newsRows || '<tr><td style="padding:12px;text-align:center;color:#94a3b8;font-size:12px">No recent news</td></tr>'}
      </table>
    </div>

    <div style="text-align:center;margin-top:8px">
      <a href="${process.env.APP_URL || 'http://localhost:5173'}/app/dashboard" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;padding:14px 36px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:700">EXPLORE FULL PLATFORM \u2192</a>
    </div>
  `, `<meta name="referrer" content="no-referrer" />`);

  return sendViaTransport({ to: email, subject, html, label: 'Weekly digest' });
}

// ── 2. DAILY MARKET BRIEF ──

async function sendDailyBriefEmail(email, data) {
  const {
    userName, dateStr,
    indices, yesterdayTopMovers, aiSignal, aiSignalContext,
    globalIndices, globalToNseConnection, calendar, analystTake,
  } = data;

  const subject = `Daily Market Brief — ${dateStr}`;

  function indexRow(label, value, change, signal) {
    const sigColor = signal === 'BULLISH' ? GREEN : signal === 'BEARISH' ? RED : AMBER;
    const chgColor = change && change.startsWith('+') ? GREEN : change && change.startsWith('-') ? RED : TEXT_MED;
    return `<tr><td style="padding:6px 10px;border-bottom:1px solid ${BORDER};font-size:13px;font-weight:600;color:${TEXT_DARK}">${label}</td><td style="padding:6px 10px;border-bottom:1px solid ${BORDER};font-size:13px;text-align:right;color:${TEXT_DARK}">${value || '--'}</td><td style="padding:6px 10px;border-bottom:1px solid ${BORDER};font-size:13px;text-align:right;color:${chgColor}">${change || '--'}</td><td style="padding:6px 10px;border-bottom:1px solid ${BORDER};font-size:11px;text-align:center;color:#ffffff;background:${sigColor};border-radius:4px;font-weight:600">${signal || '--'}</td></tr>`;
  }

  const indexRows = ((indices || []).slice(0, 5)).map(i => indexRow(i.label, i.value, i.change, i.signal)).join('');

  const moverRows = (yesterdayTopMovers || []).slice(0, 6).map(m =>
    `<tr><td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;font-weight:600;color:${TEXT_DARK}">${m.symbol}</td><td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;color:${TEXT_MED}">${m.company}</td><td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;text-align:right;color:${m.change?.startsWith('+') ? GREEN : RED}">${m.change || '--'}</td><td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;text-align:right;color:${TEXT_MED}">${m.volume || '--'}</td></tr>`
  ).join('');

  const globalRows = ((globalIndices || []).slice(0, 4)).map(g =>
    `<tr><td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;font-weight:600;color:${TEXT_DARK}">${g.label}</td><td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;text-align:right;color:${TEXT_DARK}">${g.value || '--'}</td><td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;text-align:right;color:${g.change?.startsWith('+') ? GREEN : RED}">${g.change || '--'}</td><td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;color:${TEXT_MED}">${g.keyDriver || ''}</td></tr>`
  ).join('');

  const calRows = ((calendar || []).slice(0, 5)).map(c =>
    `<tr><td style="padding:4px 8px;border-bottom:1px solid ${BORDER};font-size:11px;color:${TEXT_MED}">${c.time || ''}</td><td style="padding:4px 8px;border-bottom:1px solid ${BORDER};font-size:12px;color:${TEXT_DARK}">${c.event || ''}</td><td style="padding:4px 8px;border-bottom:1px solid ${BORDER};font-size:11px;text-align:center"><span style="background:${c.impact === 'HIGH' ? RED : c.impact === 'MEDIUM' ? AMBER : BG_LIGHT};color:${c.impact === 'HIGH' ? '#fff' : c.impact === 'MEDIUM' ? '#fff' : TEXT_MED};padding:2px 8px;border-radius:3px;font-weight:600;font-size:10px">${c.impact || ''}</span></td></tr>`
  ).join('');

  const html = baseWrapper(`
    <div style="text-align:center;margin-bottom:20px;border-bottom:1px solid ${BORDER};padding-bottom:16px">
      <div style="font-size:11px;color:${TEXT_LIGHT};text-transform:uppercase;letter-spacing:1px">StocksIntels</div>
      <div style="font-size:20px;font-weight:700;color:${TEXT_DARK};margin-top:4px">Daily Market Brief</div>
      <div style="font-size:12px;color:${TEXT_MED}">${dateStr} \u2022 Published 7:00am EAT</div>
      ${userName ? `<div style="font-size:13px;color:${TEXT_MED};margin-top:8px">Morning ${userName} \u2014 your edge before the NSE opens at 9:30am.</div>` : ''}
    </div>

    <div style="font-size:14px;font-weight:600;color:${TEXT_DARK};margin-bottom:10px">Today\u2019s Market Snapshot</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin-bottom:20px;font-size:12px;border:1px solid ${BORDER};border-radius:8px;overflow:hidden">
      <thead><tr style="background:${BG_LIGHT}"><th style="padding:6px 10px;text-align:left;color:${TEXT_MED}">Market</th><th style="padding:6px 10px;text-align:right;color:${TEXT_MED}">Close</th><th style="padding:6px 10px;text-align:right;color:${TEXT_MED}">Chg</th><th style="padding:6px 10px;text-align:center;color:${TEXT_MED}">Signal</th></tr></thead>
      <tbody>${indexRows || '<tr><td colspan="4" style="padding:12px;text-align:center;color:#94a3b8">Index data loading...</td></tr>'}</tbody>
    </table>

    <div style="font-size:14px;font-weight:600;color:${TEXT_DARK};margin-bottom:10px">Yesterday\u2019s Top Movers</div>
    <div style="background:${CARD_WHITE};border:1px solid ${BORDER};border-radius:10px;overflow:hidden;margin-bottom:20px">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:11px">
        <thead><tr style="background:${BG_LIGHT}"><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Symbol</th><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Company</th><th style="padding:4px 8px;text-align:right;color:${TEXT_MED}">Change</th><th style="padding:4px 8px;text-align:right;color:${TEXT_MED}">Volume</th></tr></thead>
        <tbody>${moverRows || '<tr><td colspan="4" style="padding:12px;text-align:center;color:#94a3b8;font-size:12px">No movers data</td></tr>'}</tbody>
      </table>
    </div>

    ${section('AI Signal of the Day', aiSignal ? `<div style="font-size:14px;color:${TEXT_DARK};margin-bottom:8px">${aiSignal}</div>${aiSignalContext ? `<div style="font-size:12px;color:${TEXT_LIGHT};border-top:1px solid ${BORDER};padding-top:8px;margin-top:8px"><strong>WHY IT MATTERS:</strong> ${aiSignalContext}</div>` : ''}` : '')}

    <div style="font-size:14px;font-weight:600;color:${TEXT_DARK};margin-bottom:10px;margin-top:4px">Global Overnight</div>
    <div style="background:${CARD_WHITE};border:1px solid ${BORDER};border-radius:10px;overflow:hidden;margin-bottom:16px">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:11px">
        <thead><tr style="background:${BG_LIGHT}"><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Index</th><th style="padding:4px 8px;text-align:right;color:${TEXT_MED}">Close</th><th style="padding:4px 8px;text-align:right;color:${TEXT_MED}">Change</th><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Key Driver</th></tr></thead>
        <tbody>${globalRows || '<tr><td colspan="4" style="padding:12px;text-align:center;color:#94a3b8">No data</td></tr>'}</tbody>
      </table>
    </div>

    ${section('Global-to-NSE Connection', globalToNseConnection || '')}

    ${calendar && calendar.length ? `
    <div style="font-size:14px;font-weight:600;color:${TEXT_DARK};margin-bottom:10px">Today\u2019s Calendar</div>
    <div style="background:${CARD_WHITE};border:1px solid ${BORDER};border-radius:10px;overflow:hidden;margin-bottom:16px">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:11px">
        <thead><tr style="background:${BG_LIGHT}"><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Time (EAT)</th><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Event</th><th style="padding:4px 8px;text-align:center;color:${TEXT_MED}">Impact</th></tr></thead>
        <tbody>${calRows}</tbody>
      </table>
    </div>` : ''}

    ${section('Analyst Take', analystTake || '')}

    <div style="text-align:center;margin-top:8px;border-top:1px solid ${BORDER};padding-top:16px">
      <div style="font-size:12px;color:${TEXT_LIGHT};margin-bottom:12px">Explore full signals and analysis on the StocksIntels platform.</div>
      <a href="${process.env.APP_URL || 'http://localhost:5173'}/app/dashboard" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;padding:12px 32px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700">VISIT PLATFORM \u2192</a>
    </div>
  `, `<meta name="referrer" content="no-referrer" />`);

  return sendViaTransport({ to: email, subject, html, label: 'Daily brief' });
}

// ── 3. EARNINGS & CORPORATE ACTIONS ──

async function sendEarningsReportEmail(email, data) {
  const {
    userName, dateStr,
    earningsCalendar, earningsResults, corporateActions, globalEarnings,
  } = data;

  const subject = `Earnings & Corporate Actions — ${dateStr}`;

  const calRows = ((earningsCalendar || []).slice(0, 12)).map(e =>
    `<tr><td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:11px;color:${TEXT_MED}">${e.date || ''}</td><td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;font-weight:600;color:${TEXT_DARK}">${e.company || ''}</td><td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:11px;color:${TEXT_LIGHT}">${e.exchange || ''}</td><td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:11px;color:${TEXT_MED}">${e.period || ''}</td><td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:11px;text-align:center"><span style="background:${e.aiExpectation === 'BEAT' ? GREEN + '20' : e.aiExpectation === 'MISS' ? RED + '20' : AMBER + '20'};color:${e.aiExpectation === 'BEAT' ? GREEN : e.aiExpectation === 'MISS' ? RED : AMBER};padding:2px 8px;border-radius:3px;font-weight:700;font-size:10px">${e.aiExpectation || '--'}</span></td></tr>`
  ).join('');

  function earningsBlock(r) {
    if (!r) return '';
    const verdictColor = r.verdict === 'BEAT' ? GREEN : r.verdict === 'MISS' ? RED : AMBER;
    return `
      <div style="background:${CARD_WHITE};border:1px solid ${BORDER};border-radius:10px;overflow:hidden;margin-bottom:16px">
        <div style="background:${BG_LIGHT};padding:10px 14px;border-bottom:1px solid ${BORDER}">
          <div style="font-size:14px;font-weight:700;color:${TEXT_DARK}">${r.ticker || ''} — ${r.company || ''}</div>
          <div style="font-size:11px;color:${TEXT_LIGHT}">${r.exchange || ''} \u2022 ${r.period || ''}</div>
        </div>
        <div style="padding:12px 14px;border-bottom:1px solid ${BORDER}">
          <div style="text-align:center;margin-bottom:10px"><span style="background:${verdictColor};color:#ffffff;padding:4px 16px;border-radius:4px;font-size:13px;font-weight:700">AI VERDICT: ${r.verdict || '--'}</span></div>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:12px">
            <tr><td style="padding:4px 0;color:${TEXT_MED}">Revenue</td><td style="padding:4px 0;text-align:right;font-weight:600;color:${TEXT_DARK}">${r.revenue || '--'}</td></tr>
            <tr><td style="padding:4px 0;color:${TEXT_MED}">Net Profit</td><td style="padding:4px 0;text-align:right;font-weight:600;color:${TEXT_DARK}">${r.netProfit || '--'}</td></tr>
            <tr><td style="padding:4px 0;color:${TEXT_MED}">EPS</td><td style="padding:4px 0;text-align:right;font-weight:600;color:${TEXT_DARK}">${r.eps || '--'}</td></tr>
            <tr><td style="padding:4px 0;color:${TEXT_MED}">vs Estimate</td><td style="padding:4px 0;text-align:right;font-weight:600;color:${(r.vsEstimate || '').startsWith('+') ? GREEN : RED}">${r.vsEstimate || '--'}</td></tr>
          </table>
        </div>
        <div style="padding:12px 14px;border-bottom:1px solid ${BORDER}">
          <div style="font-size:12px;color:${TEXT_MED};line-height:1.7">${r.aiAnalysis || 'No analysis available.'}</div>
        </div>
        <div style="padding:10px 14px;font-size:11px;color:${TEXT_MED}">
          <strong>SIGNAL</strong> Short-term: <span style="color:${r.shortTermSignal === 'BULLISH' ? GREEN : r.shortTermSignal === 'BEARISH' ? RED : AMBER}">${r.shortTermSignal || '--'}</span>
          ${r.dividend ? ` \u2022 <strong>Dividend:</strong> ${r.dividend}` : ''}
          ${r.watchPrice ? ` \u2022 <strong>Watch price:</strong> ${r.watchPrice}` : ''}
        </div>
      </div>`;
  }

  const caRows = ((corporateActions || []).slice(0, 10)).map(a =>
    `<tr><td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:11px;color:${TEXT_MED}">${a.date || ''}</td><td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;font-weight:600;color:${TEXT_DARK}">${a.company || ''}</td><td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:11px;color:${TEXT_LIGHT}">${a.exchange || ''}</td><td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;color:${BRAND_COLOR};font-weight:600">${a.actionType || ''}</td><td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:11px;color:${TEXT_MED}">${a.details || ''}</td></tr>`
  ).join('');

  const geRows = ((globalEarnings || []).slice(0, 5)).map(g =>
    `<tr><td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;font-weight:600;color:${TEXT_DARK}">${g.ticker || ''}</td><td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;color:${TEXT_MED}">${g.company || ''}</td><td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:11px;text-align:center"><span style="background:${g.result === 'BEAT' ? GREEN + '20' : g.result === 'MISS' ? RED + '20' : AMBER + '20'};color:${g.result === 'BEAT' ? GREEN : g.result === 'MISS' ? RED : AMBER};padding:2px 8px;border-radius:3px;font-weight:700;font-size:10px">${g.result || '--'}</span></td><td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:11px;color:${TEXT_MED};line-height:1.4">${g.africaImpact || ''}</td></tr>`
  ).join('');

  const html = baseWrapper(`
    <div style="text-align:center;margin-bottom:24px;border-bottom:1px solid ${BORDER};padding-bottom:16px">
      <div style="font-size:11px;color:${TEXT_LIGHT};text-transform:uppercase;letter-spacing:1px">StocksIntels</div>
      <div style="font-size:20px;font-weight:700;color:${TEXT_DARK};margin-top:4px">Earnings & Corporate Actions</div>
      <div style="font-size:12px;color:${TEXT_MED}">${dateStr} \u2022 Covering: NSE, NGX, GSE, JSE + Global</div>
      ${userName ? `<div style="font-size:13px;color:${TEXT_MED};margin-top:6px">Hello ${userName}</div>` : ''}
    </div>

    <div style="font-size:14px;font-weight:600;color:${TEXT_DARK};margin-bottom:10px">Earnings Calendar</div>
    <div style="font-size:11px;color:${TEXT_LIGHT};margin-bottom:10px">Companies reporting results this period across covered exchanges:</div>
    <div style="background:${CARD_WHITE};border:1px solid ${BORDER};border-radius:10px;overflow:hidden;margin-bottom:20px">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:11px">
        <thead><tr style="background:${BG_LIGHT}"><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Date</th><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Company</th><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Exch</th><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Period</th><th style="padding:4px 8px;text-align:center;color:${TEXT_MED}">AI Expectation</th></tr></thead>
        <tbody>${calRows || '<tr><td colspan="5" style="padding:12px;text-align:center;color:#94a3b8">No upcoming earnings</td></tr>'}</tbody>
      </table>
    </div>

    <div style="font-size:14px;font-weight:600;color:${TEXT_DARK};margin-bottom:10px">Results Summaries</div>
    <div style="font-size:11px;color:${TEXT_LIGHT};margin-bottom:10px">AI-generated summaries of key results reported this period:</div>
    ${(earningsResults || []).slice(0, 5).map(r => earningsBlock(r)).join('') || '<div style="background:${BG_LIGHT};border-radius:10px;padding:18px;margin-bottom:20px;text-align:center;font-size:13px;color:${TEXT_MED}">No results yet this period.</div>'}

    ${corporateActions && corporateActions.length ? `
    <div style="font-size:14px;font-weight:600;color:${TEXT_DARK};margin-bottom:10px">Corporate Actions Alert</div>
    <div style="background:${CARD_WHITE};border:1px solid ${BORDER};border-radius:10px;overflow:hidden;margin-bottom:20px">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:11px">
        <thead><tr style="background:${BG_LIGHT}"><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Date</th><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Company</th><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Exch</th><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Action</th><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Details</th></tr></thead>
        <tbody>${caRows}</tbody>
      </table>
    </div>` : ''}

    ${globalEarnings && globalEarnings.length ? `
    <div style="font-size:14px;font-weight:600;color:${TEXT_DARK};margin-bottom:10px">Global Earnings — Africa Impact Watch</div>
    <div style="background:${CARD_WHITE};border:1px solid ${BORDER};border-radius:10px;overflow:hidden;margin-bottom:20px">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:11px">
        <thead><tr style="background:${BG_LIGHT}"><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Ticker</th><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Company</th><th style="padding:4px 8px;text-align:center;color:${TEXT_MED}">Result</th><th style="padding:4px 8px;text-align:left;color:${TEXT_MED}">Africa Impact</th></tr></thead>
        <tbody>${geRows}</tbody>
      </table>
    </div>` : ''}

    <div style="text-align:center;margin-top:8px;border-top:1px solid ${BORDER};padding-top:16px">
      <div style="font-size:12px;color:${TEXT_LIGHT};margin-bottom:12px">Full earnings data, AI verdicts, and corporate action calendar on the StocksIntels platform.</div>
      <a href="${process.env.APP_URL || 'http://localhost:5173'}/app/stocks" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;padding:12px 32px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700">VIEW EARNINGS \u2192</a>
    </div>
  `, `<meta name="referrer" content="no-referrer" />`);

  return sendViaTransport({ to: email, subject, html, label: 'Earnings report' });
}

module.exports = { sendResetCode, sendOtpEmail, sendVerificationEmail, sendWelcomeEmail, sendPortfolioReportEmail, sendDailySentimentEmail, sendHotNewsEmail, sendPaymentReceiptEmail, sendSubscriptionExpiryReminder, sendSubscriptionExpiredEmail, sendWeeklyDigestEmail, sendDailyBriefEmail, sendEarningsReportEmail, sendViaTransport };