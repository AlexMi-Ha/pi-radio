import fs from "fs";
import { configureFileLogging, logger } from "../../../src/core/util/Logger";

jest.mock("fs");

describe("Logger", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (fs.mkdirSync as jest.Mock).mockImplementation(() => undefined);
        (fs.statSync as jest.Mock).mockImplementation(() => {
            throw new Error("ENOENT");
        });
        (fs.existsSync as jest.Mock).mockReturnValue(false);
        (fs.appendFileSync as jest.Mock).mockImplementation(() => undefined);
        (fs.renameSync as jest.Mock).mockImplementation(() => undefined);
        (fs.rmSync as jest.Mock).mockImplementation(() => undefined);
        jest.spyOn(console, "log").mockImplementation(() => {});
        jest.spyOn(console, "error").mockImplementation(() => {});
        jest.spyOn(console, "warn").mockImplementation(() => {});
        jest.spyOn(console, "info").mockImplementation(() => {});
        // reset module-level state left over from a previous test
        configureFileLogging(false, "logs/pi-radio.log");
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test("always logs to console regardless of file logging", () => {
        logger.log("hello");

        expect(console.log).toHaveBeenCalledWith("hello");
        expect(fs.appendFileSync).not.toHaveBeenCalled();
    });

    test("does not write to a file when file logging is disabled", () => {
        logger.error("boom");

        expect(console.error).toHaveBeenCalledWith("boom");
        expect(fs.appendFileSync).not.toHaveBeenCalled();
    });

    test("appends to the log file when file logging is enabled", () => {
        configureFileLogging(true, "logs/pi-radio.log");
        logger.warn("careful");

        expect(fs.mkdirSync).toHaveBeenCalledWith("logs", { recursive: true });
        expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
        const [filePath, line] = (fs.appendFileSync as jest.Mock).mock.calls[0];
        expect(filePath).toBe("logs/pi-radio.log");
        expect(line).toContain("[WARN] careful");
    });

    test("does not rotate while under the size limit", () => {
        (fs.statSync as jest.Mock).mockReturnValue({ size: 100 });
        configureFileLogging(true, "logs/pi-radio.log", 1000, 3);

        logger.log("small");

        expect(fs.renameSync).not.toHaveBeenCalled();
        expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
    });

    test("rotates existing backups and the active file once the size limit is hit", () => {
        (fs.statSync as jest.Mock).mockReturnValue({ size: 2000 });
        (fs.existsSync as jest.Mock).mockImplementation((p: string) => p === "logs/pi-radio.log.1");
        configureFileLogging(true, "logs/pi-radio.log", 1000, 3);

        logger.log("too big");

        expect(fs.renameSync).toHaveBeenCalledWith("logs/pi-radio.log.1", "logs/pi-radio.log.2");
        expect(fs.renameSync).toHaveBeenCalledWith("logs/pi-radio.log", "logs/pi-radio.log.1");
        expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
    });

    test("drops the oldest backup beyond maxFiles", () => {
        (fs.statSync as jest.Mock).mockReturnValue({ size: 2000 });
        (fs.existsSync as jest.Mock).mockImplementation((p: string) => p === "logs/pi-radio.log.4");
        configureFileLogging(true, "logs/pi-radio.log", 1000, 3);

        logger.log("rotate again");

        expect(fs.rmSync).toHaveBeenCalledWith("logs/pi-radio.log.4");
    });
});
