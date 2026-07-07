const text = `KENYA AIRWAYS PLC
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

const lines = text.split('\n');

const patterns = [
  { name: 'P1 equity_holders', re: /(?<!Equity\s+attributable\s+to\s+)\bequity\s+holders\s+of\s+the\s+parent[:\s]*\(?([\d,.]+)\)?/i },
  { name: 'P2 profit_for_year', re: /\bprofit\s+for\s+the\s+(?:period|year)[:\s]*\(?([\d,.]+)\)?/i },
  { name: 'P3 profit_after_tax', re: /\bprofit\b[^a]*?after\s+tax[:\s]*\(?([\d,.]+)\)?/i },
  { name: 'P4 profit_after_exceptional', re: /\bprofit\b[^a]*?after\s+exceptional\s+items[:\s]*\(?([\d,.]+)\)?/i },
  { name: 'P5 loss_for_year', re: /(?<!Other\s+comprehensive\s+)loss\s+for\s+the\s+(?:period|year)[:\s]*\(?([\d,.]+)\)?/i },
  { name: 'P6 net_profit', re: /\bnet\s+(?:profit|income|earnings)(?:\s+for\s+the\s+(?:period|year))?[:\s]*\(?([\d,.]+)\)?/i },
  { name: 'P7 total_comp_income', re: /\btotal\s+comprehensive\s+income[:\s]*\(?([\d,.]+)\)?/i },
];

for (const p of patterns) {
  let matchCount = 0;
  for (const line of lines) {
    const m = line.match(p.re);
    if (m) {
      matchCount++;
      console.log('[' + p.name + '] match: line="' + line + '"');
      console.log('           captured=["' + m[1] + '"] full=["' + m[0] + '"]');
    }
  }
  if (matchCount === 0) {
    console.log('[' + p.name + '] no match');
  }
}
