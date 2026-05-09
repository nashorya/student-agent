import { createActor, createMachine } from 'xstate';
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

export interface DesignStudyMachineContext {
  candidateId: string | null;
  profileId: string | null;
  failureReason: string | null;
}

type DesignStudyMachineEvent =
  | { type: 'DESIGN_STUDY_REQUESTED' }
  | { type: 'REFERENCE_OPENED' }
  | { type: 'SCREENSHOTS_CAPTURED' }
  | { type: 'STYLE_SAMPLES_EXTRACTED' }
  | { type: 'PATTERNS_IDENTIFIED' }
  | { type: 'BOUNDED_BREAKER_COMPLETE' }
  | { type: 'CANDIDATE_WRITTEN' }
  | { type: 'CRITIQUE_REQUESTED' }
  | { type: 'LOCAL_SCREENSHOT_CAPTURED' }
  | { type: 'CRITIQUE_COMPLETE' }
  | { type: 'FAIL' };

export function createDesignStudyMachine() {
  return createMachine({
    types: {} as {
      context: DesignStudyMachineContext;
      events: DesignStudyMachineEvent;
    },
    id: 'designStudy',
    initial: 'idle',
    context: {
      candidateId: null,
      profileId: null,
      failureReason: null,
    },
    states: {
      idle: {
        on: {
          DESIGN_STUDY_REQUESTED: 'open_reference_urls',
          CRITIQUE_REQUESTED: 'playwright_screenshot_local_page',
        },
      },
      open_reference_urls: timedState('capture_screenshots', 'REFERENCE_OPENED'),
      capture_screenshots: timedState('extract_computed_style_samples', 'SCREENSHOTS_CAPTURED'),
      extract_computed_style_samples: timedState('identify_component_patterns', 'STYLE_SAMPLES_EXTRACTED'),
      identify_component_patterns: timedState('bounded_breaker_for_design_generalization', 'PATTERNS_IDENTIFIED'),
      bounded_breaker_for_design_generalization: timedState('produce_style_profile_candidate', 'BOUNDED_BREAKER_COMPLETE'),
      produce_style_profile_candidate: timedState('done', 'CANDIDATE_WRITTEN'),
      playwright_screenshot_local_page: timedState('compare_with_style_profile', 'LOCAL_SCREENSHOT_CAPTURED'),
      compare_with_style_profile: timedState('done', 'CRITIQUE_COMPLETE'),
      done: { type: 'final' },
      failed: { type: 'final' },
    },
  });
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
    const actor = createActor(createDesignStudyMachine()).start();
    try {
      actor.send({ type: 'DESIGN_STUDY_REQUESTED' });
      actor.send({ type: 'REFERENCE_OPENED' });
      actor.send({ type: 'SCREENSHOTS_CAPTURED' });
      const extraction = await withTimeout(
        (signal) => this.extractWithConfiguredBackend(request, signal),
        this.operationTimeoutMs,
        'Design study extraction timed out',
      );
      actor.send({ type: 'STYLE_SAMPLES_EXTRACTED' });
      actor.send({ type: 'PATTERNS_IDENTIFIED' });
      const breakerReport = createDesignBreakerReport(extraction);
      actor.send({ type: 'BOUNDED_BREAKER_COMPLETE' });
      const candidate = await this.memory.observeCandidate(extraction, {
        taskId: request.taskId,
        sessionRef: request.sessionRef,
      });
      const updated = await this.memory.recordBreakerReport(candidate.id, breakerReport);
      actor.send({ type: 'CANDIDATE_WRITTEN' });
      return updated ?? candidate;
    } catch (err) {
      actor.send({ type: 'FAIL' });
      throw err;
    } finally {
      actor.stop();
    }
  }

  async confirmCandidate(candidateId: string, taskId: string, sessionRef: string): Promise<StyleProfile> {
    return this.memory.confirmCandidate(candidateId, { taskId, sessionRef });
  }

  async useProfile(profileId: string): Promise<void> {
    await this.memory.setActiveProfile(profileId);
  }

  async critique(url: string, profile: StyleProfile, taskId: string, sessionRef: string): Promise<DesignCritique> {
    assertLocalDesignUrl(url);
    const actor = createActor(createDesignStudyMachine()).start();
    try {
      actor.send({ type: 'CRITIQUE_REQUESTED' });
      actor.send({ type: 'LOCAL_SCREENSHOT_CAPTURED' });
      const critique = await withTimeout(
        (signal) => this.critic.critique({ url, profile, taskId, sessionRef }, { signal }),
        this.operationTimeoutMs,
        'Design critique timed out',
      );
      await this.memory.appendCritique(critique);
      actor.send({ type: 'CRITIQUE_COMPLETE' });
      return critique;
    } catch (err) {
      actor.send({ type: 'FAIL' });
      throw err;
    } finally {
      actor.stop();
    }
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

function timedState(target: string, event: DesignStudyMachineEvent['type']) {
  return {
    after: {
      120_000: 'failed',
    },
    on: {
      [event]: target,
      FAIL: 'failed',
    },
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
