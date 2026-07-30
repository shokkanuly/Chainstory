import type { ClassifiedTransaction } from '../types';
import { formatAddress } from '../services/etherscan';
import { calculateFifoTaxReport } from '../services/fifoEngine';
import { generatePdfTaxReport } from '../services/pdfGenerator';

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

  const handleExportCSV = () => {
    const headers = [
      'Date',
      'Time',
      'Description',
      'Category',
      'USD Value (at time)',
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

      return [
        date.toLocaleDateString('en-CA'), // YYYY-MM-DD
        date.toLocaleTimeString('en-US', { hour12: false }),
        tx.description,
        tx.category,
        tx.usdValue?.toFixed(2) ?? '0.00',
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
      `# ChainStory Tax Report`,
      `# Wallet: ${walletAddress}`,
      `# Generated: ${new Date().toISOString()}`,
      `# Transactions: ${transactions.length}`,
      '',
      headers.map(escapeCSV).join(','),
      ...rows.map(row => row.join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chainstory-${formatAddress(walletAddress)}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportPDF = () => {
    const report = calculateFifoTaxReport(classified, walletAddress);
    generatePdfTaxReport(report);
  };

  const isDisabled = transactions.length === 0 || classified.length === 0;
  const tooltip = transactions.length === 0
    ? "No transactions to export"
    : "Wait for classification to complete";

  return (
    <div className="flex items-center gap-2">
      <button
        id="export-csv-btn"
        className="export-btn"
        onClick={handleExportCSV}
        disabled={isDisabled}
        title={isDisabled ? tooltip : `Export ${classified.length} transactions as CSV`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        CSV Export
        {classified.length > 0 && (
          <span className="export-count">{classified.length}</span>
        )}
      </button>

      <button
        id="export-pdf-btn"
        className="export-btn export-pdf-btn"
        onClick={handleExportPDF}
        disabled={isDisabled}
        title={isDisabled ? tooltip : `Export PDF Tax Report (IRS Form 8949)`}
        style={{
          background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
          color: '#ffffff',
          border: 'none',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
        PDF Tax Report
      </button>
    </div>
  );
}
