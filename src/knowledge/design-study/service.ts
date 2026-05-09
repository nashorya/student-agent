import { DesignMemoryManager } from '../../memory/design/manager.js';
import type { DesignCandidate, DesignCritique, DesignExtractionResult, StyleProfile } from '../../memory/design/types.js';
import type { CandidateBreakerReport } from '../../memory/candidates/types.js';
import { DembrandtExtractor } from './dembrandt-extractor.js';
import { NativePlaywrightExtractor } from './native-playwright-extractor.js';
import type { DesignExtractor, DesignStudyRunRequest, VisualCriticLike } from './types.js';
import { VisualCritic } from './visual-critic.js';

export interface DesignStudyServiceOptions {
  memory: DesignMemoryManager;
  nativeExtractor?: DesignExtractor;
  dembrandtCommand?: string;
  extractorMode?: 'auto' | 'native' | 'dembrandt';
  critic?: VisualCriticLike;
  criticThreshold?: number;
  operationTimeoutMs?: number;
}

export class DesignStudyService {
  private readonly memory: DesignMemoryManager;
  private readonly nativeExtractor: DesignExtractor;
  private readonly dembrandtCommand?: string;
  private readonly extractorMode: 'auto' | 'native' | 'dembrandt';
  private readonly critic: VisualCriticLike;
  private readonly operationTimeoutMs: number;

  constructor(options: DesignStudyServiceOptions) {
    this.memory = options.memory;
    this.nativeExtractor = options.nativeExtractor ?? new NativePlaywrightExtractor();
    this.dembrandtCommand = options.dembrandtCommand;
    this.extractorMode = options.extractorMode ?? 'auto';
    this.operationTimeoutMs = options.operationTimeoutMs ?? 120_000;
    this.critic = options.critic ?? new VisualCritic({
      extractor: this.nativeExtractor,
      threshold: options.criticThreshold,
    });
  }

  async study(request: DesignStudyRunRequest): Promise<DesignCandidate> {
    assertReferenceStudyUrl(request.url);
    const extraction = await withTimeout(
      (signal) => this.extractWithConfiguredBackend(request, signal),
      this.operationTimeoutMs,
      'Design study extraction timed out',
    );
    const breakerReport = createDesignBreakerReport(extraction);
    const candidate = await this.memory.observeCandidate(extraction, {
      taskId: request.taskId,
      sessionRef: request.sessionRef,
    });
    const updated = await this.memory.recordBreakerReport(candidate.id, breakerReport);
    return updated ?? candidate;
  }

  async confirmCandidate(candidateId: string, taskId: string, sessionRef: string): Promise<StyleProfile> {
    return this.memory.confirmCandidate(candidateId, { taskId, sessionRef });
  }

  async useProfile(profileId: string): Promise<void> {
    await this.memory.setActiveProfile(profileId);
  }

  async critique(url: string, profile: StyleProfile, taskId: string, sessionRef: string): Promise<DesignCritique> {
    assertLocalDesignUrl(url);
    const critique = await withTimeout(
      (signal) => this.critic.critique({ url, profile, taskId, sessionRef }, { signal }),
      this.operationTimeoutMs,
      'Design critique timed out',
    );
    await this.memory.appendCritique(critique);
    return critique;
  }

  private async extractWithConfiguredBackend(
    request: DesignStudyRunRequest,
    signal: AbortSignal,
  ): Promise<DesignExtractionResult> {
    if (this.extractorMode === 'native') {
      return this.nativeExtractor.extract(request, { signal });
    }
    if (this.extractorMode === 'dembrandt') {
      if (!this.dembrandtCommand) {
        throw new Error('Dembrandt extractor selected but no command configured');
      }
      return new DembrandtExtractor({ command: this.dembrandtCommand }).extract(request, { signal });
    }
    if (!this.dembrandtCommand) {
      return this.nativeExtractor.extract(request, { signal });
    }
    try {
      return await new DembrandtExtractor({ command: this.dembrandtCommand }).extract(request, { signal });
    } catch {
      return this.nativeExtractor.extract(request, { signal });
    }
  }
}

export function assertReferenceStudyUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Design study reference URL 格式无效');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Design study reference URL 仅允许 http/https');
  }
}

export function assertLocalDesignUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Design critique URL 格式无效');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Design critique 仅允许 http/https 本地 URL');
  }
  if (!isLocalHost(parsed.hostname.toLowerCase())) {
    throw new Error(`Design critique 仅允许本地页面 URL，已拒绝：${parsed.hostname}`);
  }
}

export function createDesignBreakerReport(extraction: DesignExtractionResult): CandidateBreakerReport {
  const hasMobile = extraction.samples.some((sample) => sample.viewport === 'mobile');
  const hasDenseComponents = extraction.samples.length > 20;
  const unknownRiskZones = [
    'dense data tables or compact operational lists',
    'small tags and low-height controls on mobile',
    'forms with many adjacent inputs',
  ];
  if (!hasMobile) {
    unknownRiskZones.push('mobile viewport was not observed');
  }
  if (hasDenseComponents) {
    unknownRiskZones.push('observed component density may not transfer to sparse landing sections');
  }

  return {
    id: `design_breaker_${Date.now()}`,
    strategy_version: '2026-05-v0.31-design',
    confidence_level: hasMobile ? 'moderate' : 'low',
    breakers_applied: ['design-context-adversarial-test', 'mobile-density-test'],
    known_failure_context: hasMobile ? [] : ['missing mobile evidence'],
    unknown_risk_zones: unknownRiskZones,
    recommendation: hasMobile ? 'promote_with_caution' : 'reject',
    created_at: new Date().toISOString(),
  };
}

async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const controller = new AbortController();
  try {
    return await Promise.race([
      fn(controller.signal),
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isLocalHost(host: string): boolean {
  return host === 'localhost'
    || host === '127.0.0.1'
    || host === '::1'
    || host === '[::1]';
}
