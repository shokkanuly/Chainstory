// AI descriptions are opt-in (docs/06 §2). These pin the promise the switch
// makes: off by default, nothing sent while off, and full addresses never sent.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDescribePayload, isAiDescriptionsEnabled, setAiDescriptionsEnabled, shortAddress } from '../aiDescriptions';
import { generateDescription } from '../descriptionGenerator';
import { rawTx } from './factories';

const FROM = '0xd8da6bf26964af9ded7ede3308c4157ed3714123';
const TO = '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('AI descriptions, opt-in', () => {
  it('is off by default, and off when storage is blocked', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    expect(isAiDescriptionsEnabled()).toBe(false);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); } });
    expect(isAiDescriptionsEnabled()).toBe(false);
  });

  it('sends nothing while off', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const text = await generateDescription(rawTx({ from: FROM, to: TO, value: '1000000000000000000' }), 'transfer', 1, 3400);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(text).toContain('1.0000 ETH');
  });

  it('when on, sends one request with shortened addresses only', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    setAiDescriptionsEnabled(true);
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ description: 'Sent 1 ETH to a friend.' }) }));
    vi.stubGlobal('fetch', fetchSpy);

    const text = await generateDescription(rawTx({ from: FROM, to: TO }), 'transfer', 1, 3400);
    expect(text).toBe('Sent 1 ETH to a friend.');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = String((fetchSpy.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toContain('"from":"0xd8da…4123"');
    expect(body).not.toContain(FROM);
    expect(body).not.toContain(TO);
  });

  it('switching off again stops the requests', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    setAiDescriptionsEnabled(true);
    setAiDescriptionsEnabled(false);
    expect(isAiDescriptionsEnabled()).toBe(false);
  });

  it('shortens only real addresses', () => {
    expect(shortAddress(FROM)).toBe('0xd8da…4123');
    expect(shortAddress('vitalik.eth')).toBeUndefined();
    expect(shortAddress(undefined)).toBeUndefined();
    expect(buildDescribePayload(rawTx({ from: FROM, to: '' }), 'trade', 0, null).to).toBeUndefined();
  });
});
