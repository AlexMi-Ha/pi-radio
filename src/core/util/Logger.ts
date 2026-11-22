import fs from "fs";
import path from "path";

type LogLevel = "log" | "info" | "warn" | "error";

interface FileLoggingConfig {
    filePath: string;
    maxFileSizeBytes: number;
    maxFiles: number;
}

const DEFAULT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const DEFAULT_MAX_FILES = 3; // rotated backups kept alongside the active file (<filePath>.1 .. .<maxFiles>)

let fileLoggingConfig: FileLoggingConfig | undefined;

/**
 * Enables or disables mirroring log output to a file, in addition to the console.
 * Called once at startup from src/index.ts based on PI_RADIO_LOG_TO_FILE /
 * PI_RADIO_LOG_FILE_PATH env vars. The file is capped at maxFileSizeBytes and
 * rotated (keeping up to maxFiles old copies) so logs don't grow unbounded.
 */
export function configureFileLogging(
    enabled: boolean,
    filePath: string,
    maxFileSizeBytes: number = DEFAULT_MAX_FILE_SIZE_BYTES,
    maxFiles: number = DEFAULT_MAX_FILES
): void {
    if (!enabled) {
        fileLoggingConfig = undefined;
        return;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fileLoggingConfig = { filePath, maxFileSizeBytes, maxFiles };
}

function rotateIfNeeded(config: FileLoggingConfig): void {
    let size: number;
    try {
        size = fs.statSync(config.filePath).size;
    } catch {
        return; // file doesn't exist yet, nothing to rotate
    }
    if (size < config.maxFileSizeBytes) return;

    for (let i = config.maxFiles - 1; i >= 1; i--) {
        const src = `${config.filePath}.${i}`;
        if (fs.existsSync(src)) {
            fs.renameSync(src, `${config.filePath}.${i + 1}`);
        }
    }
    fs.renameSync(config.filePath, `${config.filePath}.1`);

    const overflow = `${config.filePath}.${config.maxFiles + 1}`;
    if (fs.existsSync(overflow)) {
        fs.rmSync(overflow);
    }
}

function formatArgs(args: unknown[]): string {
    return args
        .map((arg) => {
            if (arg instanceof Error) return arg.stack ?? arg.message;
            if (typeof arg === "string") return arg;
            try {
                return JSON.stringify(arg);
            } catch {
                return String(arg);
            }
        })
        .join(" ");
}

function write(level: LogLevel, args: unknown[]): void {
    console[level](...args);
    if (!fileLoggingConfig) return;

    rotateIfNeeded(fileLoggingConfig);
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${formatArgs(args)}\n`;
    fs.appendFileSync(fileLoggingConfig.filePath, line);
}

export const logger = {
    log: (...args: unknown[]): void => write("log", args),
    info: (...args: unknown[]): void => write("info", args),
    warn: (...args: unknown[]): void => write("warn", args),
    error: (...args: unknown[]): void => write("error", args),
};
