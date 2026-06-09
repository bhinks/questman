export const fmtMoney = (n: number, dp = 0): string =>
  (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { 
    minimumFractionDigits: dp, 
    maximumFractionDigits: dp 
  });

export const fmtMoneyC = (n: number): string => fmtMoney(n, 2);

export const fmtPct = (n: number, dp = 1): string => 
  (n > 0 ? '+' : '') + n.toFixed(dp) + '%';

export const fmtNum = (n: number): string => n.toLocaleString('en-US');