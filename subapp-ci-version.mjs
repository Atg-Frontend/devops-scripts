#!/usr/bin/env zx

// -- base helper

const runRemoteScript = async (url, envs = []) => {
  const res = await $`zx ${url} ${["--quiet", ...envs]}`;
  return res.stdout.trim();
};

const checkArgv = async (argvArr) => {
  const fileUrl = `https://raw.githubusercontent.com/Atg-Frontend/devops-scripts/main/check-var.mjs`;
  const envs = argvArr.map(
    (arg) => `--${arg}=${argv[arg] ?? process.env[arg] ? 1 : 0}`
  );
  await runRemoteScript(fileUrl, [`--checkArgv=${argvArr.join(",")}`, ...envs]);
};

// -- base util

// -- mod api

// -- main
const main = async () => {
  const APP_FILE_PATH =
    process.env.APP_FILE_PATH || argv.APP_FILE_PATH || "public/app-config.json";
  const APP_VERSION = process.env.APP_VERSION || argv.APP_VERSION;

  // read file by file path
  const file = await fs.readFile(APP_FILE_PATH, "utf8");
  // parse json
  const data = JSON.parse(file);
  // change version
  data.version = APP_VERSION;
  // write file
  await fs.writeFile(APP_FILE_PATH, JSON.stringify(data, null, 2));

  return "ok";
};

await checkArgv(["APP_VERSION"]);
process.stdout.write(await main());
