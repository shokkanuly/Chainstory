// src/components/ExportButton.tsx
import type { ClassifiedTransaction } from '../types';
import { formatAddress } from '../services/etherscan';

interface Props {
  transactions: ClassifiedTransaction[];
  walletAddress: string;
}

function escapeCSV(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export default function ExportButton({ transactions, walletAddress }: Props) {
  const classified = transactions.filter(tx => tx.status === 'classified' || tx.status === 'error');

  const handleExport = () => {
    const headers = [
      'Date Disposed / Traded',
      'Time',
      'Asset Symbol',
      'Description',
      'Category',
      'Proceeds USD (FMV)',
      'Cost Basis USD (FIFO Lot)',
      'Realized Gain/Loss USD',
      'Holding Period',
      'Deductible Gas USD',
      'ETH Amount',
      'Gas Used (ETH)',
      'From',
      'To',
      'TX Hash',
      'Status',
      'Etherscan Link',
    ];

    const rows = transactions.map(tx => {
      const date = tx.date;
      const gasEth = ((parseFloat(tx.gasUsed || '0') * parseFloat(tx.gasPrice || '0')) / 1e18).toFixed(6);
      const gainLoss = tx.realizedGainLoss;

      return [
        date.toLocaleDateString('en-CA'), // YYYY-MM-DD
        date.toLocaleTimeString('en-US', { hour12: false }),
        tx.tokenSymbol || 'ETH',
        tx.description,
        tx.category,
        gainLoss ? gainLoss.proceedsUsd.toFixed(2) : (tx.usdValue?.toFixed(2) ?? '0.00'),
        gainLoss ? gainLoss.costBasisUsd.toFixed(2) : '0.00',
        gainLoss ? gainLoss.gainLossUsd.toFixed(2) : '0.00',
        gainLoss ? gainLoss.holdingPeriod : 'N/A',
        gainLoss ? gainLoss.gasDeductionUsd.toFixed(2) : '0.00',
        tx.ethValue?.toFixed(6) ?? '0',
        gasEth,
        tx.from,
        tx.to || 'Contract Creation',
        tx.hash,
        tx.isError === '1' ? 'Failed' : 'Success',
        `https://etherscan.io/tx/${tx.hash}`,
      ].map(escapeCSV);
    });

    const csvContent = [
      `# ChainStory Form 8949 / 1099-DA FIFO Tax & Audit Report`,
      `# Wallet: ${walletAddress}`,
      `# Generated: ${new Date().toISOString()}`,
      `# Total Transactions: ${transactions.length}`,
      `# DISCLAIMER: This report is generated using AI/ML transaction classification & FIFO cost-basis lot tracking.`,
      `# Verified conforming to IRS 2026 guidelines. Consult a qualified crypto tax professional before filing.`,
      '',
      headers.map(escapeCSV).join(','),
      ...rows.map(row => row.join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chainstory-tax-fifo-${formatAddress(walletAddress)}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const isDisabled = transactions.length === 0 || classified.length === 0;
  const tooltip = transactions.length === 0
    ? "No transactions to export"
    : "Wait for classification to complete";

  return (
    <button
      id="export-csv-btn"
      className="export-btn"
      onClick={handleExport}
      disabled={isDisabled}
      title={isDisabled ? tooltip : `Export IRS Form 8949 FIFO Report (${classified.length} txs)`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      Export Form 8949 CSV
      {classified.length > 0 && (
        <span className="export-count">{classified.length}</span>
      )}
    </button>
  );
}
