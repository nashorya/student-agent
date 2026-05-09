import type { DesignExtractionResult, StyleProfile, DesignCritique } from '../../memory/design/types.js';

export interface DesignStudyRequest {
  url: string;
  name?: string;
}

export interface DesignExtractionOptions {
  signal?: AbortSignal;
}

export interface DesignExtractor {
  extract(request: DesignStudyRequest, options?: DesignExtractionOptions): Promise<DesignExtractionResult>;
}

export interface VisualCriticRequest {
  url: string;
  profile: StyleProfile;
  taskId: string;
  sessionRef: string;
}

export interface VisualCriticLike {
  critique(request: VisualCriticRequest, options?: DesignExtractionOptions): Promise<DesignCritique>;
}

export interface DesignStudyRunRequest extends DesignStudyRequest {
  taskId: string;
  sessionRef: string;
}
