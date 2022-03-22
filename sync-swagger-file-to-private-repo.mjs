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

const apiCall = async (url, opt) => {
  let response = await fetch(url, opt);
  const data = await response.text();
  return data;
};

// -- github api

const getBranch = async (pat, user, repo, branch = "main") => {
  const url = `https://api.github.com/repos/${user}/${repo}/git/refs/heads/${branch}`;

  const opt = {
    headers: { Authorization: `token ${pat}` },
  };

  const data = await apiCall(url, opt);

  return JSON.parse(data);
};

const createBranch = async (pat, user, repo) => {
  // const url = `https://api.github.com/repos/${user}/${repo}/git/refs`

  const {
    object: { sha: shaMain },
  } = await getBranch(pat, user, repo, "main");

  return shaMain;
};

const readFile = async (pat, user, repo, { branch = "main", path } = {}) => {
  const url = `https://api.github.com/repos/${user}/${repo}/contents/${path}?ref=${branch}`;

  const opt = {
    headers: { Authorization: `token ${pat}` },
  };

  const data = await apiCall(url, opt);

  return JSON.parse(data);
};

const createFile = async (pat, user, repo, { branch, path, content } = {}) => {
  const { sha } = await readFile(pat, user, repo, { branch, path });
  console.log("sha", sha);

  const url = `https://api.github.com/repos/${user}/${repo}/contents/${path}`;

  const opt = {
    method: "PUT",
    headers: {
      Authorization: `token ${pat}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      branch,
      content: Buffer.from(content).toString("base64"),
      sha,
      message: "create file from auto script",
    }),
  };

  const data = await apiCall(url, opt);

  return JSON.parse(JSON.stringify(data));
};

const getSwaggerFile = async (url) => {
  const projectName = /atg-(.*?)-dev/g.exec(url)[1];
  const folderName = /swagger\/(.*?)\/swagger/g.exec(url)[1];
  const data = await apiCall(url);
  return {
    data,
    project: projectName.toLowerCase(),
    folder: folderName.toLowerCase(),
  };
};

// -- main
const main = async () => {
  const GITHUB_PAT = process.env.GITHUB_PAT || argv.GITHUB_PAT;
  const GITHUB_USER = process.env.GITHUB_USER || argv.GITHUB_USER;
  const GITHUB_REPO = process.env.GITHUB_REPO || argv.GITHUB_REPO;
  const GITHUB_BRANCH = process.env.GITHUB_BRANCH || argv.GITHUB_BRANCH;

  const SWAGGER_URL = process.env.SWAGGER_URL || argv.SWAGGER_URL;

  const { data, project, folder } = await getSwaggerFile(SWAGGER_URL);

  const res = await createFile(GITHUB_PAT, GITHUB_USER, GITHUB_REPO, {
    branch: GITHUB_BRANCH,
    path: `${project}/${folder}/swagger.json`,
    content: data,
  });

  return res;
};

await checkArgv([
  "GITHUB_PAT",
  "GITHUB_USER",
  "GITHUB_REPO",
  "GITHUB_BRANCH",
  "SWAGGER_URL",
]);
process.stdout.write(await main());
