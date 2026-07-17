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
    expect(config.features.playwright).toBe(true);
    expect(config.features.subAgents).toBe(false);
    expect(config.features.riskGuard).toBe(true);
    expect(config.executionMode).toBe('yolo');
    expect(config.context7.timeoutMs).toBe(10_000);
    expect(config.llm.requestTimeoutMs).toBe(300_000);
    expect(config.fileGuard).toEqual({
      planningMaxReads: 3,
      normalMaxReads: 15,
      readWindow: 30,
    });
  });

  it('JSON 配置覆盖默认值', async () => {
    await writeFile(join(tmpDir, '.student-agent.json'), JSON.stringify({
      model: {
        name: 'claude-sonnet-4-7',
      },
      executionMode: 'safe',
      features: {
        context7: false,
        playwright: true,
        riskGuard: false,
      },
      subAgents: {
        maxConcurrency: 2,
      },
      llm: {
        requestTimeoutMs: 120_000,
        maxOutputTokens: 4096,
      },
      fileGuard: {
        planningMaxReads: 5,
        normalMaxReads: 20,
        readWindow: 40,
      },
    }));

    const config = await loadStudentAgentConfig({
      cwd: tmpDir,
      env: {},
    });

    expect(config.model.name).toBe('claude-sonnet-4-7');
    expect(config.executionMode).toBe('safe');
    expect(config.features.context7).toBe(false);
    expect(config.features.playwright).toBe(true);
    expect(config.features.riskGuard).toBe(false);
    expect(config.subAgents.maxConcurrency).toBe(2);
    expect(config.llm.requestTimeoutMs).toBe(120_000);
    expect(config.llm.maxOutputTokens).toBe(4096);
    expect(config.fileGuard.planningMaxReads).toBe(5);
    expect(config.fileGuard.normalMaxReads).toBe(20);
    expect(config.fileGuard.readWindow).toBe(40);
  });

  it('loads project archive configuration', async () => {
    await writeFile(join(tmpDir, '.student-agent.json'), JSON.stringify({
      features: { projectArchive: true },
      archive: {
        indexPath: 'docs/history.md',
        adrDir: 'docs/decisions',
      },
    }));

    const config = await loadStudentAgentConfig({ cwd: tmpDir, env: {} });

    expect(config.features.projectArchive).toBe(true);
    expect(config.archive).toMatchObject({
      enabled: true,
      format: 'auto',
      indexPath: 'docs/history.md',
      adrDir: 'docs/decisions',
      dashboardPath: 'docs/agent/dashboard.html',
    });
  });

  it('allows the project archive feature to be disabled from the environment', async () => {
    const config = await loadStudentAgentConfig({
      cwd: tmpDir,
      env: { STUDENT_AGENT_FEATURE_PROJECT_ARCHIVE: 'false' },
    });

    expect(config.features.projectArchive).toBe(false);
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
        STUDENT_AGENT_EXECUTION_MODE: 'safe',
        STUDENT_AGENT_FEATURE_CONTEXT7: 'true',
        STUDENT_AGENT_FEATURE_DESIGN_STUDY: 'true',
        STUDENT_AGENT_FEATURE_QUALITY_WATCHDOG: 'true',
        STUDENT_AGENT_FEATURE_RISK_GUARD: 'false',
        STUDENT_AGENT_DESIGN_EXTRACTOR_MODE: 'native',
        STUDENT_AGENT_DESIGN_DEMBRANDT_COMMAND: 'dembrandt',
        STUDENT_AGENT_DESIGN_CRITIC_THRESHOLD: '0.9',
        STUDENT_AGENT_DESIGN_MAX_CRITIC_RETRIES: '3',
        STUDENT_AGENT_DESIGN_STYLE_DESCRIPTION_TIMEOUT_MS: '90000',
        STUDENT_AGENT_DESIGN_LOCAL_URL: 'http://localhost:5173',
        CONTEXT7_TIMEOUT_MS: '2500',
        STUDENT_AGENT_LLM_REQUEST_TIMEOUT_MS: '180000',
        STUDENT_AGENT_LLM_MAX_OUTPUT_TOKENS: '8192',
        STUDENT_AGENT_LLM_MAX_RETRIES: '1',
        STUDENT_AGENT_LLM_MAX_RETRY_DELAY_MS: '30000',
        STUDENT_AGENT_FILE_GUARD_PLANNING_MAX_READS: '4',
        STUDENT_AGENT_FILE_GUARD_NORMAL_MAX_READS: '18',
        STUDENT_AGENT_FILE_GUARD_READ_WINDOW: '25',
      },
    });

    expect(config.model.name).toBe('claude-opus-4-1');
    expect(config.executionMode).toBe('safe');
    expect(config.features.context7).toBe(true);
    expect(config.features.qualityWatchdog).toBe(true);
    expect(config.features.riskGuard).toBe(false);
    expect(config.context7.timeoutMs).toBe(2_500);
    expect(config.llm.requestTimeoutMs).toBe(180_000);
    expect(config.llm.maxOutputTokens).toBe(8192);
    expect(config.llm.maxRetries).toBe(1);
    expect(config.llm.maxRetryDelayMs).toBe(30_000);
    expect(config.fileGuard.planningMaxReads).toBe(4);
    expect(config.fileGuard.normalMaxReads).toBe(18);
    expect(config.fileGuard.readWindow).toBe(25);
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

  it('从全局配置解析当前 provider profile', async () => {
    const globalDir = await mkdtemp(join(tmpdir(), 'student-global-config-test-'));
    try {
      await writeFile(join(globalDir, '.student-agent.json'), JSON.stringify({
        activeProviderProfile: 'openrouter-sonnet',
        providerProfiles: {
          'openrouter-sonnet': {
            provider: 'openrouter',
            name: 'anthropic/claude-sonnet-4.6',
            baseUrl: 'https://openrouter.ai/api/v1',
            api: 'openai-completions',
            apiKeyEnv: 'OPENROUTER_API_KEY',
          },
        },
      }));

      const config = await loadStudentAgentConfig({
        cwd: tmpDir,
        globalConfigDir: globalDir,
        env: {},
      });

      expect(config.activeProviderProfile).toBe('openrouter-sonnet');
      expect(config.providerProfiles).toHaveProperty('openrouter-sonnet');
      expect(config.model).toMatchObject({
        provider: 'openrouter',
        name: 'anthropic/claude-sonnet-4.6',
        baseUrl: 'https://openrouter.ai/api/v1',
        api: 'openai-completions',
        apiKeyEnv: 'OPENROUTER_API_KEY',
      });
    } finally {
      await rm(globalDir, { recursive: true, force: true });
    }
  });

  it('项目配置可以选择另一个全局 profile，但不能覆盖 profile 定义', async () => {
    const globalDir = await mkdtemp(join(tmpdir(), 'student-global-config-test-'));
    try {
      await writeFile(join(globalDir, '.student-agent.json'), JSON.stringify({
        activeProviderProfile: 'openrouter-sonnet',
        providerProfiles: {
          'openrouter-sonnet': {
            provider: 'openrouter',
            name: 'anthropic/claude-sonnet-4.6',
            apiKeyEnv: 'OPENROUTER_API_KEY',
          },
          'anthropic-direct': {
            provider: 'anthropic',
            name: 'claude-sonnet-4-6',
            apiKeyEnv: 'ANTHROPIC_API_KEY',
          },
        },
      }));
      await writeFile(join(tmpDir, '.student-agent.json'), JSON.stringify({
        activeProviderProfile: 'anthropic-direct',
        model: {
          provider: 'openai',
          name: 'legacy-project-model-must-not-win',
        },
        providerProfiles: {
          'anthropic-direct': {
            provider: 'openai',
            name: 'must-not-win',
            apiKeyEnv: 'WRONG_API_KEY',
          },
        },
      }));

      const config = await loadStudentAgentConfig({
        cwd: tmpDir,
        globalConfigDir: globalDir,
        env: {},
      });

      expect(config.activeProviderProfile).toBe('anthropic-direct');
      expect(config.model).toMatchObject({
        provider: 'anthropic',
        name: 'claude-sonnet-4-6',
        apiKeyEnv: 'ANTHROPIC_API_KEY',
      });
      expect(config.providerProfiles['anthropic-direct'].provider).toBe('anthropic');
    } finally {
      await rm(globalDir, { recursive: true, force: true });
    }
  });

  it('环境变量可以选择 profile，并继续覆盖 profile 的模型路由', async () => {
    const globalDir = await mkdtemp(join(tmpdir(), 'student-global-config-test-'));
    try {
      await writeFile(join(globalDir, '.student-agent.json'), JSON.stringify({
        activeProviderProfile: 'anthropic-direct',
        providerProfiles: {
          'anthropic-direct': {
            provider: 'anthropic',
            name: 'claude-sonnet-4-6',
            apiKeyEnv: 'ANTHROPIC_API_KEY',
          },
          'openrouter-sonnet': {
            provider: 'openrouter',
            name: 'anthropic/claude-sonnet-4.6',
            baseUrl: 'https://openrouter.ai/api/v1',
            api: 'openai-completions',
            apiKeyEnv: 'OPENROUTER_API_KEY',
          },
        },
      }));

      const config = await loadStudentAgentConfig({
        cwd: tmpDir,
        globalConfigDir: globalDir,
        env: {
          STUDENT_AGENT_PROVIDER_PROFILE: 'openrouter-sonnet',
          STUDENT_AGENT_PROVIDER: 'openai',
          STUDENT_AGENT_MODEL: 'gpt-5.5',
          STUDENT_AGENT_BASE_URL: 'https://example.test/v1',
        },
      });

      expect(config.activeProviderProfile).toBe('openrouter-sonnet');
      expect(config.model).toMatchObject({
        provider: 'openai',
        name: 'gpt-5.5',
        baseUrl: 'https://example.test/v1',
      });
      expect(config.model.apiKeyEnv).toBeUndefined();
    } finally {
      await rm(globalDir, { recursive: true, force: true });
    }
  });

  it('选择不存在的 provider profile 时明确报错', async () => {
    const globalDir = await mkdtemp(join(tmpdir(), 'student-global-config-test-'));
    try {
      await writeFile(join(globalDir, '.student-agent.json'), JSON.stringify({
        activeProviderProfile: 'missing-profile',
        providerProfiles: {},
      }));

      await expect(loadStudentAgentConfig({
        cwd: tmpDir,
        globalConfigDir: globalDir,
        env: {},
      })).rejects.toThrow('Provider profile "missing-profile" was not found');
    } finally {
      await rm(globalDir, { recursive: true, force: true });
    }
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
        fileGuard: {
          normalMaxReads: 25,
        },
      },
    );

    expect(config.features.context7).toBe(false);
    expect(config.executionMode).toBe('yolo');
    expect(config.features.boundedBreaker).toBe(true);
    expect(config.features.riskGuard).toBe(true);
    expect(config.playwright.renderWaitMs).toBe(500);
    expect(config.playwright.navigationTimeoutMs).toBe(10_000);
    expect(config.fileGuard.planningMaxReads).toBe(3);
    expect(config.fileGuard.normalMaxReads).toBe(25);
    expect(config.fileGuard.readWindow).toBe(30);
  });
});
