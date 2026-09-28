// Types for the parts of compile.mjs the TypeScript scripts import.
export declare const SOLC_SETTINGS: { optimizer: { enabled: boolean; runs: number }; evmVersion: string };
export declare function solcVersion(): string;
export declare function standardJsonInput(entry: string): {
  language: 'Solidity';
  sources: Record<string, { content: string }>;
  settings: Record<string, unknown>;
};
