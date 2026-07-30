// src/components/ContractRiskModal.tsx
//
// Phase 2 UI — Preventive Risk Scanner & Contract Permission Explainer Modal (#3 & #14)

import { useState } from 'react';
import { analyzePreventiveTokenRisk, type TokenRiskAnalysis } from '../services/preventiveScamScanner';
import { explainContractPermissionRisk, type ContractPermissionRisk } from '../services/contractRiskExplainer';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function ContractRiskModal({ isOpen, onClose }: Props) {
  const [addressInput, setAddressInput] = useState('');
  const [tokenRisk, setTokenRisk] = useState<TokenRiskAnalysis | null>(null);
  const [contractRisk, setContractRisk] = useState<ContractPermissionRisk | null>(null);

  if (!isOpen) return null;

  const handleScan = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addressInput.trim()) return;

    const tRisk = analyzePreventiveTokenRisk(addressInput.trim());
    const cRisk = explainContractPermissionRisk(addressInput.trim());

    setTokenRisk(tRisk);
    setContractRisk(cRisk);
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
              <p className="text-xs text-slate-400">Phase 2 — Explain what a contract can do to your wallet in plain English before approving.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition">
            ✕
          </button>
        </div>

        {/* Form & Results Body */}
        <div className="p-6 space-y-6 max-h-[78vh] overflow-y-auto">
          
          <form onSubmit={handleScan} className="flex gap-2">
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
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-5 py-2.5 rounded-xl text-xs transition"
            >
              Scan Address
            </button>
          </form>

          {/* Quick Presets */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-slate-400 font-medium">Test Presets:</span>
            <button
              onClick={() => {
                const addr = '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad';
                setAddressInput(addr);
                setTokenRisk(analyzePreventiveTokenRisk(addr));
                setContractRisk(explainContractPermissionRisk(addr));
              }}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 font-mono"
            >
              Uniswap V3 (Immutable)
            </button>
            <button
              onClick={() => {
                const addr = '0xae7ab96520de3a18e5e111b5eaab095312d7fe84';
                setAddressInput(addr);
                setTokenRisk(analyzePreventiveTokenRisk(addr));
                setContractRisk(explainContractPermissionRisk(addr));
              }}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 font-mono"
            >
              Lido Staking (Proxy)
            </button>
            <button
              onClick={() => {
                const addr = '0x000000000000000000000000000000000000bad1';
                setAddressInput(addr);
                setTokenRisk(analyzePreventiveTokenRisk(addr));
                setContractRisk(explainContractPermissionRisk(addr));
              }}
              className="px-2.5 py-1 rounded-lg bg-red-950/60 hover:bg-red-900/60 text-red-300 font-mono border border-red-800/40"
            >
              Fake-USDC (Risky Token)
            </button>
          </div>

          {/* Results */}
          {tokenRisk && contractRisk && (
            <div className="space-y-4 pt-2">
              
              {/* Feature #3 Result: Token Scam Risk */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-800/40 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">Token &amp; Contract Safety (#3)</span>
                  <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full uppercase ${
                    tokenRisk.recommendation === 'safe'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  }`}>
                    {tokenRisk.recommendation}
                  </span>
                </div>
                <p className="text-xs text-white leading-relaxed font-medium">{tokenRisk.plainEnglishSummary}</p>
                {tokenRisk.warnings.length > 0 && (
                  <ul className="list-disc list-inside text-[11px] text-slate-400 space-y-0.5 pt-1">
                    {tokenRisk.warnings.map((w, idx) => <li key={idx}>{w}</li>)}
                  </ul>
                )}
              </div>

              {/* Feature #14 Result: Plain-English Permission Explanation */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-800/40 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">Contract Permissions &amp; Upgradeability (#14)</span>
                  <span className="text-xs font-mono text-slate-400">{contractRisk.proxyType}</span>
                </div>
                <p className="text-xs text-slate-200 leading-relaxed bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                  {contractRisk.plainEnglishExplanation}
                </p>
                <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                  <div className="p-2 bg-slate-900/40 rounded border border-slate-800 text-slate-300">
                    Upgradeable Code: <strong>{contractRisk.canUpgradeCode ? 'Yes (Proxy)' : 'No (Immutable)'}</strong>
                  </div>
                  <div className="p-2 bg-slate-900/40 rounded border border-slate-800 text-slate-300">
                    Admin Key Controlled: <strong>{contractRisk.hasAdminKey ? 'Yes' : 'No'}</strong>
                  </div>
                </div>
              </div>

            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-900 border-t border-slate-800 flex justify-between items-center text-xs text-slate-500">
          <span>Phase 2 Preventive Intelligence — Pre-Transaction Analysis</span>
          <button onClick={onClose} className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-lg transition">
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
