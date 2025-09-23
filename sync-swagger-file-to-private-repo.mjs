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

const getFileContent = async ({ FILE_PATH, FILE_URL }) => {
  if (FILE_PATH) {
    return await fs.readFile(FILE_PATH, "utf8");
  } else if (FILE_URL) {
    const res = await fetch(FILE_URL);
    if (res.status === 200) {
      return res.text();
    } else {
      console.error("[getFileContent]: ", `fetch ${FILE_URL} error`, {
        status: res.status,
        statusText: res.statusText,
      });
      return false;
    }
  } else {
    throw new Error("FILE_PATH or FILE_URL is not set.");
  }
};

// -- base util

const apiCall = async (url, opt) => {
  let response = await fetch(url, opt);
  const data = await response.text();
  return data;
};

// -- github api

const mergerBranch = async (pat, user, repo, { from, to, message }) => {
  const url = `https://api.github.com/repos/${user}/${repo}/merges`;

  const opt = {
    method: "POST",
    headers: {
      Authorization: `token ${pat}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      base: `refs/heads/${to}`,
      head: `refs/heads/${from}`,
      commit_message: message || "auto merge from CICD",
    }),
  };

  const data = await apiCall(url, opt);
  const jsonData = JSON.parse(data);

  return jsonData;
};

const getChangedCountByCommitId = async (pat, user, repo, commitId) => {
  const url = `https://api.github.com/repos/${user}/${repo}/commits/${commitId}`;

  const opt = {
    method: "GET",
    headers: {
      Authorization: `token ${pat}`,
      "Content-Type": "application/json",
    },
  };

  const data = await apiCall(url, opt);
  const jsonData = JSON.parse(data);

  return jsonData.files || [];
};

const getPullsByHeadBranchName = async ({
  pat,
  user,
  repo,
  state = "all",
  headBranch,
}) => {
  const url = `https://api.github.com/repos/${user}/${repo}/pulls?state=${state}&head=${user}:refs/heads/${headBranch}`;
  const res = await apiCall(url, {
    headers: {
      Authorization: `token ${pat}`,
    },
  });
  return JSON.parse(res);
};

const getAllPulls = async ({ pat, user, repo, state = "all", headBranch }) => {
  const url = `https://api.github.com/repos/${user}/${repo}/pulls?state=${state}`;
  const res = await apiCall(url, {
    headers: {
      Authorization: `token ${pat}`,
    },
  });
  return JSON.parse(res);
};

const closePullRequest = async ({ pat, user, repo, number }) => {
  const url = `https://api.github.com/repos/${user}/${repo}/pulls/${number}`;
  const res = await apiCall(url, {
    method: "PATCH",
    headers: {
      Authorization: `token ${pat}`,
    },
    body: JSON.stringify({
      state: "closed",
    }),
  });
  return JSON.parse(res);
};

const createPulls = async (pat, user, repo, { head, base, title }) => {
  const url = `https://api.github.com/repos/${user}/${repo}/pulls`;
  const opt = {
    method: "POST",
    headers: { Authorization: `token ${pat}` },
    body: JSON.stringify({
      head,
      base,
      title,
    }),
  };

  const data = await apiCall(url, opt);
  const { number } = JSON.parse(data);
  return number || false;
};

const requestReviewer2Pull = async (
  pat,
  user,
  repo,
  { pull_number, reviewers }
) => {
  const url = `https://api.github.com/repos/${user}/${repo}/pulls/${pull_number}/requested_reviewers`;
  const opt = {
    method: "POST",
    headers: { Authorization: `token ${pat}` },
    body: JSON.stringify({
      reviewers,
    }),
  };

  const data = await apiCall(url, opt);
  return data;
};

const removeBranch = async (pat, user, repo, { branch }) => {
  const url = `https://api.github.com/repos/${user}/${repo}/git/refs/heads/${branch}`;
  const opt = {
    method: "DELETE",
    headers: { Authorization: `token ${pat}` },
  };

  const data = await apiCall(url, opt);
  console.log("[removeBranch]: ", `${branch} branch was removed`);
  return data;
};

const getBranch = async (pat, user, repo, branch) => {
  const url = `https://api.github.com/repos/${user}/${repo}/git/refs/heads/${branch}`;

  const opt = {
    headers: { Authorization: `token ${pat}` },
  };

  const data = await apiCall(url, opt);

  return JSON.parse(data);
};

const createBranch = async (pat, user, repo, { branch, baseBranch }) => {
  // get base branch sha
  const {
    object: { sha: shaMain },
  } = await getBranch(pat, user, repo, baseBranch);

  const url = `https://api.github.com/repos/${user}/${repo}/git/refs`;
  const opt = {
    method: "POST",
    headers: { Authorization: `token ${pat}` },
    body: JSON.stringify({
      ref: `refs/heads/${branch}`,
      sha: shaMain,
    }),
  };

  // create branch
  const data = await apiCall(url, opt);
  const { ref } = JSON.parse(data);

  console.log(
    "[createBranch]: ",
    ref ? `create branch ${branch} success.` : `${branch} branch already exist`
  );

  return ref ? true : false;
};

const readFile = async (pat, user, repo, { branch = "main", path } = {}) => {
  const url = `https://api.github.com/repos/${user}/${repo}/contents/${path}?ref=${branch}`;

  const opt = {
    headers: { Authorization: `token ${pat}` },
  };

  const data = await apiCall(url, opt);

  return JSON.parse(data);
};

const createFile = async (
  pat,
  user,
  repo,
  { branch, path, content, commitMessage, baseBranch } = {}
) => {
  // read file first to get sha if exist
  const { sha } = await readFile(pat, user, repo, {
    branch,
    path,
  });

  const message = commitMessage;

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
      message,
    }),
  };

  const data = await apiCall(url, opt);

  const jsonData = JSON.parse(data);
  const newSha = jsonData?.content?.sha;

  // compare sha & new sha
  if (sha && newSha && sha === newSha) {
    console.log("[createFile]: ", `${path} is same as old content. skip`, {
      sha,
      newSha,
    });
    return false;
  } else {
    // if sha was diff, check the line change
    // bypass line change is 2  >>  "version": "1.2.0-5 | 1.2"
    if (!jsonData?.commit?.sha) return true;

    const fileChangeList = await getChangedCountByCommitId(
      pat,
      user,
      repo,
      jsonData?.commit?.sha
    );
    if (fileChangeList.length === 1) {
      const { additions, deletions } = fileChangeList[0];
      if (additions === 1 && deletions === 1) {
        console.log(
          "[createFile]: ",
          `${path} new content contains version change only. process auto merge`
        );
        await mergerBranch(pat, user, repo, {
          from: branch,
          to: baseBranch,
          message: `auto merge ${commitMessage}`,
        });
        return false;
      }
    }

    return true;
  }
};

