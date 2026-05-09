import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadStudentAgentConfig, mergeConfig } from '../loader.js';

describe('student agent config loader', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'student-config-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('缺少配置文件时返回默认配置', async () => {
    const config = await loadStudentAgentConfig({
      cwd: tmpDir,
      env: {},
    });

    expect(config.features.context7).toBe(true);
    expect(config.features.playwright).toBe(false);
    expect(config.features.designStudy).toBe(true);
    expect(config.features.subAgents).toBe(false);
    expect(config.context7.timeoutMs).toBe(10_000);
    expect(config.llm.requestTimeoutMs).toBe(300_000);
    expect(config.designStudy.extractorMode).toBe('auto');
    expect(config.designStudy.criticThreshold).toBe(0.8);
  });

  it('JSON 配置覆盖默认值', async () => {
    await writeFile(join(tmpDir, '.student-agent.json'), JSON.stringify({
      model: {
        name: 'claude-sonnet-4-7',
      },
      features: {
        context7: false,
        playwright: true,
        designStudy: true,
      },
      designStudy: {
        extractorMode: 'dembrandt',
        dembrandtCommand: 'dembrandt',
        criticThreshold: 0.75,
        maxCriticRetries: 2,
        localUrl: 'http://localhost:3000',
      },
      subAgents: {
        maxConcurrency: 2,
      },
      llm: {
        requestTimeoutMs: 120_000,
        maxOutputTokens: 4096,
      },
    }));

    const config = await loadStudentAgentConfig({
      cwd: tmpDir,
      env: {},
    });

    expect(config.model.name).toBe('claude-sonnet-4-7');
    expect(config.features.context7).toBe(false);
    expect(config.features.playwright).toBe(true);
    expect(config.features.designStudy).toBe(true);
    expect(config.designStudy.extractorMode).toBe('dembrandt');
    expect(config.designStudy.dembrandtCommand).toBe('dembrandt');
    expect(config.designStudy.criticThreshold).toBe(0.75);
    expect(config.designStudy.maxCriticRetries).toBe(2);
    expect(config.designStudy.localUrl).toBe('http://localhost:3000');
    expect(config.subAgents.maxConcurrency).toBe(2);
    expect(config.llm.requestTimeoutMs).toBe(120_000);
    expect(config.llm.maxOutputTokens).toBe(4096);
  });

  it('支持 OpenAI Chat provider 配置', async () => {
    await writeFile(join(tmpDir, '.student-agent.json'), JSON.stringify({
      model: {
        provider: 'openai',
        name: 'gpt-4o-mini',
        baseUrl: 'https://relay.example/v1',
      },
    }));

    const config = await loadStudentAgentConfig({
      cwd: tmpDir,
      env: {},
    });

    expect(config.model.provider).toBe('openai');
    expect(config.model.name).toBe('gpt-4o-mini');
    expect(config.model.baseUrl).toBe('https://relay.example/v1');
  });

  it('环境变量覆盖 JSON 配置', async () => {
    await writeFile(join(tmpDir, '.student-agent.json'), JSON.stringify({
      features: {
        context7: false,
        qualityWatchdog: false,
      },
      context7: {
        timeoutMs: 1_000,
      },
    }));

    const config = await loadStudentAgentConfig({
      cwd: tmpDir,
      env: {
        STUDENT_AGENT_MODEL: 'claude-opus-4-1',
        STUDENT_AGENT_FEATURE_CONTEXT7: 'true',
        STUDENT_AGENT_FEATURE_DESIGN_STUDY: 'true',
        STUDENT_AGENT_FEATURE_QUALITY_WATCHDOG: 'true',
        STUDENT_AGENT_DESIGN_EXTRACTOR_MODE: 'native',
        STUDENT_AGENT_DESIGN_DEMBRANDT_COMMAND: 'dembrandt',
        STUDENT_AGENT_DESIGN_CRITIC_THRESHOLD: '0.9',
        STUDENT_AGENT_DESIGN_MAX_CRITIC_RETRIES: '3',
        STUDENT_AGENT_DESIGN_LOCAL_URL: 'http://localhost:5173',
        CONTEXT7_TIMEOUT_MS: '2500',
        STUDENT_AGENT_LLM_REQUEST_TIMEOUT_MS: '180000',
        STUDENT_AGENT_LLM_MAX_OUTPUT_TOKENS: '8192',
        STUDENT_AGENT_LLM_MAX_RETRIES: '1',
        STUDENT_AGENT_LLM_MAX_RETRY_DELAY_MS: '30000',
      },
    });

    expect(config.model.name).toBe('claude-opus-4-1');
    expect(config.features.context7).toBe(true);
    expect(config.features.designStudy).toBe(true);
    expect(config.features.qualityWatchdog).toBe(true);
    expect(config.designStudy.extractorMode).toBe('native');
    expect(config.designStudy.dembrandtCommand).toBe('dembrandt');
    expect(config.designStudy.criticThreshold).toBe(0.9);
    expect(config.designStudy.maxCriticRetries).toBe(3);
    expect(config.designStudy.localUrl).toBe('http://localhost:5173');
    expect(config.context7.timeoutMs).toBe(2_500);
    expect(config.llm.requestTimeoutMs).toBe(180_000);
    expect(config.llm.maxOutputTokens).toBe(8192);
    expect(config.llm.maxRetries).toBe(1);
    expect(config.llm.maxRetryDelayMs).toBe(30_000);
  });

  it('OpenAI provider 环境变量读取 OPENAI_BASE_URL', async () => {
    const config = await loadStudentAgentConfig({
      cwd: tmpDir,
      env: {
        STUDENT_AGENT_PROVIDER: 'openai',
        STUDENT_AGENT_MODEL: 'gpt-4o-mini',
        OPENAI_BASE_URL: 'https://openai-relay.example/v1',
      },
    });

    expect(config.model.provider).toBe('openai');
    expect(config.model.name).toBe('gpt-4o-mini');
    expect(config.model.baseUrl).toBe('https://openai-relay.example/v1');
  });

  it('支持通过 env.STUDENT_AGENT_CONFIG 指定配置文件名', async () => {
    await writeFile(join(tmpDir, 'custom-config.json'), JSON.stringify({
      features: {
        subAgents: true,
      },
    }));

    const config = await loadStudentAgentConfig({
      cwd: tmpDir,
      env: {
        STUDENT_AGENT_CONFIG: 'custom-config.json',
      },
    });

    expect(config.features.subAgents).toBe(true);
  });

  it('mergeConfig 保留未覆盖的嵌套默认值', () => {
    const config = mergeConfig(
      {
        features: {
          context7: false,
        },
      },
      {
        playwright: {
          renderWaitMs: 500,
        },
        designStudy: {
          extractorMode: 'native',
        },
      },
    );

    expect(config.features.context7).toBe(false);
    expect(config.features.boundedBreaker).toBe(true);
    expect(config.playwright.renderWaitMs).toBe(500);
    expect(config.playwright.navigationTimeoutMs).toBe(10_000);
    expect(config.designStudy.extractorMode).toBe('native');
    expect(config.designStudy.criticThreshold).toBe(0.8);
  });
});
