// server/checkPhrasing.ts
//
// The optional AI wording for "Check before you sign" (/check).
//
// The verdict and its reasons are computed in the browser by code
// (src/services/preSignCheck.ts). The model only rephrases them, and it is
// handed nothing it could get wrong: the client sends the badge and reason
// identifiers from a closed set, and the prompt is built here from the fixed
// phrases below. No addresses, amounts or on-chain strings reach the model
// (I5), and a reply containing a digit or an address is discarded, per the
// LLM rule in docs/06 §4, so the client keeps its deterministic text.

/** One phrase per reason id in src/services/preSignCheck.ts; a test pins the two lists together. */
export const CHECK_REASON_PHRASES: Record<string, string> = {
  invalid_target: 'The target is not a valid address, so nothing could be checked.',
  malformed_calldata: 'The transaction data could not be read.',
  unknown_function: 'It calls a function the check does not recognise.',
  flagged_address: 'An address involved appears on a phishing list.',
  allowance_revocation: 'It removes a spending permission.',
  allowance_limited: 'It grants a limited token spending permission.',
  unlimited_allowance: 'It grants an unlimited token spending permission.',
  spender_unchecked: 'The spender could not be checked.',
  spender_eoa: 'The spender is a plain wallet rather than an app contract.',
  spender_unverified: "The spender's source code is not published.",
  spender_fresh: 'The spender was deployed very recently.',
  spender_upgradeable: "The spender's code can be replaced by its owner.",
  spender_verified: 'The spender is a verified contract.',
  token_transfer: 'It sends tokens.',
  recipient_is_token: "The recipient is the token's own contract, where tokens are usually lost.",
  recipient_zero: 'The recipient is the zero address, where tokens are destroyed.',
  native_transfer: 'It sends ETH.',
  native_value: 'It also sends ETH.',
  target_no_code: 'There is no contract at the target address.',
  target_unchecked: 'The target contract could not be checked.',
  target_unverified: "The target contract's source code is not published.",
  target_fresh: 'The target contract was deployed very recently.',
  target_upgradeable: "The target contract's code can be replaced by its owner.",
  target_verified: 'The target is a verified contract.',
};

const VERDICTS: Record<string, string> = {
  green: 'GREEN: no risk signals were found.',
  yellow: 'YELLOW: something needs a closer look before signing.',
  red: 'RED: the user should not sign unless they are certain.',
};

const MAX_REASONS = 12;

/** The prompt, or null when the request is not a well-formed check. */
export function buildCheckPrompt(body: unknown): string | null {
  const { badge, reasons } = (body ?? {}) as { badge?: unknown; reasons?: unknown };
  if (typeof badge !== 'string' || !(badge in VERDICTS) || !Array.isArray(reasons)) return null;

  // Identifiers only: anything outside the closed set is dropped, never echoed.
  const findings = Array.from(new Set(reasons))
    .filter((r): r is string => typeof r === 'string' && Object.hasOwn(CHECK_REASON_PHRASES, r))
    .slice(0, MAX_REASONS)
    .map((r) => `- ${CHECK_REASON_PHRASES[r]}`);
  if (findings.length === 0) return null;

  return `Write one plain-English sentence (max 30 words) for a crypto wallet user who is about to sign a transaction.

A deterministic check has already reached its verdict. Keep that verdict; do not soften it, strengthen it, or add facts.
Verdict: ${VERDICTS[badge]}
Findings:
${findings.join('\n')}

Do not include any numbers, amounts, addresses or names. Output ONLY the sentence.`;
}

/** docs/06 §4: the model was given no numbers or addresses, so any in its reply were invented. */
export function acceptCheckPhrasing(text: string): boolean {
  return text.length > 0 && text.length <= 300 && !/[0-9]/.test(text) && !/0x/i.test(text);
}
