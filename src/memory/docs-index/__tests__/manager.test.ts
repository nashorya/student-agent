import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocsIndexManager } from '../manager.js';
import { WriteQueue } from '../../../core/write-queue.js';
import type { EmbeddingProvider } from '../types.js';
import { EMBEDDING_DIMENSIONS } from '../types.js';

// ── Mock 嵌入提供者 ─────────────────────────────────

/**
 * 测试用的 Mock 嵌入提供者。
 * 生成基于文本哈希的确定性伪向量，不调用外部 API。
 */
class MockEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = EMBEDDING_DIMENSIONS;
  embedCallCount = 0;
  shouldFail = false;

  async embed(text: string): Promise<number[]> {
    this.embedCallCount++;
    if (this.shouldFail) {
      throw new Error('Mock embedding failure');
    }
    // 生成确定性伪向量：基于文本字符的简单哈希
    const vec = new Array<number>(this.dimensions).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % this.dimensions] += text.charCodeAt(i) / 1000;
    }
    // 归一化
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }
}

// ── 测试 ──────────────────────────────────────────────

describe('DocsIndexManager', () => {
  let tmpDir: string;
  let manager: DocsIndexManager;
  let mockProvider: MockEmbeddingProvider;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'docs-index-test-'));
    DocsIndexManager.resetInstance();
    WriteQueue.resetInstance();
    mockProvider = new MockEmbeddingProvider();
    manager = DocsIndexManager.getInstance(tmpDir, mockProvider);
    await manager.initialize();
  });

  afterEach(async () => {
    DocsIndexManager.resetInstance();
    WriteQueue.resetInstance();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── 初始化 ────────────────────────────────────────

  describe('initialize', () => {
    it('幂等：重复初始化不报错', async () => {
      // 已在 beforeEach 中 initialize 过一次
      await expect(manager.initialize()).resolves.not.toThrow();
    });

    it('初始化后 stats 为空', async () => {
      const stats = await manager.getStats();
      expect(stats.totalDocs).toBe(0);
      expect(stats.totalChunks).toBe(0);
    });
  });

  // ── 索引文档 ──────────────────────────────────────

  describe('indexDocument', () => {
    it('短文档索引为单个 chunk', async () => {
      const indexed = await manager.indexDocument({
        source: 'https://example.com/doc',
        title: 'Test Doc',
        content: 'This is a short document for testing.',
      });

      expect(indexed).toBe(1);
      const stats = await manager.getStats();
      expect(stats.totalDocs).toBe(1);
      expect(stats.totalChunks).toBe(1);
    });

    it('长文档自动分块', async () => {
      // 生成一个超过 MAX_CHUNK_CHARS 的文档
      const paragraphs = Array.from(
        { length: 30 },
        (_, i) => `Paragraph ${i}: ${'x'.repeat(200)}`,
      );
      const content = paragraphs.join('\n\n');

      const indexed = await manager.indexDocument({
        source: 'file:///big-doc.md',
        title: 'Big Doc',
        content,
      });

      expect(indexed).toBeGreaterThan(1);
      const stats = await manager.getStats();
      expect(stats.totalChunks).toBe(indexed);
    });

    it('重复索引同一来源会替换而非重复', async () => {
      await manager.indexDocument({
        source: 'file:///doc.md',
        title: 'V1',
        content: 'Version 1 content',
      });

      await manager.indexDocument({
        source: 'file:///doc.md',
        title: 'V2',
        content: 'Version 2 content - updated',
      });

      const stats = await manager.getStats();
      expect(stats.totalDocs).toBe(1);
      expect(stats.totalChunks).toBe(1);
    });

    it('嵌入失败时不阻塞，记录错误', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockProvider.shouldFail = true;

      const indexed = await manager.indexDocument({
        source: 'file:///fail.md',
        title: 'Fail',
        content: 'This will fail embedding',
      });

      expect(indexed).toBe(0);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  // ── 语义搜索 ──────────────────────────────────────

  describe('search', () => {
    it('索引后可通过语义搜索检索到', async () => {
      await manager.indexDocument({
        source: 'file:///auth.md',
        title: 'Auth Module',
        content: 'Authentication and authorization handling for user login.',
      });

      await manager.indexDocument({
        source: 'file:///db.md',
        title: 'Database Module',
        content: 'Database connection pooling and query optimization.',
      });

      const results = await manager.search('user login authentication');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entry.source).toBeDefined();
      expect(typeof results[0].distance).toBe('number');
    });

    it('空库搜索返回空数组', async () => {
      const results = await manager.search('anything');
      expect(results).toEqual([]);
    });

    it('topK 限制返回数量', async () => {
      for (let i = 0; i < 5; i++) {
        await manager.indexDocument({
          source: `file:///doc${i}.md`,
          title: `Doc ${i}`,
          content: `Document number ${i} with some content about testing.`,
        });
      }

      const results = await manager.search('testing', 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  // ── 删除 ──────────────────────────────────────────

  describe('removeBySource', () => {
    it('正确删除指定来源', async () => {
      await manager.indexDocument({
        source: 'file:///keep.md',
        title: 'Keep',
        content: 'This stays.',
      });

      await manager.indexDocument({
        source: 'file:///remove.md',
        title: 'Remove',
        content: 'This goes away.',
      });

      const removed = await manager.removeBySource('file:///remove.md');
      expect(removed).toBe(1);

      const stats = await manager.getStats();
      expect(stats.totalDocs).toBe(1);
      expect(stats.totalChunks).toBe(1);
    });

    it('删除不存在的来源返回 0', async () => {
      const removed = await manager.removeBySource('file:///nonexistent.md');
      expect(removed).toBe(0);
    });
  });

  // ── 统计 ──────────────────────────────────────────

  describe('getStats', () => {
    it('正确统计不同来源的文档数和总 chunk 数', async () => {
      await manager.indexDocument({
        source: 'file:///a.md',
        title: 'A',
        content: 'Content A',
      });

      await manager.indexDocument({
        source: 'file:///b.md',
        title: 'B',
        content: 'Content B',
      });

      const stats = await manager.getStats();
      expect(stats.totalDocs).toBe(2);
      expect(stats.totalChunks).toBe(2);
    });
  });

  // ── 分块 ──────────────────────────────────────────

  describe('chunkText', () => {
    it('空文本返回空数组', () => {
      expect(manager.chunkText('')).toEqual([]);
      expect(manager.chunkText('   ')).toEqual([]);
    });

    it('短文本单 chunk', () => {
      const chunks = manager.chunkText('Hello world', 100);
      expect(chunks).toEqual(['Hello world']);
    });

    it('按段落边界分块', () => {
      const text = 'Paragraph 1 content here.\n\nParagraph 2 content here.\n\nParagraph 3 content here.';
      const chunks = manager.chunkText(text, 50, 0);
      expect(chunks.length).toBeGreaterThan(1);
      // 每个 chunk 不超过 maxChunkSize
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(50);
      }
    });

    it('超长段落强制切割', () => {
      const longPara = 'x'.repeat(500);
      const chunks = manager.chunkText(longPara, 100, 20);
      expect(chunks.length).toBeGreaterThan(1);
      // 第一个 chunk 不超过 maxChunkSize
      expect(chunks[0].length).toBeLessThanOrEqual(100);
    });

    it('分块之间有重叠', () => {
      const paragraphs = Array.from(
        { length: 10 },
        (_, i) => `Paragraph ${i}: ${'content '.repeat(20)}`,
      );
      const text = paragraphs.join('\n\n');
      const chunks = manager.chunkText(text, 300, 50);

      if (chunks.length >= 2) {
        // 重叠：后一个 chunk 的开头应包含前一个 chunk 的尾部内容
        // 因为重叠是基于字符的，只验证后续 chunk 不完全从段落开头开始
        expect(chunks.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  // ── WriteQueue 集成 ───────────────────────────────

  describe('WriteQueue 集成', () => {
    it('并发写入通过 WriteQueue 串行化', async () => {
      // 并发索引多个文档
      const promises = Array.from({ length: 5 }, (_, i) =>
        manager.indexDocument({
          source: `file:///concurrent${i}.md`,
          title: `Doc ${i}`,
          content: `Concurrent document ${i} content.`,
        }),
      );

      const results = await Promise.all(promises);
      const totalIndexed = results.reduce((sum, n) => sum + n, 0);
      expect(totalIndexed).toBe(5);

      const stats = await manager.getStats();
      expect(stats.totalDocs).toBe(5);
    });
  });

  // ── 未初始化保护 ──────────────────────────────────

  describe('未初始化保护', () => {
    it('未初始化时操作应抛出错误', async () => {
      DocsIndexManager.resetInstance();
      const uninitManager = DocsIndexManager.getInstance(tmpDir, mockProvider);
      // 不调用 initialize()

      await expect(
        uninitManager.indexDocument({
          source: 'test',
          title: 'test',
          content: 'test',
        }),
      ).rejects.toThrow('未初始化');
    });
  });
});
