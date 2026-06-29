const { pool } = require('./db');
const { sendViaTransport } = require('./mailer');

const BRAND_COLOR = '#0D7490';
const BG_LIGHT = '#f4f6f8';
const CARD_WHITE = '#ffffff';
const TEXT_DARK = '#1e293b';
const TEXT_MED = '#475569';
const TEXT_LIGHT = '#94a3b8';
const BORDER = '#e2e8f0';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

function baseWrapper(innerHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>StocksIntels</title>
</head>
<body style="margin:0;padding:0;background-color:${BG_LIGHT};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BG_LIGHT}">
    <tr>
      <td align="center" style="padding:32px 16px">
        <table role="presentation" width="100%" style="max-width:560px;background:${CARD_WHITE};border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06),0 1px 2px rgba(0,0,0,0.04)">
          <tr>
            <td style="background:linear-gradient(135deg,${BRAND_COLOR} 0%,#0a5f8a 100%);padding:20px 32px;text-align:center">
              <div style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.5px">StocksIntels</div>
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
                <div>This is part of your onboarding sequence.</div>
                <div style="margin-top:4px"><a href="${APP_URL}/app/settings/notifications" style="color:${BRAND_COLOR};text-decoration:underline;font-size:11px">Unsubscribe from onboarding emails</a></div>
                <div style="margin-top:4px">&copy; ${new Date().getFullYear()} StocksIntels. All rights reserved.</div>
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

function ctaButton(text, url) {
  return `<a href="${url}" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;padding:14px 36px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:700">${text}</a>`;
}

const TEMPLATES = {
  onboarding_day1_welcome: (name) => ({
    subject: "You're in. Here's what StocksIntels can do for you.",
    html: baseWrapper(`
      <p style="font-size:15px;color:${TEXT_DARK};line-height:1.7;margin:0 0 16px">Hi ${name || 'there'},</p>
      <p style="font-size:14px;color:${TEXT_MED};line-height:1.7;margin:0 0 16px">Welcome to StocksIntels. You've just joined a platform built for investors who take markets seriously — whether you're tracking the NSE, NGX, GSE, JSE, or global exchanges.</p>
      <p style="font-size:14px;color:${TEXT_MED};line-height:1.7;margin:0 0 16px">StocksIntels combines African and global market data with AI-driven analysis, sentiment signals, and technical indicators — giving you a complete picture no matter where you invest.</p>
      <div style="background:${BG_LIGHT};border-radius:10px;padding:20px;margin:0 0 20px">
        <div style="font-size:14px;font-weight:600;color:${TEXT_DARK};margin-bottom:12px">Here's where to start:</div>
        <div style="font-size:13px;color:${TEXT_MED};line-height:1.9">
          <div style="margin-bottom:4px">→ Set up your <strong>watchlist</strong> with your favourite stocks</div>
          <div style="margin-bottom:4px">→ Run your first <strong>AI analysis</strong> on any listed company</div>
          <div style="margin-bottom:4px">→ Check today's <strong>market signals</strong> across your chosen exchange</div>
        </div>
      </div>
      <div style="background:linear-gradient(135deg,${BRAND_COLOR}08,${BRAND_COLOR}03);border:1px solid ${BRAND_COLOR}20;border-radius:10px;padding:18px 20px;margin:0 0 24px">
        <div style="font-size:13px;color:${TEXT_MED};line-height:1.6">
          <strong style="color:${BRAND_COLOR}">Your free trial</strong> gives you access to delayed data, basic snapshots, and a limited watchlist. When you're ready to go deeper — real-time signals, full AI analysis, and multi-exchange comparison — Pro is waiting for you at <strong>KES 2,599/month ($19.9/mo)</strong>.
        </div>
      </div>
      <div style="text-align:center;margin:0 0 20px">${ctaButton('EXPLORE YOUR DASHBOARD \u2192', APP_URL + '/app/dashboard')}</div>
      <div style="border-top:1px solid ${BORDER};padding-top:16px;margin-top:20px">
        <p style="font-size:13px;color:${TEXT_MED};line-height:1.6;margin:0">Glad you're here.</p>
        <p style="font-size:13px;color:${TEXT_MED};line-height:1.6;margin:4px 0 0"><strong>StocksIntels Team</strong></p>
      </div>
    `),
  }),

  onboarding_day2_education: (name) => ({
    subject: "Why most market tools leave you blind (and how StocksIntels fixes it)",
    html: baseWrapper(`
      <p style="font-size:15px;color:${TEXT_DARK};line-height:1.7;margin:0 0 16px">Hi ${name || 'there'},</p>
      <p style="font-size:14px;color:${TEXT_MED};line-height:1.7;margin:0 0 16px">If you've ever tried to research a stock listed on a less-followed exchange, you already know the gap.</p>
      <p style="font-size:14px;color:${TEXT_MED};line-height:1.7;margin:0 0 16px">Scattered data. Delayed price feeds. Analyst coverage that barely scratches the surface. Reports that are weeks old by the time they reach you.</p>
      <p style="font-size:14px;color:${TEXT_MED};line-height:1.7;margin:0 0 16px">Whether you're tracking companies on the NSE, NYSE, NGX, or LSE — the quality of your tools determines the quality of your decisions. Yet most platforms force you to choose: cover African markets OR global ones. Not both.</p>
      <p style="font-size:14px;color:${TEXT_MED};line-height:1.7;margin:0 0 16px">StocksIntels was built to close that gap — bringing together real-time data, AI-generated sentiment analysis, and technical signals in one place. For African and global markets, side by side.</p>
      <div style="text-align:center;margin:0 0 24px">${ctaButton('ANALYSE A STOCK NOW \u2192', APP_URL + '/app/stocks')}</div>
      <div style="border-top:1px solid ${BORDER};padding-top:16px;margin-top:20px">
        <p style="font-size:13px;color:${TEXT_MED};line-height:1.6;margin:0">Building this for you,</p>
        <p style="font-size:13px;color:${TEXT_MED};line-height:1.6;margin:4px 0 0"><strong>StocksIntels Team</strong></p>
      </div>
    `),
  }),

  onboarding_day5_features: (name) => ({
    subject: '3 things StocksIntels Pro users do differently',
    html: baseWrapper(`
      <p style="font-size:15px;color:${TEXT_DARK};line-height:1.7;margin:0 0 16px">Hi ${name || 'there'},</p>
      <p style="font-size:14px;color:${TEXT_MED};line-height:1.7;margin:0 0 16px">You've had a few days with StocksIntels. By now you've probably noticed there's more under the surface — here's a look at what Pro users are doing that free trial users can't.</p>
      <div style="background:${BG_LIGHT};border-radius:10px;padding:20px;margin:0 0 16px">
        <div style="font-size:15px;font-weight:700;color:${TEXT_DARK};margin-bottom:6px">1. Real-Time Market Signals</div>
        <div style="font-size:13px;color:${TEXT_MED};line-height:1.7">Free trial users see delayed data. Pro users see what's happening right now — price movements, volume spikes, and momentum shifts as they develop. In fast-moving markets, the difference between delayed and real-time can be the difference between a good trade and a missed one.</div>
      </div>
      <div style="background:${BG_LIGHT};border-radius:10px;padding:20px;margin:0 0 16px">
        <div style="font-size:15px;font-weight:700;color:${TEXT_DARK};margin-bottom:6px">2. Full AI Sentiment Analysis</div>
        <div style="font-size:13px;color:${TEXT_MED};line-height:1.7">For every listed company in our database, StocksIntels generates an AI-driven sentiment score based on market data, news signals, and trading patterns. Free trial users see a preview. Pro users see the full breakdown — bullish/bearish signals, trend direction, risk flags.</div>
      </div>
      <div style="background:${BG_LIGHT};border-radius:10px;padding:20px;margin:0 0 16px">
        <div style="font-size:15px;font-weight:700;color:${TEXT_DARK};margin-bottom:6px">3. Multi-Exchange Comparison</div>
        <div style="font-size:13px;color:${TEXT_MED};line-height:1.7">Want to compare how Kenyan banking stocks are performing relative to their Nigerian peers? Or benchmark a JSE-listed company against the S&P 500? Pro gives you the cross-exchange lens that no single-market tool can offer — African and global, side by side.</div>
      </div>
      <div style="background:linear-gradient(135deg,${BRAND_COLOR}10,${BRAND_COLOR}05);border:1px solid ${BRAND_COLOR}30;border-radius:10px;padding:18px 20px;margin:0 0 24px;text-align:center">
        <div style="font-size:13px;color:${TEXT_MED};line-height:1.6">Pro is <strong>KES 2,599/month ($19.9/mo)</strong>. That's less than a single brokerage commission on most exchanges — for a month of intelligence that helps you make every decision sharper.</div>
      </div>
      <div style="text-align:center;margin:0 0 20px">${ctaButton('UPGRADE TO PRO \u2192 KES 2,599/MONTH ($19.9/MO)', APP_URL + '/pricing')}</div>
      <div style="border-top:1px solid ${BORDER};padding-top:16px;margin-top:20px">
        <p style="font-size:13px;color:${TEXT_MED};line-height:1.6;margin:0">More soon,</p>
        <p style="font-size:13px;color:${TEXT_MED};line-height:1.6;margin:4px 0 0"><strong>StocksIntels Team</strong></p>
      </div>
    `),
  }),

  onboarding_day9_story: (name) => ({
    subject: 'Why I built StocksIntels (the real reason)',
    html: baseWrapper(`
      <p style="font-size:15px;color:${TEXT_DARK};line-height:1.7;margin:0 0 16px">Hi ${name || 'there'},</p>
      <p style="font-size:14px;color:${TEXT_MED};line-height:1.7;margin:0 0 16px">I want to tell you why we actually built this.</p>
      <p style="font-size:14px;color:${TEXT_MED};line-height:1.7;margin:0 0 16px">A while back, I was trying to make a serious investment decision on an East African-listed company. I spent hours pulling together data from four different sources, cross-referencing outdated reports, and trying to build a picture of the company's fundamentals from fragments.</p>
      <p style="font-size:14px;color:${TEXT_MED};line-height:1.7;margin:0 0 16px">At the end of it, I had a rough sense of the stock. Not certainty. Not confidence. Just a rough sense.</p>
      <p style="font-size:14px;color:${TEXT_MED};line-height:1.7;margin:0 0 16px">Meanwhile, if I'd been looking at a US-listed company, I could have had AI-generated analysis, real-time signals, and sentiment scores in under two minutes.</p>
      <p style="font-size:14px;color:${TEXT_MED};line-height:1.7;margin:0 0 16px">That gap felt wrong to me. Not just inconvenient — wrong. Whether you invest in African markets, global markets, or both, you deserve the same quality of tooling that the biggest institutions take for granted.</p>
      <p style="font-size:14px;color:${TEXT_MED};line-height:1.7;margin:0 0 16px">So we started building StocksIntels — a platform that treats African and global markets as equally important.</p>
      <p style="font-size:14px;color:${TEXT_MED};line-height:1.7;margin:0 0 16px">We're still early. But the platform is live, investors are using it, and every week we're adding more depth to the analysis, more exchanges, and more signals.</p>
      <p style="font-size:14px;color:${TEXT_MED};line-height:1.7;margin:0 0 16px">If you believe in smarter investing — you're exactly why we built this.</p>
      <div style="text-align:center;margin:0 0 24px">${ctaButton('EXPLORE THE PLATFORM \u2192', APP_URL + '/app/dashboard')}</div>
      <div style="border-top:1px solid ${BORDER};padding-top:16px;margin-top:20px">
        <p style="font-size:13px;color:${TEXT_MED};line-height:1.6;margin:0">Thank you for being here,</p>
        <p style="font-size:13px;color:${TEXT_MED};line-height:1.6;margin:4px 0 0"><strong>StocksIntels Team</strong></p>
      </div>
    `),
  }),

  onboarding_day14_conversion: (name, data) => {
    const stock = data?.mostWatchedStock || 'the market';
    return {
      subject: 'Your free trial window \u2014 and what\'s waiting on the other side',
      html: baseWrapper(`
        <p style="font-size:15px;color:${TEXT_DARK};line-height:1.7;margin:0 0 16px">Hi ${name || 'there'},</p>
        <p style="font-size:14px;color:${TEXT_MED};line-height:1.7;margin:0 0 16px">You've been on StocksIntels for two weeks now. You've seen what the free tier can do.</p>
        <p style="font-size:14px;color:${TEXT_MED};line-height:1.7;margin:0 0 16px">I want to be straight with you about what you're missing.</p>
        <div style="background:${BG_LIGHT};border-radius:10px;padding:20px;margin:0 0 16px">
          <div style="font-size:13px;color:${TEXT_MED};line-height:1.9">
            <div style="margin-bottom:6px">Every time you check a stock and see <strong>delayed data</strong> — that's the gap.</div>
            <div style="margin-bottom:6px">Every time you see <strong>"Full analysis available on Pro"</strong> — that's the gap.</div>
            <div style="margin-bottom:6px">Every time you wish you could <strong>compare across two exchanges</strong> at once — that's the gap.</div>
          </div>
        </div>
        <p style="font-size:14px;color:${TEXT_MED};line-height:1.7;margin:0 0 16px">Pro closes all of it.</p>
        <div style="background:linear-gradient(135deg,${BRAND_COLOR}08,${BRAND_COLOR}03);border:1px solid ${BRAND_COLOR}20;border-radius:10px;padding:20px;margin:0 0 16px">
          <div style="font-size:14px;font-weight:600;color:${BRAND_COLOR};margin-bottom:10px">StocksIntels Pro:</div>
          <div style="font-size:13px;color:${TEXT_MED};line-height:1.9">
            <div style="margin-bottom:4px">\u2192 Real-time data across African and global markets</div>
            <div style="margin-bottom:4px">\u2192 Full AI sentiment and fundamental analysis</div>
            <div style="margin-bottom:4px">\u2192 Unlimited watchlists</div>
            <div style="margin-bottom:4px">\u2192 Multi-exchange comparison tools</div>
            <div style="margin-bottom:4px">\u2192 Technical indicator signals</div>
          </div>
        </div>
        <p style="font-size:14px;color:${TEXT_MED};line-height:1.7;margin:0 0 16px">All of it. For <strong>KES 2,599/month ($19.9/mo)</strong>.</p>
        <div style="background:${BG_LIGHT};border-radius:10px;padding:18px;margin:0 0 20px">
          <div style="font-size:13px;color:${TEXT_MED};line-height:1.7">If you're not sure it's worth it — here's how to think about it: one better-informed investment decision per month, on a position of KES 50,000 (~$385), that earns you even 2% more than it would have without the intelligence? That's KES 1,000 (~$7.70) better than break-even on your subscription. Most Pro users make that case in the first week.</div>
        </div>
        <div style="background:linear-gradient(135deg,${BRAND_COLOR}15,${BRAND_COLOR}08);border:1px solid ${BRAND_COLOR}30;border-radius:10px;padding:18px 20px;margin:0 0 24px;text-align:center">
          <div style="font-size:14px;color:${TEXT_DARK};line-height:1.6">If African and global markets are part of how you're building wealth — StocksIntels Pro is the sharpest tool you can have in your corner.</div>
        </div>
        <div style="text-align:center;margin:0 0 20px">${ctaButton('UPGRADE TO PRO \u2192 KES 2,599/MONTH ($19.9/MO)', APP_URL + '/pricing')}</div>
        <div style="border-top:1px solid ${BORDER};padding-top:16px;margin-top:20px">
          <p style="font-size:13px;color:${TEXT_MED};line-height:1.6;margin:0">Here when you need it,</p>
          <p style="font-size:13px;color:${TEXT_MED};line-height:1.6;margin:4px 0 0"><strong>StocksIntels Team</strong></p>
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid ${BORDER};font-size:12px;color:${TEXT_LIGHT};line-height:1.5">
            P.S. If you have questions about what Pro includes, or want to talk through whether it's right for your investing style, just reply to this email. We read every reply.
          </div>
        </div>
      `),
    };
  },
};

async function enrollUserInCampaign(userId, campaignId) {
  const existing = await pool.query(
    'SELECT id FROM user_email_campaigns WHERE user_id = $1 AND campaign_id = $2',
    [userId, campaignId]
  );
  if (existing.rows.length > 0) return existing.rows[0].id;
  const result = await pool.query(
    'INSERT INTO user_email_campaigns (user_id, campaign_id) VALUES ($1, $2) RETURNING id',
    [userId, campaignId]
  );
  return result.rows[0].id;
}

async function sendStepEmail(userEmail, userName, step, userCampaignId) {
  const templateFn = TEMPLATES[step.template_name];
  if (!templateFn) {
    console.error(`[EMAIL SEQ] Unknown template: ${step.template_name}`);
    return false;
  }
  let data = null;
  if (step.template_name === 'onboarding_day14_conversion') {
    const mostWatched = await pool.query(
      `SELECT ticker, COUNT(*) as cnt FROM user_stock_views WHERE user_id = (
         SELECT user_id FROM user_email_campaigns WHERE id = $1
       ) GROUP BY ticker ORDER BY cnt DESC LIMIT 1`,
      [userCampaignId]
    );
    if (mostWatched.rows.length > 0) {
      data = { mostWatchedStock: mostWatched.rows[0].ticker };
    }
  }
  const { subject, html } = templateFn(userName, data);
  try {
    await sendViaTransport({ to: userEmail, subject, html, label: `Onboarding: ${step.template_name}` });
    await pool.query(
      'INSERT INTO user_email_steps (user_campaign_id, step_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userCampaignId, step.id]
    );
    console.log(`[EMAIL SEQ] Sent "${subject}" to ${userEmail}`);
    return true;
  } catch (err) {
    console.error(`[EMAIL SEQ] Failed to send "${subject}" to ${userEmail}:`, err.message);
    return false;
  }
}

async function processPendingEmails() {
  const steps = await pool.query(`
    SELECT uec.id as user_campaign_id, u.id as user_id, u.email, u.full_name,
           ecs.id as step_id, ecs.day_offset, ecs.template_name, ecs.subject,
           uec.started_at
    FROM user_email_campaigns uec
    JOIN users u ON u.id = uec.user_id
    JOIN email_campaign_steps ecs ON ecs.campaign_id = uec.campaign_id
    LEFT JOIN user_email_steps ues ON ues.user_campaign_id = uec.id AND ues.step_id = ecs.id
    WHERE uec.completed_at IS NULL
      AND ues.id IS NULL
      AND (uec.started_at + (ecs.day_offset || ' days')::interval) <= NOW()
      AND ecs.is_active = true
  `);
  for (const row of steps.rows) {
    await sendStepEmail(row.email, row.full_name, row, row.user_campaign_id);
  }
  return steps.rows.length;
}

async function enrollUserInOnboarding(userId) {
  try {
    const campaign = await pool.query(
      'SELECT id FROM email_campaigns WHERE trigger_event = $1 AND is_active = $2 LIMIT 1',
      ['signup', true]
    );
    if (campaign.rows.length === 0) {
      console.log('[EMAIL SEQ] No active signup campaign found');
      return;
    }
    const ucId = await enrollUserInCampaign(userId, campaign.rows[0].id);
    const user = await pool.query('SELECT email, full_name FROM users WHERE id = $1', [userId]);
    if (!user.rows.length) return;
    const step1 = await pool.query(
      `SELECT * FROM email_campaign_steps WHERE campaign_id = $1 AND day_offset = 0 LIMIT 1`,
      [campaign.rows[0].id]
    );
    if (step1.rows.length > 0) {
      await sendStepEmail(user.rows[0].email, user.rows[0].full_name, step1.rows[0], ucId);
    }
  } catch (err) {
    console.error('[EMAIL SEQ] Error enrolling user in onboarding:', err.message);
  }
}

module.exports = {
  enrollUserInOnboarding,
  processPendingEmails,
  sendStepEmail,
  TEMPLATES,
};
