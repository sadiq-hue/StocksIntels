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

  if (!senderAddress) {
    throw new Error('ENSEND_SENDER_ADDRESS env var is required when using Ensend');
  }

  const recipients = Array.isArray(to)
    ? to.map(addr => ({ address: addr }))
    : { address: to };

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
    <td style="padding:6px 10px;border-bottom:1px solid ${BORDER};font-size:12px;text-align:right;color:${GREEN}">+${h.pnlPercent?.toFixed(1) || '0.0'}%</td>
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

module.exports = { sendResetCode, sendOtpEmail, sendVerificationEmail, sendWelcomeEmail, sendPortfolioReportEmail, sendDailySentimentEmail, sendHotNewsEmail, sendPaymentReceiptEmail, sendSubscriptionExpiryReminder, sendSubscriptionExpiredEmail };