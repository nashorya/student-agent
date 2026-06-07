/**
 * Hashline adapter module entry point.
 *
 * IMPORTANT: The Bun.hash polyfill MUST be imported first, before any
 * @oh-my-pi/hashline module is loaded, because hashline uses Bun.hash.xxHash32
 * at module level (via InMemorySnapshotStore -> computeFileHash) and will crash
 * in Node.js environments without the polyfill.
 */
import "./bun-polyfill.js";

export { StudentAgentFilesystem } from "./filesystem-adapter.js";
export { createHashlineStore, InMemorySnapshotStore } from "./store.js";
export { emitProtectedEvent, drainProtectedEvents } from "./event-emitter.js";
export { HASHLINE_PROMPT } from "./prompt-fragment.js";