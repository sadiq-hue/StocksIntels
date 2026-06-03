const nodemailer = require('nodemailer');

let transporter = null;

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

async function sendResetCode(email, code) {
  const t = await getTransporter();
  const info = await t.sendMail({
    from: `"StocksIntels" <${process.env.SMTP_FROM || 'noreply@stockintel.local'}>`,
    to: email,
    subject: 'Password Reset Code',
    text: `Your password reset code is: ${code}\n\nThis code expires in 15 minutes.\n\nIf you did not request this, please ignore this email.`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#f9fafb;border-radius:12px">
      <div style="text-align:center;margin-bottom:24px">
        <h1 style="color:#0D7490;font-size:24px;margin:0">StocksIntels</h1>
        <p style="color:#6b7280;font-size:14px">Password Reset Code</p>
      </div>
      <div style="background:white;padding:24px;border-radius:8px;text-align:center">
        <p style="color:#374151;font-size:14px;margin:0 0 16px">Use the code below to reset your password. It expires in <strong>15 minutes</strong>.</p>
        <div style="background:#f3f4f6;padding:16px;border-radius:8px;letter-spacing:0.3em;font-size:32px;font-weight:bold;color:#0D7490;font-family:monospace">${code}</div>
      </div>
      <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:24px">If you did not request this, you can safely ignore this email.</p>
    </div>`,
  });

  if (info.messageId && !process.env.SMTP_HOST) {
    console.log('[MAILER] Preview URL:', nodemailer.getTestMessageUrl(info));
  }
  return info;
}

async function sendOtpEmail(email, code) {
  const t = await getTransporter();
  const info = await t.sendMail({
    from: `"StocksIntels" <${process.env.SMTP_FROM || 'noreply@stockintel.local'}>`,
    to: email,
    subject: 'Your OTP Login Code',
    text: `Your OTP login code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you did not request this, please ignore this email.`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#f9fafb;border-radius:12px">
      <div style="text-align:center;margin-bottom:24px">
        <h1 style="color:#0D7490;font-size:24px;margin:0">StocksIntels</h1>
        <p style="color:#6b7280;font-size:14px">One-Time Login Code</p>
      </div>
      <div style="background:white;padding:24px;border-radius:8px;text-align:center">
        <p style="color:#374151;font-size:14px;margin:0 0 16px">Use the code below to sign in. It expires in <strong>10 minutes</strong>.</p>
        <div style="background:#f3f4f6;padding:16px;border-radius:8px;letter-spacing:0.3em;font-size:32px;font-weight:bold;color:#0D7490;font-family:monospace">${code}</div>
      </div>
      <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:24px">If you did not request this, you can safely ignore this email.</p>
    </div>`,
  });

  if (info.messageId && !process.env.SMTP_HOST) {
    console.log('[MAILER] Preview URL:', nodemailer.getTestMessageUrl(info));
  }
  return info;
}

