import { InMemorySnapshotStore } from "@oh-my-pi/hashline";

/** Default configuration matching the Hashline design v0.34 spec. */
const DEFAULT_OPTIONS = {
    maxPaths: 30,
    maxVersionsPerPath: 4,
} as const;

/**
 * Create a fresh InMemorySnapshotStore wired to the v0.34 spec defaults:
 * - maxPaths: 30 (LRU eviction when exceeded)
 * - maxVersionsPerPath: 4 (oldest version dropped first per path)
 *
 * Callers may override the defaults by passing a partial options object.
 */
export function createHashlineStore(
    overrides?: { maxPaths?: number; maxVersionsPerPath?: number },
): InMemorySnapshotStore {
    return new InMemorySnapshotStore({
        maxPaths: overrides?.maxPaths ?? DEFAULT_OPTIONS.maxPaths,
        maxVersionsPerPath:
            overrides?.maxVersionsPerPath ?? DEFAULT_OPTIONS.maxVersionsPerPath,
    });
}

export { InMemorySnapshotStore };