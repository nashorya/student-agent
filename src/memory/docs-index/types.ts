/**
 * docs-index 类型定义
 * sqlite-vec 文档向量库：存储项目文档和外部文档的分块嵌入，支持语义检索。
 */

/** 文档条目（存储在 SQLite docs 表中） */
export interface DocEntry {
  id: string;
  /** 来源 URL 或文件路径 */
  source: string;
  title: string;
  /** 分块后的文本内容 */
  content: string;
  /** 分块索引（同一来源文档的第 N 个块） */
  chunk_index: number;
  created_at: string;
  updated_at: string;
}

/** 语义搜索结果 */
export interface SearchResult {
  entry: DocEntry;
  /** 余弦距离（越小越相似） */
  distance: number;
}

/** 索引统计信息 */
export interface DocsIndexStats {
  totalDocs: number;
  totalChunks: number;
}

/** 嵌入提供者接口（便于后续切换本地/API 嵌入） */
export interface EmbeddingProvider {
  /** 生成文本向量 */
  embed(text: string): Promise<number[]>;
  /** 向量维度 */
  readonly dimensions: number;
}

// ── 配置常量 ──────────────────────────────────────

/** 单个分块的最大字符数 */
export const MAX_CHUNK_CHARS = 3000;

/** 分块之间的重叠字符数 */
export const CHUNK_OVERLAP_CHARS = 300;

/** 默认搜索返回的 top-K 数量 */
export const DEFAULT_TOP_K = 5;

/** 嵌入维度（text-embedding-3-small = 1536） */
export const EMBEDDING_DIMENSIONS = 1536;

/** 嵌入 API 基础 URL */
export const EMBEDDING_API_BASE_URL = 'https://work.poloapi.com/v1';

/** 嵌入模型名称 */
export const EMBEDDING_MODEL = 'text-embedding-3-small';