async function sendPortfolioReportEmail(email, data) {
  const t = await getTransporter();
  const { userName, generatedAt, summary, holdings, sectorAllocation, bestPerformers, worstPerformers } = data;
  const dateStr = new Date(generatedAt).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const pnlColor = summary.totalPnL >= 0 ? '#059669' : '#dc2626';
  const pnlArrow = summary.totalPnL >= 0 ? '▲' : '▼';

  const holdingsRows = (holdings || []).slice(0, 20).map(h => {
    const hp = h.pnl >= 0 ? '#059669' : '#dc2626';
    const ha = h.pnl >= 0 ? '▲' : '▼';
    return `<tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600">${h.ticker}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px">${h.name || ''}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">${h.shares}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">$${h.currentPrice?.toFixed(2) || '0.00'}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">$${h.value?.toFixed(2) || '0.00'}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;color:${hp}">${ha} $${Math.abs(h.pnl || 0).toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;color:${hp}">${h.pnlPercent?.toFixed(1) || '0.0'}%</td>
    </tr>`;
  }).join('');

  const sectorRows = (sectorAllocation || []).map(s => {
    const pct = s.pct || 0;
    return `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6">${s.sector}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:right">KES ${(s.value || 0).toLocaleString(undefined, {minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:right">${pct}%</td>
    </tr>`;
  }).join('');

  const bestRows = (bestPerformers || []).slice(0, 3).map(h =>
    `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px">
      <span style="font-weight:600">${h.ticker}</span>
      <span style="color:#059669">+${h.pnlPercent?.toFixed(1) || '0.0'}%</span>
    </div>`
  ).join('');

  const worstRows = (worstPerformers || []).slice(0, 3).map(h =>
    `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px">
      <span style="font-weight:600">${h.ticker}</span>
      <span style="color:#dc2626">${h.pnlPercent?.toFixed(1) || '0.0'}%</span>
    </div>`
  ).join('');

  const info = await t.sendMail({
    from: `"StocksIntels" <${process.env.SMTP_FROM || 'noreply@stockintel.local'}>`,
    to: email,
    subject: `📊 StocksIntels Portfolio Report — ${dateStr}`,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#f9fafb;border-radius:12px">
      <div style="text-align:center;margin-bottom:24px">
        <h1 style="color:#0D7490;font-size:24px;margin:0">StocksIntels</h1>
        <p style="color:#6b7280;font-size:13px">Portfolio Report — ${dateStr}</p>
        ${userName ? `<p style="color:#374151;font-size:14px;margin:8px 0 0">Hello ${userName}!</p>` : ''}
      </div>

      <!-- Summary Cards -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <tr>
          <td style="width:33%;padding:8px">
            <div style="background:white;border-radius:8px;padding:12px;text-align:center;border:1px solid #e5e7eb">
              <div style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Total Value</div>
              <div style="font-size:20px;font-weight:bold;color:#0D7490;margin-top:4px">KES ${(summary.totalValue || 0).toLocaleString(undefined, {minimumFractionDigits:2,maximumFractionDigits:2})}</div>
            </div>
          </td>
          <td style="width:33%;padding:8px">
            <div style="background:white;border-radius:8px;padding:12px;text-align:center;border:1px solid #e5e7eb">
              <div style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Total Cost</div>
              <div style="font-size:20px;font-weight:bold;color:#374151;margin-top:4px">KES ${(summary.totalCost || 0).toLocaleString(undefined, {minimumFractionDigits:2,maximumFractionDigits:2})}</div>
            </div>
          </td>
          <td style="width:33%;padding:8px">
            <div style="background:white;border-radius:8px;padding:12px;text-align:center;border:1px solid #e5e7eb">
              <div style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">P&L</div>
              <div style="font-size:20px;font-weight:bold;color:${pnlColor};margin-top:4px">${pnlArrow} KES ${Math.abs(summary.totalPnL || 0).toLocaleString(undefined, {minimumFractionDigits:2,maximumFractionDigits:2})}</div>
              <div style="font-size:12px;color:${pnlColor}">(${summary.pnlPercent?.toFixed(1) || '0.0'}%)</div>
            </div>
          </td>
        </tr>
      </table>

      <!-- Holdings Table -->
      <div style="background:white;border-radius:8px;border:1px solid #e5e7eb;margin-bottom:20px;overflow:hidden">
        <div style="background:#0D7490;color:white;padding:10px 16px;font-size:14px;font-weight:600">Holdings (${holdings?.length || 0})</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:#f3f4f6">
              <th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb">Ticker</th>
              <th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb">Name</th>
              <th style="padding:8px;text-align:right;border-bottom:2px solid #e5e7eb">Shares</th>
              <th style="padding:8px;text-align:right;border-bottom:2px solid #e5e7eb">Price</th>
              <th style="padding:8px;text-align:right;border-bottom:2px solid #e5e7eb">Value</th>
              <th style="padding:8px;text-align:right;border-bottom:2px solid #e5e7eb">P&L</th>
              <th style="padding:8px;text-align:right;border-bottom:2px solid #e5e7eb">%</th>
            </tr>
          </thead>
          <tbody>${holdingsRows}</tbody>
        </table>
        ${(holdings?.length || 0) > 20 ? `<div style="padding:8px 16px;text-align:center;color:#6b7280;font-size:12px">Showing top 20 of ${holdings.length} holdings</div>` : ''}
      </div>

      <!-- Best / Worst -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <tr>
          <td style="width:50%;padding:4px 8px 0 0;vertical-align:top">
            <div style="background:white;border-radius:8px;border:1px solid #e5e7eb;padding:12px">
              <div style="font-size:13px;font-weight:600;color:#059669;margin-bottom:8px">🏆 Best Performers</div>
              ${bestRows || '<div style="font-size:12px;color:#9ca3af">No data</div>'}
            </div>
          </td>
          <td style="width:50%;padding:4px 0 0 8px;vertical-align:top">
            <div style="background:white;border-radius:8px;border:1px solid #e5e7eb;padding:12px">
              <div style="font-size:13px;font-weight:600;color:#dc2626;margin-bottom:8px">⚠️ Worst Performers</div>
              ${worstRows || '<div style="font-size:12px;color:#9ca3af">No data</div>'}
            </div>
          </td>
        </tr>
      </table>

      <!-- Sector Allocation -->
      <div style="background:white;border-radius:8px;border:1px solid #e5e7eb;margin-bottom:20px;overflow:hidden">
        <div style="background:#0D7490;color:white;padding:10px 16px;font-size:14px;font-weight:600">Sector Allocation</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:#f3f4f6">
              <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #e5e7eb">Sector</th>
              <th style="padding:6px 8px;text-align:right;border-bottom:2px solid #e5e7eb">Value (KES)</th>
              <th style="padding:6px 8px;text-align:right;border-bottom:2px solid #e5e7eb">%</th>
            </tr>
          </thead>
          <tbody>${sectorRows || '<tr><td colspan="3" style="padding:12px;text-align:center;color:#9ca3af">No sectors</td></tr>'}</tbody>
        </table>
      </div>

      <!-- Footer -->
      <div style="text-align:center;color:#9ca3af;font-size:11px;border-top:1px solid #e5e7eb;padding-top:16px">
        <p>This is an automated portfolio report from StocksIntels.</p>
        <p>Generated at ${new Date(generatedAt).toLocaleString()}</p>
      </div>
    </div>`,
  });

  if (info.messageId && !process.env.SMTP_HOST) {
    console.log('[MAILER] Portfolio report preview URL:', nodemailer.getTestMessageUrl(info));
  }
  return info;
}

module.exports = { sendResetCode, sendOtpEmail, sendPortfolioReportEmail };
