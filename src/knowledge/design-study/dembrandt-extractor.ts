import { execFile } from 'node:child_process';
import type {
  DesignExtractionResult,
  DesignScreenshotRef,
  DesignStyleSample,
  DesignTokens,
} from '../../memory/design/types.js';
import { EMPTY_DESIGN_TOKENS } from '../../memory/design/types.js';
import type { DesignExtractionOptions, DesignExtractor, DesignStudyRequest } from './types.js';

export interface DembrandtExtractorOptions {
  command: string;
  execFileFn?: ExecFileFn;
  timeoutMs?: number;
}

type ExecFileFn = (
  file: string,
  args: string[],
  options: { timeout: number },
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => KillableProcess | void;

interface KillableProcess {
  kill(signal?: NodeJS.Signals | number): boolean;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export class DembrandtExtractor implements DesignExtractor {
  private readonly command: string;
  private readonly execFileFn: ExecFileFn;
  private readonly timeoutMs: number;

  constructor(options: DembrandtExtractorOptions) {
    this.command = options.command;
    this.execFileFn = options.execFileFn ?? execFile;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async extract(request: DesignStudyRequest, options: DesignExtractionOptions = {}): Promise<DesignExtractionResult> {
    const { file, args } = splitCommand(this.command);
    const stdout = await this.run(file, [...args, request.url, '--json'], options);
    return normalizeDembrandtJson(stdout, request);
  }

  private run(file: string, args: string[], options: DesignExtractionOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new Error('Dembrandt extraction aborted'));
        return;
      }

      let settled = false;
      let child: KillableProcess | void;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener('abort', abort);
        fn();
      };
      const abort = () => {
        child?.kill('SIGTERM');
        finish(() => reject(new Error('Dembrandt extraction aborted')));
      };

      options.signal?.addEventListener('abort', abort, { once: true });
      child = this.execFileFn(file, args, { timeout: this.timeoutMs }, (error, stdout, stderr) => {
        if (error) {
          finish(() => reject(new Error(stderr || error.message, { cause: error })));
          return;
        }
        finish(() => resolve(stdout));
      });
    });
  }
}

export function normalizeDembrandtJson(raw: string, request: DesignStudyRequest): DesignExtractionResult {
  const parsed = JSON.parse(raw) as unknown;
  const object = isRecord(parsed) ? parsed : {};
  const tokens = readTokens(object['tokens'] ?? object['designTokens']);
  return {
    name: request.name ?? readString(object['name']) ?? readString(object['title']) ?? request.url,
    sourceUrls: readStringArray(object['sourceUrls'] ?? object['source_urls']) ?? [request.url],
    screenshots: readScreenshots(object['screenshots']),
    samples: readSamples(object['samples'] ?? object['components']),
    tokens,
    componentPatterns: readStringRecord(object['componentPatterns'] ?? object['component_patterns']) ?? {},
    antiPatterns: readStringArray(object['antiPatterns'] ?? object['anti_patterns']) ?? [],
    provenanceSource: 'dembrandt-design-study',
  };
}

function readTokens(value: unknown): DesignTokens {
  if (!isRecord(value)) return EMPTY_DESIGN_TOKENS;
  const colors = isRecord(value['colors']) ? value['colors'] : {};
  const border = isRecord(value['border']) ? value['border'] : {};
  const fontWeight = isRecord(value['fontWeight']) ? value['fontWeight'] : {};
  return {
    colors: {
      ink: readString(colors['ink']),
      background: readStringArray(colors['background']) ?? [],
      text: readStringArray(colors['text']) ?? [],
      accent: readStringArray(colors['accent']) ?? [],
    },
    border: {
      default: readString(border['default']),
      strong: readString(border['strong']),
    },
    shadow: readStringArray(value['shadow']) ?? [],
    radius: readStringArray(value['radius']) ?? [],
    fontFamily: readStringArray(value['fontFamily']) ?? [],
    fontWeight: {
      heading: readNumber(fontWeight['heading']),
      body: readNumber(fontWeight['body']),
      button: readNumber(fontWeight['button']),
    },
  };
}

function readScreenshots(value: unknown): DesignScreenshotRef[] {
  if (!Array.isArray(value)) return [];
  return value.map(readScreenshot).filter((item): item is DesignScreenshotRef => item !== null);
}

function readScreenshot(value: unknown): DesignScreenshotRef | null {
  if (!isRecord(value)) return null;
  const viewport = value['viewport'] === 'mobile' ? 'mobile' : 'desktop';
  return {
    viewport,
    path: readString(value['path']),
    dataUrl: readString(value['dataUrl'] ?? value['data_url']),
    width: readNumber(value['width']) ?? 0,
    height: readNumber(value['height']) ?? 0,
  };
}

function readSamples(value: unknown): DesignStyleSample[] {
  if (!Array.isArray(value)) return [];
  return value.map(readSample).filter((item): item is DesignStyleSample => item !== null);
}

function readSample(value: unknown): DesignStyleSample | null {
  if (!isRecord(value)) return null;
  const styles = isRecord(value['styles']) ? value['styles'] : {};
  return {
    role: readRole(value['role']),
    selector: readString(value['selector']) ?? '',
    viewport: value['viewport'] === 'mobile' ? 'mobile' : 'desktop',
    text: readString(value['text']),
    styles: Object.fromEntries(
      Object.entries(styles).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    ),
  };
}

function splitCommand(command: string): { file: string; args: string[] } {
  const [file, ...args] = command.trim().split(/\s+/);
  if (!file) {
    throw new Error('Dembrandt command is empty');
  }
  return { file, args };
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readRole(value: unknown): DesignStyleSample['role'] {
  const allowed = ['button', 'card', 'input', 'tag', 'heading', 'body', 'background', 'unknown'];
  return typeof value === 'string' && allowed.includes(value) ? value as DesignStyleSample['role'] : 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
