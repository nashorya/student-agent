import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { WriteQueue } from '../../core/write-queue.js';
import type {
  DocEntry,
  SearchResult,
  DocsIndexStats,
  EmbeddingProvider,
} from './types.js';
import {
  MAX_CHUNK_CHARS,
  CHUNK_OVERLAP_CHARS,
  DEFAULT_TOP_K,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_API_BASE_URL,
  EMBEDDING_MODEL,
} from './types.js';

// ── 默认嵌入提供者（OpenAI 兼容 API） ──────────────

/**
 * OpenAI 兼容的嵌入提供者。
 * 调用 text-embedding-3-small via poloapi。
 */
class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = EMBEDDING_DIMENSIONS;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string;

  constructor(options?: { baseUrl?: string; model?: string; apiKey?: string }) {
    this.baseUrl = options?.baseUrl ?? EMBEDDING_API_BASE_URL;
    this.model = options?.model ?? EMBEDDING_MODEL;
    const key = options?.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    if (!key) {
      console.warn('[DocsIndex] OPENAI_API_KEY 未设置，嵌入功能将不可用');
    }
    this.apiKey = key;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY 未设置，无法生成嵌入向量');
    }

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      throw new Error(
        `嵌入 API 调用失败：${response.status} ${response.statusText} — ${errorText}`,
      );
    }

    const json = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    if (!json.data?.[0]?.embedding) {
      throw new Error('嵌入 API 返回格式异常：缺少 data[0].embedding');
    }

    return json.data[0].embedding;
  }
}

// ── DocsIndexManager ────────────────────────────────

/**
 * DocsIndexManager — sqlite-vec 文档向量库的唯一读写入口。
 *
 * 职责：
 *   initialize()      — 创建/迁移数据库 schema（幂等）
 *   indexDocument()    — 分块 + 嵌入 + 写入
 *   search()           — 语义检索
 *   removeBySource()   — 按来源删除
 *   getStats()         — 统计信息
 *
 * 所有写入通过 WriteQueue 串行化。
 * better-sqlite3 是同步 API，但仍走 WriteQueue 以防并发。
 */
export class DocsIndexManager {
  private static instance: DocsIndexManager | null = null;
  private readonly dbPath: string;
  private readonly embeddingProvider: EmbeddingProvider;
  private db: Database.Database | null = null;

  private constructor(memoryDir: string, embeddingProvider?: EmbeddingProvider) {
    this.dbPath = join(memoryDir, 'docs-index', 'agent.db');
    this.embeddingProvider = embeddingProvider ?? new OpenAICompatibleEmbeddingProvider();
  }

  static getInstance(
    memoryDir?: string,
    embeddingProvider?: EmbeddingProvider,
  ): DocsIndexManager {
    const dir = memoryDir ?? `${process.cwd()}/memory`;
    if (!DocsIndexManager.instance) {
      DocsIndexManager.instance = new DocsIndexManager(dir, embeddingProvider);
    }
    return DocsIndexManager.instance;
  }

  /** 仅测试用 */
  static resetInstance(): void {
    if (DocsIndexManager.instance?.db) {
      try {
        DocsIndexManager.instance.db.close();
      } catch {
        // ignore close errors during test teardown
      }
    }
    DocsIndexManager.instance = null;
  }

  // ── 初始化 ──────────────────────────────────────────