const getSwagger = async ({ url, file, urlOpt = {} }) => {
  if (url) {
    if (typeof url === "string") {
      url = {
        url,
        keyRegEx: "atg-(.*?)-dev",
        verRegEx: "swagger/(.*?)/swagger",
        ...urlOpt,
      };
    }

    let data;
    try {
      data = await getFileContent({ FILE_URL: url.url });
    } catch (error) {
      console.error("[getSwagger]: ", `fetch ${url.url} error`, { error });
    }
    if (!data) {
      console.error("[getSwagger]: ", `fetch ${url.url} no data`);
      return [{}];
    } else {
      console.log("[getSwagger]: ", `fetch ${url.url} success`);
    }

    const projectName =
      new RegExp(url.keyRegEx).exec(url.url)?.[1] || "notfound";
    const folderName = new RegExp(url.verRegEx).exec(url.url)?.[1] || "0.0";
    return [
      {
        project: projectName.toLowerCase(),
        folder: folderName.toLowerCase(),
        data,
        url: url.url,
      },
    ];
  } else if (file) {
    const res = await getFileContent({ FILE_PATH: file });
    if (!res) return [{}];

    const { atgList } = JSON.parse(res);
    const output = await Promise.all(
      atgList
        .map((item) => {
          return getSwagger({
            url: item.url,
            urlOpt: {
              keyRegEx: item.keyRegEx,
              verRegEx: item.verRegEx,
            },
          });
        })
        .flat()
    );

    return output.flat();
  } else {
    return [];
  }
};

const evtCloseOpeningPR = async ({ pat, user, repo, commitKey }) => {
  // check if there was older version is PR-ing and close it if yes
  const prList = await getAllPulls({
    pat,
    user,
    repo,
    state: "open",
  });
  if (!prList.length) return;

  // find by title
  const avaPrList = prList.filter((f) => f.title.indexOf(commitKey) !== -1);
  if (!avaPrList.length) return;

  return Promise.all(
    avaPrList.map((pr) => {
      const { number } = pr;
      console.log("[closeOpeningPR]: ", number);
      return closePullRequest({
        pat,
        user,
        repo,
        number,
      });
    })
  );
};

