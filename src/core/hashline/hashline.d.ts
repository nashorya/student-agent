/**
 * Ambient module declarations for @oh-my-pi/hashline.
 *
 * The published package's .d.ts barrel uses extensionless re-exports
 * (`export * from "./fs"`) which TypeScript 5.x in NodeNext ESM mode
 * cannot resolve.  This declaration file provides the minimum type
 * information needed by src/core/hashline/ and the tool integration layer
 * so the compiler can type-check without modifying the installed package.
 *
 * IMPORTANT: Only symbols actually used are declared.
 * If additional hashline APIs are needed later, extend this file.
 */

declare module "@oh-my-pi/hashline" {

    // --- fs.d.ts ---

    export interface WriteResult {
        text: string;
    }

    export class NotFoundError extends Error {
        readonly code: "ENOENT";
        constructor(path: string, cause?: unknown);
    }

    export function isNotFound(error: unknown): boolean;

    export abstract class Filesystem {
        abstract readText(path: string): Promise<string>;
        preflightWrite(_path: string): Promise<void>;
        abstract writeText(path: string, content: string): Promise<WriteResult>;
        exists(path: string): Promise<boolean>;
        canonicalPath(path: string): string;
    }

    // --- snapshots.d.ts ---

    export interface Snapshot {
        readonly path: string;
        readonly text: string;
        readonly hash: string;
        recordedAt: number;
    }

    export abstract class SnapshotStore {
        abstract head(path: string): Snapshot | null;
        abstract byHash(path: string, hash: string): Snapshot | null;
        abstract record(path: string, fullText: string): string;
        abstract invalidate(path: string): void;
        abstract clear(): void;
    }

    export interface InMemorySnapshotStoreOptions {
        maxPaths?: number;
        maxVersionsPerPath?: number;
    }

    export class InMemorySnapshotStore extends SnapshotStore {
        constructor(options?: InMemorySnapshotStoreOptions);
        head(path: string): Snapshot | null;
        byHash(path: string, hash: string): Snapshot | null;
        record(path: string, fullText: string): string;
        invalidate(path: string): void;
        clear(): void;
    }

    // --- input.d.ts ---

    export interface SplitOptions {
        cwd?: string;
        path?: string;
    }

    export class PatchSection {
        readonly path: string;
        readonly fileHash: string | undefined;
        readonly diff: string;
        constructor(raw: { path: string; fileHash?: string; diff: string });
        parse(): { edits: Edit[]; warnings: readonly string[] };
        get edits(): readonly Edit[];
        get warnings(): readonly string[];
        get hasAnchorScopedEdit(): boolean;
        collectAnchorLines(): readonly number[];
        applyTo(text: string, blockResolver?: BlockResolver): ApplyResult;
    }

    export class Patch {
        readonly sections: readonly PatchSection[];
        static parse(input: string, options?: SplitOptions): Patch;
        static parseSingle(input: string, options?: SplitOptions): PatchSection;
    }

    // --- types.d.ts ---

    export interface Anchor {
        line: number;
    }

    export type Edit =
        | { kind: "insert"; cursor: unknown; text: string; lineNum: number; index: number; mode?: "replacement" }
        | { kind: "delete"; anchor: Anchor; lineNum: number; index: number; oldAssertion?: string }
        | { kind: "block"; anchor: Anchor; payloads: string[]; lineNum: number; index: number };

    export interface ApplyResult {
        text: string;
        firstChangedLine?: number;
        warnings?: string[];
    }

    export type BlockResolver = (request: {
        path: string;
        text: string;
        line: number;
    }) => { start: number; end: number } | null;

    // --- patcher.d.ts ---

    export interface PatcherOptions {
        fs: Filesystem;
        snapshots: SnapshotStore;
        blockResolver?: BlockResolver;
    }

    export interface PatchSectionResult {
        path: string;
        canonicalPath: string;
        op: "create" | "update" | "noop";
        before: string;
        after: string;
        persisted: string;
        written: string;
        fileHash: string;
        header: string;
        firstChangedLine?: number;
        warnings: string[];
    }

    export interface PatcherApplyResult {
        sections: PatchSectionResult[];
    }

    export declare class PreparedSection {
        readonly section: PatchSection;
        readonly canonicalPath: string;
        readonly exists: boolean;
        readonly rawContent: string;
        readonly bom: string;
        readonly lineEnding: string;
        readonly normalized: string;
        readonly applyResult: ApplyResult;
        readonly parseWarnings: readonly string[];
        get isNoop(): boolean;
    }

    export declare class Patcher {
        readonly fs: Filesystem;
        readonly snapshots: SnapshotStore;
        readonly recovery: Recovery;
        readonly blockResolver: BlockResolver | undefined;
        constructor(options: PatcherOptions);
        apply(patch: Patch): Promise<PatcherApplyResult>;
        preflight(patch: Patch): Promise<void>;
        prepare(section: PatchSection): Promise<PreparedSection>;
        commit(prepared: PreparedSection): Promise<PatchSectionResult>;
    }

    // --- mismatch.d.ts ---

    export interface MismatchDetails {
        path?: string;
        expectedFileHash: string;
        actualFileHash: string;
        fileLines: string[];
        anchorLines?: readonly number[];
        hashRecognized?: boolean;
    }

    export declare class MismatchError extends Error {
        readonly path: string | undefined;
        readonly expectedFileHash: string;
        readonly actualFileHash: string;
        readonly fileLines: string[];
        readonly anchorLines: number[];
        readonly hashRecognized: boolean;
        constructor(details: MismatchDetails);
        get displayMessage(): string;
    }

    // --- recovery.d.ts ---

    export interface RecoveryArgs {
        path: string;
        currentText: string;
        fileHash: string;
        edits: readonly Edit[];
    }

    export interface RecoveryResult {
        text: string;
        firstChangedLine: number | undefined;
        warnings: string[];
    }

    export declare class Recovery {
        readonly store: SnapshotStore;
        constructor(store: SnapshotStore);
        tryRecover(args: RecoveryArgs): RecoveryResult | null;
    }
}