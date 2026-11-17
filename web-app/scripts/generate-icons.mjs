import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const publicDir = new URL("../public/", import.meta.url);
const source = await readFile(new URL("icon.svg", publicDir));

const targets = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
];

for (const [name, size] of targets) {
  const target = fileURLToPath(new URL(name, publicDir));
  await sharp(source)
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(target);
  console.log(`generated public/${name} (${size}x${size})`);
}
