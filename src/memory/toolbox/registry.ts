import type { DescribedTool, ListedTool, ToolStats } from './types.js';

/**
 * ToolboxRegistry — rebuilds tool state from <memoryDir>/toolbox/ on every load().
 * No in-memory ghost state across instances.
 */
export class ToolboxRegistry {
  constructor(
    _memoryDir: string,
    _options?: { failureThreshold?: number },
  ) {
    throw new Error('ToolboxRegistry not implemented');
  }

  async load(): Promise<void> {
    throw new Error('ToolboxRegistry.load not implemented');
  }

  list(): ListedTool[] {
    throw new Error('ToolboxRegistry.list not implemented');
  }

  describe(_name: string): DescribedTool | undefined {
    throw new Error('ToolboxRegistry.describe not implemented');
  }

  async createTool(_name: string, _source: string): Promise<void> {
    throw new Error('ToolboxRegistry.createTool not implemented');
  }

  async updateTool(_name: string, _source: string): Promise<void> {
    throw new Error('ToolboxRegistry.updateTool not implemented');
  }

  async disableTool(_name: string, _reason: string): Promise<void> {
    throw new Error('ToolboxRegistry.disableTool not implemented');
  }

  async recordUsage(_name: string, _ok: boolean): Promise<void> {
    throw new Error('ToolboxRegistry.recordUsage not implemented');
  }

  toolPath(_name: string): string {
    throw new Error('ToolboxRegistry.toolPath not implemented');
  }
}

export type { DescribedTool, ListedTool, ToolStats };
