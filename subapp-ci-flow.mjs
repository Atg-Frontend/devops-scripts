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

const getAppVersion = async (path) => {
  path = path || "package.json";
  const file = await fs.readFile(path, "utf8");
  const data = JSON.parse(file);
  const { version } = data;
  if (!version) {
    throw new Error(`version is not found.`);
  }
  const appVersion = version.split(".").join("_");
  return { appVersion, version };
};

const modifyPublicPath = async ({ path, key, val }) => {
  path = path || "vue.config.js";
  let fileStr = await fs.readFile(path, "utf8");
  // replace key
  fileStr = fileStr.replace(key, `"${val}/"`);
  // save file
  await fs.writeFile(path, fileStr);
};

// -- main
const main = async () => {
  const APP_DOMAIN = process.env.APP_DOMAIN || argv.APP_DOMAIN;
  const APP_PATH = process.env.APP_PATH || argv.APP_PATH;
  const APP_BUILD_VERSION =
    process.env.APP_BUILD_VERSION || argv.APP_BUILD_VERSION;
  const APP_ENV = process.env.APP_ENV || argv.APP_ENV;
  const APP_NO_VERSION = process.env.APP_NO_VERSION || argv.APP_NO_VERSION;

  const APP_CICD_PATH =
    process.env.APP_CICD_PATH || argv.APP_CICD_PATH || "public/cicd.json";

  const WEBPACK_FILE_PATH =
    process.env.WEBPACK_FILE_PATH || argv.WEBPACK_FILE_PATH;
  const WEBPACK_REPLACE_KEY =
    process.env.WEBPACK_REPLACE_KEY || argv.WEBPACK_REPLACE_KEY;
  const PACKAGE_FILE_PATH =
    process.env.PACKAGE_FILE_PATH || argv.PACKAGE_FILE_PATH;

  // get app version
  const { appVersion, version } = await getAppVersion(PACKAGE_FILE_PATH);

  // build paths
  // APP_PATH: "/" for base-app, non "/" for sub-app
  const indexPath = `${APP_PATH === "/" ? APP_PATH : APP_PATH + "/"}${APP_ENV}`;
  // APP_NO_VERSION for non env app deployment
  const assetPath = APP_NO_VERSION
    ? `${indexPath}`
    : `${indexPath}/v/${appVersion}.${APP_BUILD_VERSION}`;
  const latestPath = assetPath ? `${indexPath}/v/latest` : "";
  const publicPath = `${APP_DOMAIN}${assetPath}`;

  // change webpack config: publicPath
  await modifyPublicPath({
    path: WEBPACK_FILE_PATH,
    key: WEBPACK_REPLACE_KEY,
    val: publicPath,
  });

  const output = {
    publicPath,
    assetPath,
    indexPath,
    latestPath,
    version,
    APP_DOMAIN,
    APP_PATH,
    APP_BUILD_VERSION,
    APP_ENV,
    APP_VERSION: appVersion,
  };

  // save output for CD flow
  await fs.writeFile(APP_CICD_PATH, JSON.stringify(output));

  return "ok";
};

await checkArgv([
  "APP_DOMAIN",
  "APP_PATH",
  "APP_BUILD_VERSION",
  "APP_ENV",
  "WEBPACK_FILE_PATH",
  "WEBPACK_REPLACE_KEY",
]);
process.stdout.write(await main());
