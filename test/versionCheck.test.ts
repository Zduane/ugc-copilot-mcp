import { describe, expect, it, vi } from 'vitest';
import { checkForNewerVersion, isNewer } from '../src/versionCheck.js';

describe('isNewer (semver compare)', () => {
  it('returns false for identical versions', () => {
    expect(isNewer('0.1.1', '0.1.1')).toBe(false);
  });

  it('returns true when latest is strictly newer at any segment', () => {
    expect(isNewer('0.1.1', '0.1.2')).toBe(true);
    expect(isNewer('0.1.1', '0.2.0')).toBe(true);
    expect(isNewer('0.1.1', '1.0.0')).toBe(true);
    expect(isNewer('1.2.3', '1.2.4')).toBe(true);
  });

  it('returns false when current is newer (e.g. local dev build)', () => {
    expect(isNewer('0.2.0', '0.1.5')).toBe(false);
    expect(isNewer('1.0.0', '0.9.99')).toBe(false);
  });

  it('handles missing trailing segments as zero', () => {
    expect(isNewer('1.0', '1.0.1')).toBe(true);
    expect(isNewer('1.0.1', '1.0')).toBe(false);
  });

  it('returns false on unparseable input rather than throwing', () => {
    expect(isNewer('garbage', '0.1.1')).toBe(false);
    expect(isNewer('0.1.1', 'garbage')).toBe(false);
  });
});

describe('checkForNewerVersion', () => {
  it('logs an upgrade hint when registry returns a newer version', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: '0.1.2', name: '@ugccopilot/mcp' }), { status: 200 }),
    );
    const logged: string[] = [];
    const result = await checkForNewerVersion('0.1.1', {
      fetch: fetchMock as unknown as typeof fetch,
      log: (m) => logged.push(m),
    });
    expect(result.checked).toBe(true);
    expect(result.latest).toBe('0.1.2');
    expect(result.isNewer).toBe(true);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('0.1.2 available');
    expect(logged[0]).toContain('rm -rf ~/.npm/_npx');
  });

  it('does NOT log when current matches latest', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: '0.1.2' }), { status: 200 }),
    );
    const logged: string[] = [];
    const result = await checkForNewerVersion('0.1.2', {
      fetch: fetchMock as unknown as typeof fetch,
      log: (m) => logged.push(m),
    });
    expect(result.isNewer).toBe(false);
    expect(logged).toHaveLength(0);
  });

  it('returns { checked: false } silently on network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    const logged: string[] = [];
    const result = await checkForNewerVersion('0.1.1', {
      fetch: fetchMock as unknown as typeof fetch,
      log: (m) => logged.push(m),
    });
    expect(result.checked).toBe(false);
    expect(logged).toHaveLength(0); // failure must be silent — never break startup
  });

  it('returns { checked: false } on non-200 response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 500 }));
    const logged: string[] = [];
    const result = await checkForNewerVersion('0.1.1', {
      fetch: fetchMock as unknown as typeof fetch,
      log: (m) => logged.push(m),
    });
    expect(result.checked).toBe(false);
    expect(logged).toHaveLength(0);
  });

  it('returns { checked: false } on malformed body (no version field)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ unrelated: 'thing' }), { status: 200 }));
    const result = await checkForNewerVersion('0.1.1', {
      fetch: fetchMock as unknown as typeof fetch,
      log: () => {},
    });
    expect(result.checked).toBe(false);
  });
});