  /**
   * 初始化数据库（幂等）。
   * 创建目录、加载 sqlite-vec 扩展、建表。
   */
  async initialize(): Promise<void> {
    await mkdir(join(this.dbPath, '..'), { recursive: true });

    this.db = new Database(this.dbPath);

    await WriteQueue.getInstance().enqueue(async () => {
      const db = this.ensureDb();
      db.pragma('journal_mode = WAL');

      // 加载 sqlite-vec 扩展
      try {
        const sqliteVec = await import('sqlite-vec');
        sqliteVec.load(db);
      } catch (err) {
        throw new Error(
          `加载 sqlite-vec 扩展失败：${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // 创建文档元数据表
      db.exec(`
        CREATE TABLE IF NOT EXISTS docs (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_docs_source ON docs(source)
      `);

      // 创建 sqlite-vec 虚拟表
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS docs_vec USING vec0(
          id TEXT PRIMARY KEY,
          embedding float[${EMBEDDING_DIMENSIONS}]
        )
      `);
    });
  }

  // ── 索引文档 ────────────────────────────────────────

  /**
   * 索引一个文档（自动分块 + 嵌入）。
   * 如果同一 source 已有索引，先删除旧的再重新索引。
   *
   * @returns 索引的 chunk 数量
   */
  async indexDocument(params: {
    source: string;
    title: string;
    content: string;
  }): Promise<number> {
    this.ensureDb();

    const chunks = this.chunkText(params.content);
    const rows: Array<{
      id: string;
      content: string;
      chunkIndex: number;
      embedding: number[];
      createdAt: string;
    }> = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunkId = `doc_${randomUUID().slice(0, 12)}_${i}`;
      const now = new Date().toISOString();

      try {
        const embedding = await this.embeddingProvider.embed(chunks[i]);
        rows.push({
          id: chunkId,
          content: chunks[i],
          chunkIndex: i,
          embedding,
          createdAt: now,
        });
      } catch (err) {
        console.error(
          `[DocsIndex] 分块 ${i} 嵌入失败（source: ${params.source}）:`,
          err instanceof Error ? err.message : String(err),
        );
        // 嵌入失败不阻塞，继续处理下一个分块
      }
    }

    await WriteQueue.getInstance().enqueue(async () => {
      const db = this.ensureDb();

      const ids = db
        .prepare('SELECT id FROM docs WHERE source = ?')
        .all(params.source) as Array<{ id: string }>;

      const deleteVec = db.prepare('DELETE FROM docs_vec WHERE id = ?');
      const deleteDoc = db.prepare('DELETE FROM docs WHERE id = ?');
      const insertDoc = db.prepare(`
        INSERT INTO docs (id, source, title, content, chunk_index, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const insertVec = db.prepare(`
        INSERT INTO docs_vec (id, embedding)
        VALUES (?, ?)
      `);

      const replaceSource = db.transaction(() => {
        for (const row of ids) {
          deleteVec.run(row.id);
          deleteDoc.run(row.id);
        }

        for (const row of rows) {
          insertDoc.run(
            row.id,
            params.source,
            params.title,
            row.content,
            row.chunkIndex,
            row.createdAt,
            row.createdAt,
          );
          insertVec.run(row.id, new Float32Array(row.embedding));
        }
      });

      replaceSource();
    });

    return rows.length;
  }

  // ── 语义搜索 ────────────────────────────────────────

  /**
   * 语义搜索：将 query 嵌入后在向量库中检索最相近的文档块。
   */
  async search(query: string, topK: number = DEFAULT_TOP_K): Promise<SearchResult[]> {
    this.ensureDb();

    const queryEmbedding = await this.embeddingProvider.embed(query);
    const db = this.ensureDb();

    const rows = db.prepare(`
      SELECT
        docs_vec.id AS id,
        docs_vec.distance AS distance
      FROM docs_vec
      WHERE embedding MATCH ?
      ORDER BY distance
      LIMIT ?
    `).all(new Float32Array(queryEmbedding), topK) as Array<{
      id: string;
      distance: number;
    }>;

    const results: SearchResult[] = [];

    for (const row of rows) {
      const doc = db.prepare(`
        SELECT id, source, title, content, chunk_index, created_at, updated_at
        FROM docs
        WHERE id = ?
      `).get(row.id) as DocEntry | undefined;

      if (doc) {
        results.push({ entry: doc, distance: row.distance });
      }
    }

    return results;
  }

  // ── 删除 ────────────────────────────────────────────

  /**
   * 删除指定来源的所有索引条目。
   * @returns 删除的 chunk 数量
   */
  async removeBySource(source: string): Promise<number> {
    this.ensureDb();

    return WriteQueue.getInstance().enqueue(async () => {
      const db = this.ensureDb();

      // 查找该 source 的所有 id
      const ids = db
        .prepare('SELECT id FROM docs WHERE source = ?')
        .all(source) as Array<{ id: string }>;

      if (ids.length === 0) return 0;

      // 删除向量表中的记录
      const deleteVec = db.prepare('DELETE FROM docs_vec WHERE id = ?');
      // 删除元数据表中的记录
      const deleteDoc = db.prepare('DELETE FROM docs WHERE id = ?');

      const deleteBatch = db.transaction((docIds: string[]) => {
        for (const id of docIds) {
          deleteVec.run(id);
          deleteDoc.run(id);
        }
      });

      deleteBatch(ids.map((r) => r.id));
      return ids.length;
    });
  }

  // ── 统计 ────────────────────────────────────────────

  /**
   * 获取索引统计信息。
   */
  async getStats(): Promise<DocsIndexStats> {
    this.ensureDb();
    const db = this.ensureDb();

    const totalChunks = (
      db.prepare('SELECT COUNT(*) AS cnt FROM docs').get() as { cnt: number }
    ).cnt;

    const totalDocs = (
      db.prepare('SELECT COUNT(DISTINCT source) AS cnt FROM docs').get() as {
        cnt: number;
      }
    ).cnt;

    return { totalDocs, totalChunks };
  }

  // ── 文本分块 ────────────────────────────────────────

  /**
   * 将长文本按段落边界分块。
   * 每块 ≤ MAX_CHUNK_CHARS 字符，相邻块之间有 CHUNK_OVERLAP_CHARS 重叠。
   */
  chunkText(
    content: string,
    maxChunkSize: number = MAX_CHUNK_CHARS,
    overlapSize: number = CHUNK_OVERLAP_CHARS,
  ): string[] {
    if (!content.trim()) return [];

    // 按段落（双换行）分割
    const paragraphs = content.split(/\n{2,}/);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const para of paragraphs) {
      const trimmedPara = para.trim();
      if (!trimmedPara) continue;

      // 如果当前段落本身就超过 maxChunkSize，强制按字符切割
      if (trimmedPara.length > maxChunkSize) {
        // 先 flush 当前 chunk
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        // 强制切割超长段落
        for (let i = 0; i < trimmedPara.length; i += maxChunkSize - overlapSize) {
          const slice = trimmedPara.slice(i, i + maxChunkSize);
          if (slice.trim()) chunks.push(slice.trim());
        }
        continue;
      }

      const candidate = currentChunk
        ? currentChunk + '\n\n' + trimmedPara
        : trimmedPara;

      if (candidate.length <= maxChunkSize) {
        currentChunk = candidate;
      } else {
        // 当前 chunk 满了，保存并开始新的
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
        }
        // 用重叠区域启动新 chunk
        if (overlapSize > 0 && currentChunk.length > overlapSize) {
          const overlapText = currentChunk.slice(-overlapSize);
          currentChunk = overlapText.trim() + '\n\n' + trimmedPara;
        } else {
          currentChunk = trimmedPara;
        }
      }
    }

    // flush 最后的 chunk
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  // ── 内部 ────────────────────────────────────────────

  private ensureDb(): Database.Database {
    if (!this.db) {
      throw new Error('DocsIndexManager 未初始化，请先调用 initialize()');
    }
    return this.db;
  }
}
