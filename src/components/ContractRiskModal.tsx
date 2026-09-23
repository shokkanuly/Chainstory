// src/components/ContractRiskModal.tsx
//
// Preventive Risk Scanner & Contract Permission Explainer.
//
// Both services now hit the block explorer, so this is async and has real
// loading and failure states. Tri-state values (true / false / unknown) are
// rendered as three distinct states — an unknown must never be drawn as a
// reassuring "No".

import { useState } from 'react';
import { analyzePreventiveTokenRisk, type TokenRiskAnalysis } from '../services/preventiveScamScanner';
import { explainContractPermissionRisk, type ContractPermissionRisk } from '../services/contractRiskExplainer';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const PRESETS = [
  { label: 'Uniswap V3 Router', addr: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', tone: 'neutral' },
  { label: 'Lido stETH (Proxy)', addr: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84', tone: 'neutral' },
  { label: 'Known Phishing Token', addr: '0x000000000000000000000000000000000000bad1', tone: 'danger' },
] as const;

const RECOMMENDATION_STYLES: Record<TokenRiskAnalysis['recommendation'], string> = {
  safe: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  caution: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
  high_risk: 'bg-red-500/10 text-red-400 border border-red-500/20',
  unknown: 'bg-slate-500/10 text-slate-400 border border-slate-500/20',
};

/** Render a tri-state capability without collapsing unknown into "No". */
function TriState({ label, value }: { label: string; value: boolean | null }) {
  const text = value === null ? 'Unknown' : value ? 'Yes' : 'No';
  const tone =
    value === null ? 'text-slate-400' : value ? 'text-amber-300' : 'text-emerald-300';
  return (
    <div className="p-2 bg-slate-900/40 rounded border border-slate-800 text-slate-300">
      {label}: <strong className={tone}>{text}</strong>
    </div>
  );
}

export default function ContractRiskModal({ isOpen, onClose }: Props) {
  const [addressInput, setAddressInput] = useState('');
  const [tokenRisk, setTokenRisk] = useState<TokenRiskAnalysis | null>(null);
  const [contractRisk, setContractRisk] = useState<ContractPermissionRisk | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  if (!isOpen) return null;

  const runScan = async (addr: string) => {
    const target = addr.trim();
    if (!target) return;

    setAddressInput(target);
    setIsScanning(true);
    setScanError(null);
    setTokenRisk(null);
    setContractRisk(null);

    try {
      const [tRisk, cRisk] = await Promise.all([
        analyzePreventiveTokenRisk(target),
        explainContractPermissionRisk(target),
      ]);
      setTokenRisk(tRisk);
      setContractRisk(cRisk);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'The scan could not be completed.');
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden text-slate-100 animate-in fade-in zoom-in duration-200">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🛡️</span>
            <div>
              <h2 className="text-base font-bold text-white">Preventive Risk &amp; Contract Explainer</h2>
              <p className="text-xs text-slate-400">
                Reads verification status, deployment age and admin powers from the block explorer.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition">
            ✕
          </button>
        </div>

        {/* Form & Results Body */}
        <div className="p-6 space-y-6 max-h-[78vh] overflow-y-auto">

          <form
            onSubmit={(e) => { e.preventDefault(); void runScan(addressInput); }}
            className="flex gap-2"
          >
            <input
              type="text"
              placeholder="Paste token or contract address (0x...)"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-indigo-500 text-white"
              required
            />
            <button
              type="submit"
              disabled={isScanning}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-5 py-2.5 rounded-xl text-xs transition"
            >
              {isScanning ? 'Scanning…' : 'Scan Address'}
            </button>
          </form>

          {/* Quick Presets */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-slate-400 font-medium">Test Presets:</span>
            {PRESETS.map((preset) => (
              <button
                key={preset.addr}
                onClick={() => void runScan(preset.addr)}
                disabled={isScanning}
                className={
                  preset.tone === 'danger'
                    ? 'px-2.5 py-1 rounded-lg bg-red-950/60 hover:bg-red-900/60 text-red-300 font-mono border border-red-800/40 disabled:opacity-50'
                    : 'px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 font-mono disabled:opacity-50'
                }
              >
                {preset.label}
              </button>
            ))}
          </div>

          {isScanning && (
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-800/40 text-xs text-slate-400 animate-pulse">
              Querying the block explorer for verification status, deployment date and ABI…
            </div>
          )}

          {scanError && (
            <div className="p-4 rounded-xl border border-red-800/40 bg-red-950/40 text-xs text-red-300">
              {scanError}
            </div>
          )}

          {/* Results */}
          {!isScanning && tokenRisk && contractRisk && (
            <div className="space-y-4 pt-2">

              {/* Token / contract safety */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-800/40 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">Token &amp; Contract Safety</span>
                  <div className="flex items-center gap-2">
                    {tokenRisk.riskScore !== null && (
                      <span className="text-[11px] font-mono text-slate-400">score {tokenRisk.riskScore}/100</span>
                    )}
                    <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full uppercase ${RECOMMENDATION_STYLES[tokenRisk.recommendation]}`}>
                      {tokenRisk.recommendation.replace('_', ' ')}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-white leading-relaxed font-medium">{tokenRisk.plainEnglishSummary}</p>
                {tokenRisk.warnings.length > 0 && (
                  <ul className="list-disc list-inside text-[11px] text-slate-400 space-y-0.5 pt-1">
                    {tokenRisk.warnings.map((w, idx) => <li key={idx}>{w}</li>)}
                  </ul>
                )}
              </div>

              {/* Permissions & upgradeability */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-800/40 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">Contract Permissions &amp; Upgradeability</span>
                  <span className="text-xs font-mono text-slate-400">{contractRisk.proxyType}</span>
                </div>
                <p className="text-xs text-slate-200 leading-relaxed bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                  {contractRisk.plainEnglishExplanation}
                </p>
                <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                  <TriState label="Upgradeable code" value={contractRisk.canUpgradeCode} />
                  <TriState label="Owner / admin role" value={contractRisk.hasAdminKey} />
                  <TriState label="Can pause transfers" value={contractRisk.canPauseTransfers} />
                  <TriState label="Can mint supply" value={contractRisk.canMintTokens} />
                </div>
                {contractRisk.implementationAddress && (
                  <div className="text-[11px] text-slate-400 font-mono pt-1">
                    Implementation: <span className="text-slate-300">{contractRisk.implementationAddress}</span>
                  </div>
                )}
                {contractRisk.evidence.length > 0 && (
                  <div className="text-[11px] text-slate-500 pt-1">
                    From the verified ABI: <span className="font-mono text-slate-400">{contractRisk.evidence.join(', ')}</span>
                  </div>
                )}
              </div>

              <div className="text-[11px] text-slate-500 bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/60 leading-relaxed">
                <strong>Notice:</strong> This reads published metadata and the verified ABI. It is not a
                security audit, it does not analyse contract logic, and a low score is not a guarantee of
                safety. &ldquo;Unknown&rdquo; means we could not determine the answer — not that the answer is no.
              </div>

            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-900 border-t border-slate-800 flex justify-between items-center text-xs text-slate-500">
          <span>Pre-transaction analysis — read-only</span>
          <button onClick={onClose} className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-lg transition">
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
