const fs = require('fs');
const text = fs.readFileSync('./test_kq.cjs', 'utf8');
// Extract text from the test file between backticks... let me just inline the full text
const fullText = `KENYA AIRWAYS PLC
SUMMARY AUDITED GROUP RESULTS
FOR THE YEAR ENDED 31 DECEMBER 2025
SUMMARY CONSOLIDATED STATEMENT OF PROFIT OR LOSS AND OTHER
COMPREHENSIVE INCOME
31December2025 31December 2024
KShs M KShsM

Totalincome 161,473 188,495
Total operating costs (167,080) (171,874)
Operating (loss)/profit (5,607) 16,621
Finance costs (12,399) (11,163)
Interest income 79 69
(Loss)/profit before income tax (17,927) 5,527
Income tax credit /(expense} 764 (95)
(Loss)/profit forthe year (17,163) 5,432
Other comprehensive income
items that may be reclassified subsequently to profit orloss
Foreign currency exchange gains on cashflow hedges - 10,554
Reclassification of foreign currency exchange gains te profit or loss 1,421 3,826
Items that will not be reclassified to profit orloss
Revaluation on land and building 1,928 -
Other comprehensive income for the year net of tax 3,349 14,380
Total comprehensive (loss)/income for the year (13,814) 19,812
(Loss)/profitfortheyearisattibutableto: yearis attrib ibutableto: - Be a 7
Owners of the company (17,134) 5,511
Non-controlling interest (29) (79)
Total comprehensive (loss)/income is attributable to:
Owners of the company (13,785) 19,891
Non-controlling interest (29) (79)
Total comprehensive (loss)/profitforthe year (13,814) 19,812
Basic (loss)/profit per share(KShs} (2.94) 0.95
Diluted (loss)/profit per share({KShs} (2.29) 0.74
SUMMARY CONSOLIDATED STATEMENT OF FINANCIAL POSITION
31December2025 31December2024
KShsM KShsM

Assets

Non-current assets 141,803 137,497

Current assets 41,425 41,607

EQUITY AND LIABILITIES

Capital and reserves

Share capital 5,824 5,824

Share premium 49,223 49,223

Convertible loan notes 9,630 9,630

Treasury shares (142) (142)

Reserves (196,562) (182,777)

Non-controlling interest (38) (9)

Liabilities

Non - current liabilities 182,372 177,914

Current liabilities 132,921 119,441`;

const lines = fullText.split('\n');

const METRIC_PATTERNS = {
  net_income: [
    /(?<!Equity\s+attributable\s+to\s+)\bequity\s+holders\s+of\s+the\s+parent[:\s]*\(?([\d,.]+)\)?/gi,
    /\bprofit\s+for\s+the\s+(?:period|year)[:\s]*\(?([\d,.]+)\)?/gi,
    /\bprofit\b[^a]*?after\s+tax[:\s]*\(?([\d,.]+)\)?/gi,
    /\bprofit\b[^a]*?after\s+exceptional\s+items[:\s]*\(?([\d,.]+)\)?/gi,
    /(?<!Other\s+comprehensive\s+)loss\s+for\s+the\s+(?:period|year)[:\s]*\(?([\d,.]+)\)?/gi,
    /\bnet\s+(?:profit|income|earnings)(?:\s+for\s+the\s+(?:period|year))?[:\s]*\(?([\d,.]+)\)?/gi,
    /\btotal\s+comprehensive\s+income[:\s]*\(?([\d,.]+)\)?/gi,
  ],
  total_liabilities: [
    /\btotal\s+liabilities[:\s]*\(?([\d,.]+)\)?/gi,
  ],
  total_assets: [
    /\btotal\s+assets[:\s]*\(?([\d,.]+)\)?/gi,
  ],
};

for (const [metric, patterns] of Object.entries(METRIC_PATTERNS)) {
  console.log('\n=== ' + metric + ' ===');
  const values = [];
  for (const p of patterns) {
    const re = new RegExp(p.source, 'i');
    for (const line of lines) {
      const m = line.match(re);
      if (m) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (!isNaN(val)) {
          values.push(val);
          console.log('  MATCH line="' + line + '" -> val=' + val);
        }
      }
    }
  }
  if (values.length > 0) {
    console.log('  VALUES:', values, 'MAX:', Math.max(...values));
  } else {
    console.log('  NO MATCHES');
  }
}
