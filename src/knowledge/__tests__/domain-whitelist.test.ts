import { describe, it, expect } from 'vitest';
import { DomainWhitelist, parseProjectRulesWhitelist } from '../domain-whitelist.js';

describe('DomainWhitelist', () => {
  it('允许默认文档域名模式', () => {
    const whitelist = new DomainWhitelist();

    expect(whitelist.isAllowed('https://github.com/badlogic/pi-mono')).toBe(true);
    expect(whitelist.isAllowed('https://developer.mozilla.org/en-US/docs')).toBe(true);
    expect(whitelist.isAllowed('https://docs.github.com/actions')).toBe(true);
  });

  it('拒绝非白名单域名和非 http 协议', () => {
    const whitelist = new DomainWhitelist();

    expect(whitelist.check('https://example.com').allowed).toBe(false);
    expect(whitelist.check('file:///tmp/a.html').allowed).toBe(false);
  });

  it('拒绝 localhost、loopback 和 private IP', () => {
    const whitelist = new DomainWhitelist({
      additionalRules: [
        { type: 'exact', value: 'localhost' },
        { type: 'exact', value: '127.0.0.1' },
        { type: 'exact', value: '192.168.1.10' },
      ],
    });

    expect(whitelist.check('http://localhost:3000').allowed).toBe(false);
    expect(whitelist.check('http://127.0.0.1:3000').allowed).toBe(false);
    expect(whitelist.check('http://192.168.1.10').allowed).toBe(false);
    expect(whitelist.check('http://docs.localhost').allowed).toBe(false);
    expect(whitelist.check('http://[fc00::1]').allowed).toBe(false);
    expect(whitelist.check('http://[fd12::34]').allowed).toBe(false);
    expect(whitelist.check('http://[fe80::1]').allowed).toBe(false);
  });

  it('解析 project-rules 的 playwright-whitelist section', () => {
    const rules = parseProjectRulesWhitelist([
      '[other]',
      '- ignored.example',
      '[playwright-whitelist]',
      '- exact:docs.example.com',
      'suffix:.example.org',
      '[next-section]',
      '- ignored-again.example',
    ].join('\n'));

    expect(rules).toEqual([
      { type: 'exact', value: 'docs.example.com' },
      { type: 'suffix', value: '.example.org' },
    ]);
    const whitelist = new DomainWhitelist({ additionalRules: rules });
    expect(whitelist.isAllowed('https://docs.example.com')).toBe(true);
    expect(whitelist.isAllowed('https://api.example.org')).toBe(true);
  });
});