// -- main
const main = async () => {
  const GITHUB_PAT = process.env.GITHUB_PAT || argv.GITHUB_PAT;
  const GITHUB_USER = process.env.GITHUB_USER || argv.GITHUB_USER;
  const GITHUB_REPO = process.env.GITHUB_REPO || argv.GITHUB_REPO;
  const GITHUB_BRANCH =
    process.env.GITHUB_BRANCH || argv.GITHUB_BRANCH || `swaggerbot`;

  const GITHUB_BRANCH_BASE =
    process.env.GITHUB_BRANCH_BASE || argv.GITHUB_BRANCH_BASE || "main";

  const GITHUB_REVIEWERS =
    process.env.GITHUB_REVIEWERS || argv.GITHUB_REVIEWERS;

  const SWAGGER_URL = process.env.SWAGGER_URL || argv.SWAGGER_URL;
  const SWAGGER_FILE = process.env.SWAGGER_FILE || argv.SWAGGER_FILE;

  if (!SWAGGER_URL && !SWAGGER_FILE) {
    throw new Error("SWAGGER_URL or SWAGGER_FILE is required");
  }

  const serverIP = (await $`curl ifconfig.io`).stdout.trim();

  const listRes = await getSwagger({
    url: SWAGGER_URL,
    file: SWAGGER_FILE,
  });

  const logRes = listRes.map((item) => {
    const { project, folder, url } = item;
    return { project, folder, url };
  });
  console.log("[getSwagger]: ", { serverIP, listRes: logRes });

  // create a file for each project
  await Promise.all(
    listRes.map(async (item) => {
      const { data, project, folder, url } = item;
      if (!data) return;

      let parseData = {};
      try {
        parseData = JSON.parse(data);
      } catch (error) {
        console.error("[parseData]: ", {
          serverIP,
          url,
          project,
          folder,
          error,
          data,
        });
      }

      let {
        info: { version },
      } = parseData;

      if (!version) return;
      // trim version, e.g  "1.0.0-16 | 1.0"
      version = version.split(" ")[0].trim();

      // create branch
      const newBranchName = `${GITHUB_BRANCH}/${project}/${folder}/${version}`;
      await createBranch(GITHUB_PAT, GITHUB_USER, GITHUB_REPO, {
        branch: newBranchName,
        baseBranch: GITHUB_BRANCH_BASE,
      });

      const commitKey = `${project}/${folder}`;
      const commitMessage = `build: bump ${commitKey} to ${version}`;

      // create or update file
      const fileRes = await createFile(GITHUB_PAT, GITHUB_USER, GITHUB_REPO, {
        branch: newBranchName,
        baseBranch: GITHUB_BRANCH_BASE,
        path: `${project}/${folder}/swagger.json`,
        content: data,
        commitMessage,
      });

      // remove branch if file created or content keep same
      if (!fileRes) {
        // check current branch was pull request before
        const prList = await getPullsByHeadBranchName({
          pat: GITHUB_PAT,
          user: GITHUB_USER,
          repo: GITHUB_REPO,
          headBranch: newBranchName,
          state: "all",
        });
        // just skip ALL flow if PR before
        if (prList.length) return;

        // remove branch if no PR before
        await removeBranch(GITHUB_PAT, GITHUB_USER, GITHUB_REPO, {
          branch: newBranchName,
        });
        return;
      }

      // close older PR
      await evtCloseOpeningPR({
        pat: GITHUB_PAT,
        user: GITHUB_USER,
        repo: GITHUB_REPO,
        commitKey,
      });

      // create PR
      console.log("[create PR]: ", newBranchName);
      const pull_number = await createPulls(
        GITHUB_PAT,
        GITHUB_USER,
        GITHUB_REPO,
        {
          head: newBranchName,
          base: GITHUB_BRANCH_BASE,
          title: commitMessage,
        }
      );

      // assign reviewers
      if (pull_number && GITHUB_REVIEWERS) {
        await requestReviewer2Pull(GITHUB_PAT, GITHUB_USER, GITHUB_REPO, {
          reviewers: (GITHUB_REVIEWERS || "").split("|"),
          pull_number,
        });
      }
    })
  );

  return "ok";
};

await checkArgv(["GITHUB_PAT", "GITHUB_USER", "GITHUB_REPO"]);
process.stdout.write(await main());
