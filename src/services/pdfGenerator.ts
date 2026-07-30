// src/services/pdfGenerator.ts
//
// Formatted PDF & Printable Tax Report Generator (IRS Form 8949 format).
// Generates official-styled PDF tax reports with summary totals, asset details, and capital gain/loss schedules.

import type { FifoAccountingReport } from '../types';

export function generatePdfTaxReport(report: FifoAccountingReport): void {
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups to export the PDF Tax Report.');
    return;
  }

  const realizedRowsHtml = report.realizedTransactions.length > 0
    ? report.realizedTransactions
        .map(
          (tx, idx) => `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 8px; font-family: monospace; font-size: 11px;">${tx.txHash.slice(0, 10)}...${tx.txHash.slice(-6)}</td>
          <td style="padding: 8px; font-weight: 600;">${tx.assetSymbol}</td>
          <td style="padding: 8px;">${tx.disposedDate.toISOString().split('T')[0]}</td>
          <td style="padding: 8px; text-align: right;">${tx.amountDisposed.toFixed(6)}</td>
          <td style="padding: 8px; text-align: right;">$${tx.proceedsUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td style="padding: 8px; text-align: right;">$${tx.costBasisUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td style="padding: 8px; text-align: right; font-weight: 600; color: ${tx.gainLossUsd >= 0 ? '#10b981' : '#ef4444'};">
            ${tx.gainLossUsd >= 0 ? '+' : ''}$${tx.gainLossUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </td>
          <td style="padding: 8px; text-align: center; font-size: 11px;">
            ${tx.holdingPeriod === 'long_term' ? 'Long-Term (>1yr)' : 'Short-Term (≤1yr)'}
          </td>
        </tr>
      `
        )
        .join('')
    : `
      <tr>
        <td colspan="8" style="padding: 24px; text-align: center; color: #64748b;">
          No taxable capital gain/loss disposals recorded for this period.
        </td>
      </tr>
    `;

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>ChainStory Tax Report — ${report.walletAddress.slice(0, 8)}</title>      <style>
        @media print {
          body { font-size: 12pt; }
          .no-print { display: none; }
          @page { margin: 1.5cm; }
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          color: #0f172a;
          line-height: 1.5;
          margin: 0;
          padding: 24px;
          background: #ffffff;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 2px solid #0f172a;
          padding-bottom: 16px;
          margin-bottom: 24px;
        }
        .logo { font-size: 24px; font-weight: 800; color: #6366f1; letter-spacing: -0.5px; }
        .subtitle { font-size: 13px; color: #64748b; margin-top: 2px; }
        .summary-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 32px;
        }
        .summary-card {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 16px;
        }
        .card-label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700; }
        .card-value { font-size: 20px; font-weight: 800; margin-top: 4px; }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 16px;
          font-size: 12px;
        }
        th {
          background: #f1f5f9;
          text-align: left;
          padding: 10px 8px;
          font-size: 11px;
          text-transform: uppercase;
          color: #475569;
          border-bottom: 2px solid #cbd5e1;
        }
        .footer {
          margin-top: 40px;
          padding-top: 16px;
          border-top: 1px solid #e2e8f0;
          font-size: 11px;
          color: #94a3b8;
          display: flex;
          justify-content: space-between;
        }
        .btn-print {
          background: #6366f1;
          color: #ffffff;
          border: none;
          padding: 10px 20px;
          font-weight: 600;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
        }
      </style>
    </head>
    <body>
      <div class="no-print" style="margin-bottom: 20px; text-align: right;">
        <button class="btn-print" onclick="window.print()">Print / Save as PDF</button>
      </div>

      <div class="header">
        <div>
          <div class="logo">⚡ ChainStory</div>
          <div class="subtitle">DRAFT Form 8949 / Schedule D Capital Gains Estimate</div>
        </div>
        <div style="text-align: right;">
          <div style="font-weight: 700; font-size: 14px;">Date: ${dateStr}</div>
          <div style="font-size: 12px; color: #64748b; font-family: monospace;">
            Wallet: ${report.walletAddress}
          </div>
        </div>
      </div>

      <div style="background: #fffbe6; border: 1px solid #ffe58f; padding: 10px 14px; border-radius: 6px; font-size: 11px; color: #873800; margin-bottom: 20px; line-height: 1.4;">
        <strong>Disclaimer:</strong> This report is a <strong>DRAFT estimate</strong> generated by ChainStory for informational purposes to review with a qualified CPA or tax professional. It is not an official tax filing or formal tax advice.
      </div>

      <div class="summary-grid">
        <div class="summary-card">
          <div class="card-label">Total Proceeds</div>
          <div class="card-value">$${report.totalProceedsUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>
        <div class="summary-card">
          <div class="card-label">Total Cost Basis</div>
          <div class="card-value">$${report.totalCostBasisUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>
        <div class="summary-card">
          <div class="card-label">Gas Expenses</div>
          <div class="card-value">$${report.totalGasExpenseUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>
        <div class="summary-card" style="background: ${report.netCapitalGainLossUsd >= 0 ? '#ecfdf5' : '#fef2f2'}; border-color: ${report.netCapitalGainLossUsd >= 0 ? '#a7f3d0' : '#fecaca'};">
          <div class="card-label" style="color: ${report.netCapitalGainLossUsd >= 0 ? '#047857' : '#b91c1c'};">Net Capital Gain / Loss</div>
          <div class="card-value" style="color: ${report.netCapitalGainLossUsd >= 0 ? '#047857' : '#b91c1c'};">
            ${report.netCapitalGainLossUsd >= 0 ? '+' : ''}$${report.netCapitalGainLossUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 8px;">Schedule D / Form 8949 Disposals Breakdown</h3>
      <table>
        <thead>
          <tr>
            <th>Tx Hash</th>
            <th>Asset</th>
            <th>Disposed Date</th>
            <th style="text-align: right;">Amount</th>
            <th style="text-align: right;">Proceeds (USD)</th>
            <th style="text-align: right;">Cost Basis (USD)</th>
            <th style="text-align: right;">Gain / Loss</th>
            <th style="text-align: center;">Holding Period</th>
          </tr>
        </thead>
        <tbody>
          ${realizedRowsHtml}
        </tbody>
      </table>

      <div class="footer">
        <div>Generated by ChainStory AI Crypto Accounting Engine (FIFO)</div>
        <div>Page 1 of 1</div>
      </div>

      <script>
        window.onload = function() {
          setTimeout(() => {
            window.print();
          }, 300);
        };
      </script>
    </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(htmlContent);
  printWindow.document.close();
}
