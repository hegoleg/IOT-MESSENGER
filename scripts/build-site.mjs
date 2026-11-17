/**
 * Builds the deployable site: landing at / and the PWA at /app/.
 * Used by Netlify (see netlify.toml) and for local static previews.
 */
import { cpSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const npmCli = process.env.npm_execpath;

function run(args, env = {}) {
  const command = npmCli ? process.execPath : "npm";
  const commandArgs = npmCli ? [npmCli, ...args] : args;

  execFileSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    shell: !npmCli && process.platform === "win32",
    env: { ...process.env, ...env },
  });
}

run(["run", "build:landing"]);
run(["run", "build", "--workspace", "@iot/web-app"], { APP_BASE: "/app/" });

const target = join(root, "landing", "dist", "app");
rmSync(target, { recursive: true, force: true });
cpSync(join(root, "web-app", "dist"), target, { recursive: true });

console.log("PWA copied to landing/dist/app");
