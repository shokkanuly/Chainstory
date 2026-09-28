// The testnet scripts deploy the committed demo artifacts; they must be what
// contracts/evm/src/TripwireDemo.sol compiles to.
import { describe, expect, it } from 'vitest';
import committed from '../../../scripts/tripwire/testnet/contracts.artifact.js';
import { compileDemo } from '../compile.mjs';

describe('demo contract artifacts', () => {
  it('match a fresh compile of TripwireDemo.sol', () => {
    const fresh = compileDemo();
    expect(fresh.errors).toEqual([]);
    for (const [name, artifact] of Object.entries(fresh.artifacts ?? {})) {
      expect(committed[name as keyof typeof committed].bytecode, `stale ${name}: run node contracts/evm/compile.mjs`).toBe(
        (artifact as { bytecode: string }).bytecode
      );
    }
  });
});
