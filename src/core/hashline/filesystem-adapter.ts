import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Filesystem, NotFoundError, WriteResult } from "@oh-my-pi/hashline";
import { WriteQueue } from "../write-queue.js";

/**
 * StudentAgentFilesystem adapts Hashline's abstract Filesystem to the
 * Student Agent's project directory and serialised write pipeline.
 *
 * - readText resolves paths relative to `cwd` and reads via node:fs/promises.
 * - writeText routes through WriteQueue so all disk writes are serialised
 *   and never conflict with other async file mutations.
 */
export class StudentAgentFilesystem extends Filesystem {
    private readonly cwd: string;

    constructor(cwd: string) {
        super();
        this.cwd = cwd;
    }

    override async readText(path: string): Promise<string> {
        const absolute = resolve(this.cwd, path);
        try {
            return await readFile(absolute, { encoding: "utf-8" });
        } catch (err: unknown) {
            if (isEnoent(err)) {
                throw new NotFoundError(absolute, err);
            }
            throw err;
        }
    }

    override async writeText(path: string, content: string): Promise<WriteResult> {
        const absolute = resolve(this.cwd, path);
        const queue = WriteQueue.getInstance();
        const written = await queue.enqueue(async () => {
            await writeFile(absolute, content, { encoding: "utf-8" });
            return content;
        });
        return { text: written };
    }

    override canonicalPath(path: string): string {
        return resolve(this.cwd, path);
    }
}

/** Check whether an error is ENOENT (file-not-found). */
function isEnoent(err: unknown): boolean {
    if (err !== null && typeof err === "object" && "code" in err) {
        return (err as NodeJS.ErrnoException).code === "ENOENT";
    }
    return false;
}