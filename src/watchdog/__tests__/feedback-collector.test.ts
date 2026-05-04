import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WriteQueue } from '../../core/write-queue.js';
import {
  QualityFeedbackManager,
  parseFeedbackCommand,
  shouldRequestFeedback,
} from '../feedback-collector.js';

describe('QualityFeedbackManager', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'quality-feedback-test-'));
    QualityFeedbackManager.resetInstance();
    WriteQueue.resetInstance();
  });

  afterEach(async () => {
    QualityFeedbackManager.resetInstance();
    WriteQueue.resetInstance();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('append 写入 quality-feedback.json', async () => {
    const manager = QualityFeedbackManager.getInstance(tmpDir);
    await manager.append({
      task_id: 'task_1',
      session_ref: 'session_1',
      task_description: 'test task',
      rating: 'down',
      comment: 'missed tests',
    });

    const feedback = await manager.getAll();
    expect(feedback).toHaveLength(1);
    expect(feedback[0]).toMatchObject({
      task_id: 'task_1',
      rating: 'down',
      comment: 'missed tests',
    });
    expect(feedback[0].id).toMatch(/^quality_feedback_[0-9a-f-]+$/);
  });

  it('parseFeedbackCommand 解析 CLI 反馈命令', () => {
    expect(parseFeedbackCommand('/feedback down 缺少测试')).toEqual({
      rating: 'down',
      comment: '缺少测试',
    });
    expect(parseFeedbackCommand('/feedback up')).toEqual({
      rating: 'up',
      comment: '',
    });
    expect(parseFeedbackCommand('/other down')).toBeNull();
  });

  it('每 5 个任务请求一次反馈', () => {
    expect(shouldRequestFeedback(4)).toBe(false);
    expect(shouldRequestFeedback(5)).toBe(true);
    expect(shouldRequestFeedback(10)).toBe(true);
  });
});
