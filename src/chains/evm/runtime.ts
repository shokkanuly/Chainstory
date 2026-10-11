// Exact solc deployed-runtime reconstruction, including every immutable word.
import { keccak256, size, type Hex } from 'viem';
import { z } from 'zod';

export const evmCodeSchema = z.string().regex(/^0x([0-9a-fA-F]{2})*$/).max(2 + 24576 * 2).transform((s) => s.toLowerCase() as Hex);
const word = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((s) => s.toLowerCase() as Hex);
const runtimeSchema = z.object({ creationHash: word, template: evmCodeSchema.refine((s) => s !== '0x'),
  references: z.array(z.object({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    positions: z.array(z.object({ start: z.number().int().nonnegative(), length: z.literal(32) }).strict()).min(1).max(256),
  }).strict()).min(1).max(64),
}).strict();
export function reconstructRuntime(input: unknown, values: Readonly<Record<string, Hex>>): Hex {
  const artifact = runtimeSchema.parse(input), covered = new Set<number>(), names = new Set<string>();
  let code = artifact.template;
  for (const reference of artifact.references) {
    if (names.has(reference.name)) throw new Error('Duplicate immutable declaration.');
    names.add(reference.name);
    const value = word.parse(values[reference.name]); // Unknown compiler immutables cannot be skipped.
    for (const position of reference.positions) {
      if (position.start + position.length > size(code)) throw new Error('Immutable reference exceeds runtime.');
      for (let i = position.start; i < position.start + position.length; i++) {
        if (covered.has(i)) throw new Error('Overlapping immutable runtime references.'); covered.add(i);
      }
      const start = 2 + position.start * 2, end = start + position.length * 2;
      if (!/^0{64}$/.test(artifact.template.slice(start, end))) throw new Error('Immutable template word is not empty.');
      code = `0x${code.slice(2, start)}${value.slice(2)}${code.slice(end)}`;
    }
  }
  return code;
}
export function assertRuntime(actual: unknown, expected: Hex) {
  const code = evmCodeSchema.parse(actual);
  if (code !== expected.toLowerCase()) throw new Error('Deployed bytecode differs from the compiled runtime and immutable bindings.');
  return { runtimeHash: keccak256(code), runtimeBytes: size(code) };
}
