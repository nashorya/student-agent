import { Type } from '../pi-compat/index.js';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { Context7Client } from '../../knowledge/context7-client.js';

const NO_DOCS = 'No documentation available.';

interface Context7QueryInput {
  library: string;
  topic?: string;
}

const schema = Type.Object({
  library: Type.String({ description: 'Library name or Context7 library id to look up.' }),
  topic: Type.Optional(Type.String({ description: 'Optional topic or API focus within the library.' })),
});

export function createContext7QueryToolDefinition(options: {
  client?: Pick<Context7Client, 'query'>;
  onCall?: () => void;
  onFailure?: () => void;
} = {}) {
  const { client, onCall, onFailure } = options;

  return defineTool({
    name: 'context7_query',
    label: 'context7_query',
    description: 'Query Context7 documentation for a library (and optional topic). Use proactively when library API docs would help.',
    promptSnippet: 'Fetch library documentation from Context7',
    promptGuidelines: [
      'Call context7_query when you need accurate library/API documentation.',
      'If the tool returns "No documentation available.", continue without docs; do not retry endlessly.',
    ],
    parameters: schema,
    async execute(
      _toolCallId: string,
      params: Context7QueryInput,
    ): Promise<{ content: Array<{ type: 'text'; text: string }>; details: Record<string, unknown> }> {
      onCall?.();

      const degrade = () => {
        onFailure?.();
        return {
          content: [{ type: 'text' as const, text: NO_DOCS }],
          details: { ok: false },
        };
      };

      if (!client) {
        return degrade();
      }

      try {
        const docs = await client.query({
          libraryName: params.library,
          topic: params.topic,
        });
        const text = docs?.content?.trim();
        if (!docs || !text) {
          return degrade();
        }
        return {
          content: [{ type: 'text' as const, text }],
          details: {
            ok: true,
            libraryId: docs.libraryId,
            topic: docs.topic,
          },
        };
      } catch {
        return degrade();
      }
    },
  });
}
