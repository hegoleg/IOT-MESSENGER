import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const root = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const buildDir = join(root, "firmware", "examples", "quickstart", ".pio", "build");
const outDir = join(root, "landing", "public", "firmware");
const esp32Build = join(buildDir, "esp32dev");

const required = [
  join(buildDir, "nodemcuv2", "firmware.bin"),
  join(esp32Build, "bootloader.bin"),
  join(esp32Build, "partitions.bin"),
  join(esp32Build, "firmware.bin"),
];
for (const file of required) {
  if (!existsSync(file)) {
    throw new Error(`Missing ${file}. Run: pio run -e nodemcuv2 -e esp32dev`);
  }
}

const bootApp = join(
  homedir(),
  ".platformio",
  "packages",
  "framework-arduinoespressif32",
  "tools",
  "partitions",
  "boot_app0.bin",
);
if (!existsSync(bootApp)) {
  throw new Error("boot_app0.bin not found in the PlatformIO Arduino ESP32 package.");
}

const esptoolCandidates = [
  join(homedir(), ".platformio", "packages", "tool-esptool", "esptool.exe"),
  join(homedir(), ".platformio", "packages", "tool-esptool", "esptool"),
];
const esptool = esptoolCandidates.find((candidate) => existsSync(candidate));
if (!esptool) {
  throw new Error("esptool not found. Install the espressif32 PlatformIO platform.");
}

await mkdir(outDir, { recursive: true });

await copyFile(join(buildDir, "nodemcuv2", "firmware.bin"), join(outDir, "esp8266.bin"));
console.log("copied esp8266.bin");

// ESP-IDF v4+ needs a single merged image: the browser cannot patch flash
// mode/size the way esptool does during a normal upload.
execFileSync(
  esptool,
  [
    "--chip",
    "esp32",
    "merge-bin",
    "-o",
    join(outDir, "esp32-merged.bin"),
    "--flash-mode",
    "dio",
    "--flash-freq",
    "40m",
    "--flash-size",
    "4MB",
    "0x1000",
    join(esp32Build, "bootloader.bin"),
    "0x8000",
    join(esp32Build, "partitions.bin"),
    "0xe000",
    bootApp,
    "0x10000",
    join(esp32Build, "firmware.bin"),
  ],
  { cwd: esp32Build, stdio: "inherit" },
);
console.log("built esp32-merged.bin");

const manifest = {
  name: "IoT Messenger Quickstart",
  version: "0.1.0",
  new_install_prompt_erase: true,
  new_install_improv_wait_time: 0,
  builds: [
    {
      chipFamily: "ESP8266",
      parts: [{ path: "esp8266.bin", offset: 0 }],
    },
    {
      chipFamily: "ESP32",
      parts: [{ path: "esp32-merged.bin", offset: 0 }],
    },
  ],
};

await writeFile(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log("wrote manifest.json");
