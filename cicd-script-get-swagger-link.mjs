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
  try {
    if (FILE_PATH) {
      return await fs.readFile(FILE_PATH, "utf8");
    } else if (FILE_URL) {
      const res = await fetch(FILE_URL);
      return res.text();
    } else {
      throw new Error("FILE_PATH or FILE_URL is not set.");
    }
  } catch (error) {
    return false;
  }
};

const runRemoteScript = async (url, envs = []) => {
  const res = await $`zx ${url} ${["--quiet", ...envs]}`;
  return res.stdout.trim();
};

const downloadGithubFile = async (
  pat,
  user,
  repo,
  { branch = "main", path } = {}
) => {
  const url = `https://api.github.com/repos/${user}/${repo}/contents/${path}?ref=${branch}`;

  const opt = {
    headers: {
      Authorization: `token ${pat}`,
      Accept: "application/vnd.github.v3.raw",
    },
  };

  const data = await apiCall(url, opt);

  return data;
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

const loadOrFetchSwaggerFile = async ({
  swaggerPath,
  swaggerKey,
  githubPAT,
  githubUser,
  githubRepo,
  githubBranch,
  githubPath,
}) => {
  // check if swagger.json found at swagger path
  const filePath = `${swaggerPath}/${swaggerKey}.json`;
  const isFound = await getFileContent({ FILE_PATH: filePath });
  if (!isFound) {
    // get swagger.json from github
    const dataSwagger = await downloadGithubFile(
      githubPAT,
      githubUser,
      githubRepo,
      {
        path: githubPath,
        branch: githubBranch,
      }
    );
    if (!dataSwagger) throw new Error("swagger.json not found in github.");

    // write swagger.json to local
    await fs.writeFile(filePath, dataSwagger, "utf8");
  }

  return [swaggerKey, filePath];
};

const pushCodeToRemote = async ({ fileArr, remoteBranch, allowPrefixArr }) => {
  const isAllow = allowPrefixArr.find((prefix) =>
    remoteBranch.includes(prefix)
  );
  if (!isAllow) {
    console.log("skip to push code to remote");
    return;
  }
  // set git user and email
  await $`git config --global user.name "ZX_USER"`;
  await $`git config --global user.email "ZX_USER@atg.ai"`;

  // checkout branch
  await $`git checkout ${remoteBranch.replace("refs/heads/", "")}`;

  // git add spec files
  for (let index = 0; index < fileArr.length; index++) {
    const [, filePath] = fileArr[index];
    await $`git add ${filePath}`;
  }
  await $`git diff-index --quiet HEAD || git commit -m "update swagger.json [skip ci]"`;

  await $`git diff-index --quiet HEAD || git push`;
};

const GITHUB_PAT = process.env.GITHUB_PAT || argv.GITHUB_PAT;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || argv.GITHUB_BRANCH || "main";
const FILE_PATH = process.env.FILE_PATH || argv.FILE_PATH;
const FILE_URL = process.env.FILE_URL || argv.FILE_URL;

const REMOTE_PUSH_BRANCH =
  process.env.REMOTE_PUSH_BRANCH || argv.REMOTE_PUSH_BRANCH;

const REMOTE_PUSH_BRANCH_ALLOW_PREFIX_ARR = process.env
  .REMOTE_PUSH_BRANCH_ALLOW_PREFIX_ARR ||
  argv.REMOTE_PUSH_BRANCH_ALLOW_PREFIX_ARR || ["uat/", "prd/"];

await checkArgv(["GITHUB_PAT"]);

const { swagger } = JSON.parse(await getFileContent({ FILE_URL, FILE_PATH }));
if (!swagger) throw new Error("Cannot find key: swagger");

// create swagger dir if not exists
let swaggerPath = "swagger";
await $`mkdir -p ${swaggerPath}`;
swaggerPath = `./${swaggerPath}`;

const fileArr = await Promise.all(
  Object.entries(swagger).map(([key, val]) => {
    return loadOrFetchSwaggerFile({
      swaggerPath: swaggerPath,
      swaggerKey: key,
      githubPath: val,
      githubPAT: GITHUB_PAT,
      githubUser: "atg-frontend",
      githubRepo: "api-swagger-repos",
      githubBranch: GITHUB_BRANCH,
    });
  })
);

if (REMOTE_PUSH_BRANCH)
  await pushCodeToRemote({
    fileArr,
    remoteBranch: REMOTE_PUSH_BRANCH,
    allowPrefixArr: REMOTE_PUSH_BRANCH_ALLOW_PREFIX_ARR,
  });

// write output to pipeline
await Promise.all(
  Object.entries(fileArr).map(([key, val]) => {
    return outputDataToPipeline(key, val);
  })
);

// for build script
const azurePipelineScript = fileArr
  .map(([key, val]) => `"${key}=${val}"`)
  .join(" ");

outputDataToPipeline("AZURE_CICD_SCRIPT", azurePipelineScript);
