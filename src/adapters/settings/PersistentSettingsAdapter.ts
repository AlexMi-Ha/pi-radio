// src/adapters/settings/PersistentSettingsAdapter.ts

import fs from "fs";
import path from "path";
import { Settings, SettingsPort } from "../../core/ports/SettingsPort";
import { logger } from "../../core/util/Logger";

export class PersistentSettingsAdapter implements SettingsPort {
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || path.resolve(__dirname, "settings.json");
  }

  load(): Settings | undefined {
    if (!fs.existsSync(this.filePath)) {
      return undefined;
    }
    try {
      const data = fs.readFileSync(this.filePath, "utf-8");
      return JSON.parse(data) as Settings;
    } catch (err) {
      logger.warn("[Settings] Failed to read settings file, ignoring", err);
      return undefined;
    }
  }

  save(settings: Settings): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(settings, null, 2), "utf-8");
    } catch (err) {
      logger.error("[Settings] Failed to save settings to file:", err);
    }
  }
}
