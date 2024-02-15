import { readdirSafe, readFileAsBufferSafe } from "../main/utils";
import type { AppReader } from "./utils";
import fs from "fs";
import path from "path";
import plist from "simple-plist";

interface MacosAppInfo {
  CFBundleIdentifier: string;
  CFBundleName: string;
  CFBundleExecutable: string;
  CFBundleIconFile: string;
}

async function readPlistFile(path: string) {
  return new Promise<MacosAppInfo>((resolve, reject) => {
    plist.readFile<MacosAppInfo>(path, (error, data) => {
      // console.log(error, data)

      if (error || !data) {
        reject(error);
      } else {
        resolve(data);
      }
    });
  });
}

async function readIcnsAsImageUri(file: string) {
  let buf = await readFileAsBufferSafe(file);
  if (!buf) return "";

  const totalSize = buf.readInt32BE(4) - 8;
  buf = buf.subarray(8);

  const icons = [];

  let start = 0;
  while (start < totalSize) {
    const type = buf.subarray(start, start + 4).toString();
    const size = buf.readInt32BE(start + 4);
    const data = buf.subarray(start + 8, start + size);

    icons.push({ type, size, data });
    start += size;
  }

  icons.sort((a, b) => b.size - a.size);
  const imageData = icons[0]?.data;
  if (imageData?.subarray(1, 4).toString() === "PNG") {
    return "data:image/png;base64," + imageData.toString("base64");
  }

  // TODO: other image type
  return "";
}

export const adapter: AppReader = {
  async readAll() {
    const dir = "/Applications";
    const appPaths = await readdirSafe(dir);
    return Promise.all(appPaths.map((p) => this.readByPath(path.join(dir, p))));
  },
  async readByPath(p: string) {
    const isElectronBased = fs.existsSync(
      path.join(p, "Contents/Frameworks/Electron Framework.framework"),
    );
    if (!isElectronBased) return;

    const info = await readPlistFile(path.join(p, "Contents/Info.plist"));

    const icon = await readIcnsAsImageUri(
      path.join(p, "Contents/Resources", info.CFBundleIconFile),
    );

    return {
      id: info.CFBundleIdentifier,
      name: info.CFBundleName,
      icon,
      exePath: path.resolve(p, "Contents/MacOS", info.CFBundleExecutable),
    };
  },
};
