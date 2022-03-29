#!/usr/bin/env zx

// -- base util

const apiCall = async (url, opt) => {
  let response = await fetch(url, opt);
  const data = await response.text();
  return data;
};

const outputDataToPipeline = async (key, val) => {
  // for azure pipeline
  $`echo ##vso[task.setvariable variable=${key}]${val}`;
  // for github action
  $`echo ::set-output name=${key}::${val}`;
};

const getFileContent = async ({ FILE_PATH, FILE_URL }) => {
  if (FILE_PATH) {
    return await fs.readFile(FILE_PATH, "utf8");
  } else if (FILE_URL) {
    const res = await fetch(FILE_URL);
    return res.text();
  } else {
    throw new Error("FILE_PATH or FILE_URL is not set.");
  }
};

const runRemoteScript = async (url, envs = []) => {
  const res = await $`zx ${url} ${["--quiet", ...envs]}`;
  return res.stdout.trim();
};

const readFile = async (pat, user, repo, { branch = "main", path } = {}) => {
  const url = `https://api.github.com/repos/${user}/${repo}/contents/${path}?ref=${branch}`;

  const opt = {
    headers: { Authorization: `token ${pat}` },
  };

  const data = await apiCall(url, opt);

  return JSON.parse(data);
};

const getGitHubFileContent = async (envs) => {
  const fileUrl = `https://raw.githubusercontent.com/Atg-Frontend/devops-scripts/main/get-github-private-repo-file.mjs`;
  //   const fileUrl = `${__dirname}/get-github-private-repo-file.mjs`;
  const res = await runRemoteScript(fileUrl, envs);
  return JSON.parse(res);
};

const checkArgv = async (argvArr) => {
  const fileUrl = `https://raw.githubusercontent.com/Atg-Frontend/devops-scripts/main/check-var.mjs`;
  //   const fileUrl = `${__dirname}/check-var.mjs`;
  const envs = argvArr.map(
    (arg) => `--${arg}=${argv[arg] ?? process.env[arg] ? 1 : 0}`
  );
  const res = await runRemoteScript(fileUrl, [
    `--checkArgv=${argvArr.join(",")}`,
    ...envs,
  ]);
};

const GITHUB_PAT = process.env.GITHUB_PAT || argv.GITHUB_PAT;
const GITHUB_URL = process.env.GITHUB_URL || argv.GITHUB_URL;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || argv.GITHUB_BRANCH || "main";
const FILE_PATH = process.env.FILE_PATH || argv.FILE_PATH;
const FILE_URL = process.env.FILE_URL || argv.FILE_URL;

await checkArgv(["GITHUB_PAT"]);

const { swagger } = JSON.parse(await getFileContent({ FILE_URL, FILE_PATH }));
if (!swagger) throw new Error("Cannot find key: swagger");

const baseUrl = `https://api.github.com/repos/atg-frontend/api-swagger-repos/contents/`;

const res = await Promise.all(
  Object.entries(swagger).map(async ([key, val]) => {
    const url = `${baseUrl}${val}?ref=${GITHUB_BRANCH}`;
    // const data = await getGitHubFileContent([
    //   `--GITHUB_URL=${url}`,
    //   `--GITHUB_PAT=${GITHUB_PAT}`,
    // ]);
    const data = await readFile(
      GITHUB_PAT,
      "atg-frontend",
      "api-swagger-repos",
      {
        path: val,
        branch: GITHUB_BRANCH,
      }
    );
    const { download_url } = data;
    await outputDataToPipeline(key, download_url);
    return {
      key,
      val: download_url,
    };
  })
);

// for build script
const azurePipelineScript = res
  .map(({ key, val }) => `"${key}=${val}"`)
  .join(" ");
outputDataToPipeline("AZURE_CICD_SCRIPT", azurePipelineScript);
