import fs from "fs";
import path from "path";
import type { HKEY, RegistryValue, RegistryStringEntry } from "registry-js";
import { Adapter } from "./adapter";
import { readdirSafe } from "./utils";
import { AppInfo } from "../reducers/app";

export class WinAdapter extends Adapter {
  async readApps() {
    const { HKEY, enumerateKeys, enumerateValues } = await import(
      "registry-js"
    ); // only on windows
    const enumRegeditItems = (key: HKEY, subkey: string) => {
      return enumerateKeys(key, subkey).map((k) =>
        enumerateValues(key, subkey + "\\" + k),
      );
    };

    const items = [
      ...enumRegeditItems(
        HKEY.HKEY_LOCAL_MACHINE,
        "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
      ),
      ...enumRegeditItems(
        HKEY.HKEY_LOCAL_MACHINE,
        "Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
      ),
      ...enumRegeditItems(
        HKEY.HKEY_CURRENT_USER,
        "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
      ),
    ];
    return Promise.all(
      items.map((itemValues) =>
        this.getAppInfoFromRegeditItemValues(itemValues),
      ),
    );
  }

  async readAppByPath(p: string) {
    if (path.extname(p).toLowerCase() != ".exe") return;

    return {
      id: p,
      name: path.basename(p, ".exe"),
      icon: "",
      exePath: p,
    };
  }

  private async getAppInfoByExePath(
    exePath: string,
    iconPath: string,
    values: readonly RegistryValue[],
  ): Promise<AppInfo> {
    const { RegistryValueType } = await import("registry-js");

    const displayName = values.find(
      (v): v is RegistryStringEntry =>
        v && v.type === RegistryValueType.REG_SZ && v.name === "DisplayName",
    );
    let icon = "";
    if (iconPath) {
      const iconBuffer = await fs.promises.readFile(iconPath);
      icon = "data:image/x-icon;base64," + iconBuffer.toString("base64");
    }
    return {
      id: exePath,
      name: displayName ? displayName.data : path.basename(exePath, ".exe"),
      icon: icon,
      exePath: exePath,
    };
  }

  private isElectronApp(installDir: string) {
    return (
      fs.existsSync(path.join(installDir, "resources")) &&
      ["electron.asar", "app.asar", "app.asar.unpacked"].some((file) =>
        fs.existsSync(path.join(installDir, "resources", file)),
      )
    );
  }

  private async findExeFile(dir: string) {
    if (this.isElectronApp(dir)) {
      const files = await readdirSafe(dir);
      const [exeFile] = files.filter((file) => {
        const lc = file.toLowerCase();
        return (
          lc.endsWith(".exe") &&
          !["uninstall", "update"].some((keyword) => lc.includes(keyword))
        );
      });
      if (exeFile) return path.join(dir, exeFile);
    }
  }

  private async getAppInfoFromRegeditItemValues(
    values: readonly RegistryValue[],
  ): Promise<AppInfo | undefined> {
    if (values.length === 0) return;

    let iconPath = "";

    // Try to find executable path of Electron app
    const { RegistryValueType } = await import("registry-js");

    const displayIcon = values.find(
      (v): v is RegistryStringEntry =>
        v && v.type === RegistryValueType.REG_SZ && v.name === "DisplayIcon",
    );

    if (displayIcon) {
      const [icon] = displayIcon.data.split(",");
      if (icon?.toLowerCase().endsWith(".exe")) {
        if (!this.isElectronApp(path.dirname(icon))) return;
        return this.getAppInfoByExePath(icon, iconPath, values);
      } else if (icon?.toLowerCase().endsWith(".ico")) {
        iconPath = icon;
      }
    }

    let installDir = "";

    const installLocation = values.find(
      (v): v is RegistryStringEntry =>
        v &&
        v.type === RegistryValueType.REG_SZ &&
        v.name === "InstallLocation",
    );

    if (installLocation && installLocation.data) {
      installDir = installLocation.data;
    } else if (iconPath) {
      installDir = path.dirname(iconPath);
    }

    if (!installDir) return;

    const exeFile = await this.findExeFile(installDir);
    if (exeFile) {
      return this.getAppInfoByExePath(exeFile, iconPath, values);
    } else {
      const files = await readdirSafe(installDir);
      const semverDir = files.find((file) => /\d+\.\d+\.\d+/.test(file));
      if (!semverDir) return;

      const exeFile = await this.findExeFile(path.join(installDir, semverDir));
      if (!exeFile) return;

      return this.getAppInfoByExePath(exeFile, iconPath, values);
    }
  }
}
