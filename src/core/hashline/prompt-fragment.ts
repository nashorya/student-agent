/**
 * Hashline prompt fragment — injected into the agent system prompt so the
 * model understands the anchor format returned by the read tool and knows
 * how to use it in subsequent edit calls.
 *
 * This is a fixed constant.  The agent must not modify it.
 *
 * The description aligns with @oh-my-pi/hashline's prompt.md semantics:
 * - read returns line-number-prefixed content with a [PATH#TAG] header tag
 * - The tag is a short content hash that anchors edits to the exact version read
 * - Stale tags are rejected; the agent must re-read to get a fresh tag
 * - Within a session, hashline may attempt 3-way merge recovery on stale tags
 */

export const HASHLINE_PROMPT = `
## Hashline（文件锚点，必须遵守）

When you read a file, the output includes an anchor line at the end in the format \`¶PATH#TAG\` (e.g. \`¶src/config.ts#a3f1\`). This tag is a short content hash that binds to the exact version you just read.

When you later edit that file, the edit tool validates the tag against the current file content. If the file has not changed since your read, the edit proceeds. If the file has changed (stale tag), the edit is rejected and you MUST re-read the file to obtain a fresh tag before retrying.

Within a single session, the edit tool may attempt 3-way merge recovery on a stale tag: if the prior version is still cached, the edit is replayed against the current file content. If recovery succeeds, the edit applies; if recovery fails, the stale rejection stands and you must re-read.

Critical rules:
1. Every read of a file produces a fresh ¶PATH#TAG. Use the most recent tag for edits on that file.
2. On a stale-tag rejection, STOP and re-read the file. Never reuse a stale tag.
3. Line numbers in edit arguments refer to the ORIGINAL file as read (the version tagged by ¶PATH#TAG). They do not shift as edits apply.
4. If you receive a "Hashline: tag … is not recognised" error, re-read the file — the tag may be from a prior session.
` as const;