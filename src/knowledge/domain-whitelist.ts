export interface DomainWhitelistOptions {
  additionalRules?: DomainRule[];
}

export interface DomainDecision {
  allowed: boolean;
  reason?: string;
}

export type DomainRule =
  | { type: 'exact'; value: string }
  | { type: 'suffix'; value: string };

const DEFAULT_RULES: DomainRule[] = [
  { type: 'exact', value: 'github.com' },
  { type: 'suffix', value: '.github.com' },
  { type: 'exact', value: 'stackoverflow.com' },
  { type: 'suffix', value: '.stackoverflow.com' },
  { type: 'exact', value: 'developer.mozilla.org' },
  { type: 'exact', value: 'react.dev' },
  { type: 'suffix', value: '.react.dev' },
  { type: 'exact', value: 'playwright.dev' },
  { type: 'suffix', value: '.playwright.dev' },
  { type: 'exact', value: 'typescriptlang.org' },
  { type: 'suffix', value: '.typescriptlang.org' },
  { type: 'exact', value: 'nodejs.org' },
  { type: 'suffix', value: '.nodejs.org' },
];

export class DomainWhitelist {
  private readonly rules: DomainRule[];

  constructor(options: DomainWhitelistOptions = {}) {
    this.rules = [
      ...DEFAULT_RULES,
      ...(options.additionalRules ?? []),
    ].map(normalizeRule).filter((rule): rule is DomainRule => rule !== null);
  }

  check(url: string): DomainDecision {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { allowed: false, reason: 'URL 格式无效' };
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { allowed: false, reason: '仅允许 http/https URL' };
    }

    const host = parsed.hostname.toLowerCase();
    if (isPrivateOrLocalHost(host)) {
      return {
        allowed: false,
        reason: `域名 ${host} 是本地或私有地址，Playwright 读取已拒绝`,
      };
    }

    const matched = this.rules.some((rule) => matchesRule(host, rule));
    if (!matched) {
      return {
        allowed: false,
        reason: `域名 ${host} 不在 Playwright 读取白名单中`,
      };
    }

    return { allowed: true };
  }

  isAllowed(url: string): boolean {
    return this.check(url).allowed;
  }
}

export function parseProjectRulesWhitelist(content: string): DomainRule[] {
  const lines = content.split(/\r?\n/);
  const rules: DomainRule[] = [];
  let inSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const section = /^\[([^\]]+)\]$/.exec(line);
    if (section) {
      inSection = section[1] === 'playwright-whitelist';
      continue;
    }

    if (!inSection) {
      continue;
    }

    const rule = parseRule(line.replace(/^-+\s*/, '').trim());
    if (rule) {
      rules.push(rule);
    }
  }

  return rules;
}

function matchesRule(host: string, rule: DomainRule): boolean {
  return rule.type === 'exact'
    ? host === rule.value
    : host.endsWith(rule.value);
}

function parseRule(value: string): DomainRule | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith('exact:')) {
    return { type: 'exact', value: normalized.slice('exact:'.length).trim() };
  }

  if (normalized.startsWith('suffix:')) {
    const suffix = normalized.slice('suffix:'.length).trim();
    return suffix.startsWith('.') ? { type: 'suffix', value: suffix } : null;
  }

  return { type: 'exact', value: normalized };
}

function normalizeRule(rule: DomainRule): DomainRule | null {
  return parseRule(`${rule.type}:${rule.value}`);
}

function isPrivateOrLocalHost(host: string): boolean {
  return (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host === '0.0.0.0'
    || host.startsWith('127.')
    || host === '::1'
    || isPrivateIpv4(host)
    || isPrivateIpv6(host)
  );
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return false;
  }

  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 169 && second === 254)
  );
}

function isPrivateIpv6(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb');
}
