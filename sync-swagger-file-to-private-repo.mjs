#!/usr/bin/env zx

// -- Logger utility

class Logger {
  constructor(options = {}) {
    this.enableTimestamp = options.enableTimestamp ?? true;
    this.enableStructured = options.enableStructured ?? false;
    this.context = options.context || {};
  }

  _formatMessage(level, tag, message, meta = {}) {
    const timestamp = this.enableTimestamp ? new Date().toISOString() : null;

    if (this.enableStructured) {
      return JSON.stringify({
        timestamp,
        level,
        tag,
        message,
        ...this.context,
        ...meta,
      });
    }

    const parts = [];
    if (timestamp) parts.push(`[${timestamp}]`);
    parts.push(`[${level.toUpperCase()}]`);
    if (tag) parts.push(`[${tag}]`);
    parts.push(message);

    if (Object.keys(meta).length > 0) {
      parts.push(JSON.stringify(meta, null, 2));
    }

    return parts.join(" ");
  }

  debug(tag, message, meta) {
    if (process.env.DEBUG || process.env.LOG_LEVEL === "debug") {
      console.log(this._formatMessage("debug", tag, message, meta));
    }
  }

  info(tag, message, meta) {
    console.log(this._formatMessage("info", tag, message, meta));
  }

  warn(tag, message, meta) {
    console.warn(this._formatMessage("warn", tag, message, meta));
  }

  error(tag, message, meta) {
    console.error(this._formatMessage("error", tag, message, meta));
  }

  withContext(context) {
    return new Logger({
      enableTimestamp: this.enableTimestamp,
      enableStructured: this.enableStructured,
      context: { ...this.context, ...context },
    });
  }
}

const logger = new Logger({
  enableStructured: process.env.LOG_FORMAT === "json",
});

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

const getFileContent = async ({
  FILE_PATH,
  FILE_URL,
  opt = { reponseType: "text" },
}) => {
  const tag = "getFileContent";

  if (FILE_PATH) {
    try {
      logger.debug(tag, `Reading file from path`, { FILE_PATH });
      const content = await fs.readFile(FILE_PATH, "utf8");
      logger.debug(tag, `File read successfully`, {
        FILE_PATH,
        contentLength: content.length,
      });
      return content;
    } catch (error) {
      logger.error(tag, `Failed to read file`, {
        FILE_PATH,
        error: error.message,
      });
      throw error;
    }
  } else if (FILE_URL) {
    try {
      logger.debug(tag, `Fetching from URL`, { FILE_URL });
      const res = await fetch(FILE_URL);

      if (res.status === 200) {
        logger.debug(tag, `Fetch successful`, {
          FILE_URL,
          status: res.status,
        });

        if (opt.reponseType === "json") {
          return res.json();
        } else {
          return res.text();
        }
      } else {
        logger.error(tag, `Fetch failed with non-200 status`, {
          FILE_URL,
          status: res.status,
          statusText: res.statusText,
        });
        return false;
      }
    } catch (error) {
      logger.error(tag, `Fetch failed with exception`, {
        FILE_URL,
        error: error.message,
      });
      throw error;
    }
  } else {
    const error = new Error("FILE_PATH or FILE_URL is not set.");
    logger.error(tag, error.message);
    throw error;
  }
};

// -- base util

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const apiCall = async (url, opt, retries = 3) => {
  const method = opt?.method || "GET";
  const tag = "apiCall";

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.debug(tag, `Attempting ${method} request`, {
        url,
        attempt,
        maxRetries: retries,
      });

      const response = await fetch(url, opt);

      logger.debug(tag, `Response received`, {
        url,
        status: response.status,
        statusText: response.statusText,
      });

      // Check for HTTP errors
      if (!response.ok) {
        const errorBody = await response.text();
        const error = new Error(
          `HTTP ${response.status}: ${response.statusText}`
        );
        error.status = response.status;
        error.statusText = response.statusText;
        error.body = errorBody;
        error.url = url;

        logger.error(tag, `HTTP error`, {
          url,
          status: response.status,
          statusText: response.statusText,
          body: errorBody.substring(0, 500), // Limit error body length
        });

        // Don't retry on 4xx errors (client errors)
        if (response.status >= 400 && response.status < 500) {
          throw error;
        }

        // Retry on 5xx errors (server errors)
        if (attempt < retries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          logger.warn(tag, `Retrying after delay`, {
            url,
            attempt,
            delay,
          });
          await sleep(delay);
          continue;
        }

        throw error;
      }

      const data = await response.text();
      logger.debug(tag, `Request successful`, {
        url,
        dataLength: data.length,
      });

      return data;
    } catch (error) {
      if (attempt === retries) {
        logger.error(tag, `All retry attempts failed`, {
          url,
          error: error.message,
          stack: error.stack,
        });
        throw error;
      }

      // Network errors or other exceptions
      const delay = Math.pow(2, attempt) * 1000;
      logger.warn(tag, `Request failed, retrying`, {
        url,
        attempt,
        error: error.message,
        delay,
      });
      await sleep(delay);
    }
  }
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
  const tag = "removeBranch";
  const url = `https://api.github.com/repos/${user}/${repo}/git/refs/heads/${branch}`;
  const opt = {
    method: "DELETE",
    headers: { Authorization: `token ${pat}` },
  };

  const data = await apiCall(url, opt);
  logger.info(tag, `Branch removed successfully`, { branch, repo });
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
  const tag = "createBranch";

  try {
    // get base branch sha
    logger.debug(tag, `Getting base branch SHA`, { baseBranch, repo });
    const {
      object: { sha: shaMain },
    } = await getBranch(pat, user, repo, baseBranch);

    logger.debug(tag, `Base branch SHA retrieved`, {
      baseBranch,
      sha: shaMain,
    });

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

    if (ref) {
      logger.info(tag, `Branch created successfully`, { branch, repo });
      return true;
    } else {
      logger.info(tag, `Branch already exists`, { branch, repo });
      return false;
    }
  } catch (error) {
    logger.error(tag, `Failed to create branch`, {
      branch,
      baseBranch,
      repo,
      error: error.message,
    });
    throw error;
  }
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
  let sha = undefined;
  try {
    const readFileData = await readFile(pat, user, repo, {
      branch,
      path,
    });
    sha = readFileData.sha;
  } catch (error) {
    logger.error(tag, `Failed to read file but continue`, {
      path,
      error: error.message,
    });
  }

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
    logger.info("createFile", `File content unchanged, skipping`, {
      path,
      sha,
      repo,
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
        logger.info(
          "createFile",
          `Version-only change detected, auto-merging`,
          {
            path,
            additions,
            deletions,
            branch,
            baseBranch,
          }
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
  const tag = "getSwagger";

  if (url) {
    if (typeof url === "string") {
      url = {
        url,
        keyRegEx: "atg-(.*?)-dev",
        verRegEx: "swagger/(.*?)/swagger",
        ...urlOpt,
      };
    }

    // Check if urlOpt contains module, definition, projectName, and folderName
    const hasModuleFlow =
      url.baseUrl &&
      url.module &&
      url.definition &&
      url.projectName &&
      url.folderName;

    let finalUrl = url.url;
    let projectName;
    let folderName;

    if (hasModuleFlow) {
      logger.info(tag, `Using module flow`, {
        module: url.module,
        definition: url.definition,
        projectName: url.projectName,
        folderName: url.folderName,
      });
      // New flow: build URL with module and definition query parameters
      const baseUrl = url.baseUrl;
      finalUrl = `${baseUrl}?module=${url.module}&definition=${url.definition}`;
      projectName = url.projectName;
      folderName = url.folderName;
    } else {
      logger.info(tag, `Using keyRegEx flow`, {
        url: url.url,
        keyRegEx: url.keyRegEx,
        verRegEx: url.verRegEx,
      });
      // Original flow: extract from URL using regex
      projectName = new RegExp(url.keyRegEx).exec(url.url)?.[1] || "notfound";
      folderName = new RegExp(url.verRegEx).exec(url.url)?.[1] || "0.0";

      logger.debug(tag, `Extracted project and folder names`, {
        projectName,
        folderName,
      });
    }

    let data;
    try {
      logger.debug(tag, `Fetching swagger data`, { finalUrl });
      data = await getFileContent({
        FILE_URL: finalUrl,
      });
    } catch (error) {
      logger.error(tag, `Failed to fetch swagger data`, {
        finalUrl,
        error: error.message,
        stack: error.stack,
      });
    }

    if (!data) {
      logger.error(tag, `No data received from URL`, { finalUrl });
      return [{}];
    } else {
      logger.info(tag, `Swagger data fetched successfully`, {
        finalUrl,
        dataLength: data.length,
        projectName,
        folderName,
      });
    }

    return [
      {
        project: projectName.toLowerCase(),
        folder: folderName.toLowerCase(),
        data,
        url: finalUrl,
      },
    ];
  } else if (file) {
    logger.info(tag, `Loading swagger list from file`, { file });

    let res;
    try {
      res = await getFileContent({ FILE_PATH: file });
    } catch (error) {
      logger.error(tag, `Failed to read swagger list file`, {
        file,
        error: error.message,
      });
      return [{}];
    }

    if (!res) {
      logger.warn(tag, `Empty file content`, { file });
      return [{}];
    }

    let atgList;
    try {
      const parsed = JSON.parse(res);
      atgList = parsed.atgList;

      if (!atgList || !Array.isArray(atgList)) {
        logger.error(tag, `Invalid atgList format in file`, { file });
        return [{}];
      }

      logger.info(tag, `Loaded ${atgList.length} items from swagger list`, {
        file,
      });
    } catch (error) {
      logger.error(tag, `Failed to parse swagger list JSON`, {
        file,
        error: error.message,
      });
      return [{}];
    }

    const output = await Promise.all(
      atgList
        .map((item, index) => {
          logger.debug(tag, `Processing swagger list item`, {
            index,
            item: {
              url: item.url,
              module: item.module,
              projectName: item.projectName,
            },
          });
          return getSwagger({
            url: item.url,
            urlOpt: {
              keyRegEx: item.keyRegEx,
              verRegEx: item.verRegEx,
              module: item.module,
              definition: item.definition,
              projectName: item.projectName,
              folderName: item.folderName,
              baseUrl: item.baseUrl,
            },
          });
        })
        .flat()
    );

    return output.flat();
  } else {
    logger.warn(tag, `No URL or file provided`);
    return [];
  }
};

const evtCloseOpeningPR = async ({ pat, user, repo, commitKey }) => {
  const tag = "evtCloseOpeningPR";

  // check if there was older version is PR-ing and close it if yes
  logger.debug(tag, `Checking for existing PRs`, { commitKey, repo });

  const prList = await getAllPulls({
    pat,
    user,
    repo,
    state: "open",
  });

  if (!prList.length) {
    logger.debug(tag, `No open PRs found`, { repo });
    return;
  }

  // find by title
  const avaPrList = prList.filter((f) => f.title.indexOf(commitKey) !== -1);

  if (!avaPrList.length) {
    logger.debug(tag, `No matching PRs found`, { commitKey, repo });
    return;
  }

  logger.info(tag, `Closing ${avaPrList.length} existing PR(s)`, {
    commitKey,
    prNumbers: avaPrList.map((pr) => pr.number),
  });

  return Promise.all(
    avaPrList.map((pr) => {
      const { number } = pr;
      logger.debug(tag, `Closing PR`, { number, title: pr.title });
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
  const tag = "main";
  const startTime = Date.now();

  logger.info(tag, `Starting swagger sync process`);

  // Load environment variables
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

  // Validate required environment variables
  const missingVars = [];
  if (!GITHUB_PAT) missingVars.push("GITHUB_PAT");
  if (!GITHUB_USER) missingVars.push("GITHUB_USER");
  if (!GITHUB_REPO) missingVars.push("GITHUB_REPO");

  if (missingVars.length > 0) {
    const error = new Error(
      `Missing required environment variables: ${missingVars.join(", ")}`
    );
    logger.error(tag, error.message, { missingVars });
    throw error;
  }

  if (!SWAGGER_URL && !SWAGGER_FILE) {
    const error = new Error("SWAGGER_URL or SWAGGER_FILE is required");
    logger.error(tag, error.message);
    throw error;
  }

  // Log configuration (without sensitive data)
  logger.info(tag, `Configuration loaded`, {
    GITHUB_USER,
    GITHUB_REPO,
    GITHUB_BRANCH,
    GITHUB_BRANCH_BASE,
    GITHUB_REVIEWERS: GITHUB_REVIEWERS ? "set" : "not set",
    SWAGGER_URL: SWAGGER_URL ? "set" : "not set",
    SWAGGER_FILE: SWAGGER_FILE || "not set",
  });

  let serverIP = "unknown";
  try {
    serverIP = (await $`curl -s ifconfig.io`).stdout.trim();
    logger.debug(tag, `Server IP retrieved`, { serverIP });
  } catch (error) {
    logger.warn(tag, `Failed to get server IP`, { error: error.message });
  }

  logger.info(tag, `Fetching swagger data`);
  const listRes = await getSwagger({
    url: SWAGGER_URL,
    file: SWAGGER_FILE,
  });

  const validItems = listRes.filter((item) => item.project && item.folder);
  const logRes = validItems.map((item) => {
    const { project, folder, url } = item;
    return { project, folder, url };
  });

  logger.info(tag, `Swagger data fetched`, {
    serverIP,
    totalItems: listRes.length,
    validItems: validItems.length,
    items: logRes,
  });

  // create a file for each project
  logger.info(tag, `Processing ${validItems.length} items`);

  const results = await Promise.allSettled(
    listRes.map(async (item, index) => {
      const itemTag = "processItem";
      const itemLogger = logger.withContext({ itemIndex: index });

      try {
        const { data, project, folder, url } = item;

        itemLogger.debug(itemTag, `Starting processing`, {
          project,
          folder,
          url,
        });

        // Validate data exists and is a string
        if (!data || typeof data !== "string") {
          itemLogger.warn(itemTag, `Skipping invalid data`, {
            project,
            folder,
            url,
          });
          return { status: "skipped", reason: "invalid_data", project, folder };
        }

        // Parse JSON data
        let parseData = {};
        try {
          parseData = JSON.parse(data);
          itemLogger.debug(itemTag, `JSON parsed successfully`, {
            project,
            folder,
          });
        } catch (error) {
          itemLogger.error(itemTag, `Failed to parse JSON`, {
            serverIP,
            url,
            project,
            folder,
            error: error.message,
          });
          return {
            status: "failed",
            reason: "json_parse_error",
            project,
            folder,
            error: error.message,
          };
        }

        // Validate version exists
        if (!parseData.info || !parseData.info.version) {
          itemLogger.error(itemTag, `Missing version in swagger data`, {
            serverIP,
            url,
            project,
            folder,
            hasInfo: !!parseData.info,
          });
          return { status: "failed", reason: "no_version", project, folder };
        }

        let {
          info: { version },
        } = parseData;

        if (!version) {
          itemLogger.warn(itemTag, `Empty version field`, { project, folder });
          return { status: "failed", reason: "empty_version", project, folder };
        }

        // trim version, e.g  "1.0.0-16 | 1.0"
        version = version.split(" ")[0].trim();

        itemLogger.info(itemTag, `Processing version`, {
          project,
          folder,
          version,
        });

        // create branch
        const newBranchName = `${GITHUB_BRANCH}/${project}/${folder}/${version}`;

        try {
          itemLogger.debug(itemTag, `Creating branch`, { newBranchName });
          await createBranch(GITHUB_PAT, GITHUB_USER, GITHUB_REPO, {
            branch: newBranchName,
            baseBranch: GITHUB_BRANCH_BASE,
          });
        } catch (error) {
          itemLogger.error(itemTag, `Failed to create branch`, {
            newBranchName,
            error: error.message,
          });
          // if branch creation failed, continue
          // return { status: 'failed', reason: 'branch_creation_error', project, folder, error: error.message };
        }

        const commitKey = `${project}/${folder}`;
        const commitMessage = `build: bump ${commitKey} to ${version}`;

        // create or update file
        let fileRes;
        try {
          itemLogger.debug(itemTag, `Creating/updating file`, {
            path: `${project}/${folder}/swagger.json`,
          });
          fileRes = await createFile(GITHUB_PAT, GITHUB_USER, GITHUB_REPO, {
            branch: newBranchName,
            baseBranch: GITHUB_BRANCH_BASE,
            path: `${project}/${folder}/swagger.json`,
            content: JSON.stringify(parseData, null, 2),
            commitMessage,
          });
        } catch (error) {
          itemLogger.error(itemTag, `Failed to create file`, {
            path: `${project}/${folder}/swagger.json`,
            error: error.message,
          });
          return {
            status: "failed",
            reason: "file_creation_error",
            project,
            folder,
            error: error.message,
          };
        }

        // remove branch if file created or content keep same
        if (!fileRes) {
          itemLogger.debug(itemTag, `No file changes detected`, {
            newBranchName,
          });

          // check current branch was pull request before
          const prList = await getPullsByHeadBranchName({
            pat: GITHUB_PAT,
            user: GITHUB_USER,
            repo: GITHUB_REPO,
            headBranch: newBranchName,
            state: "all",
          });

          // just skip ALL flow if PR before
          if (prList.length) {
            itemLogger.info(itemTag, `PR already exists, skipping`, {
              project,
              folder,
              version,
              prCount: prList.length,
            });
            return {
              status: "skipped",
              reason: "pr_exists",
              project,
              folder,
              version,
            };
          }

          // remove branch if no PR before
          itemLogger.debug(itemTag, `Removing branch (no changes)`, {
            newBranchName,
          });
          await removeBranch(GITHUB_PAT, GITHUB_USER, GITHUB_REPO, {
            branch: newBranchName,
          });
          return {
            status: "skipped",
            reason: "no_changes",
            project,
            folder,
            version,
          };
        }

        // close older PR
        try {
          itemLogger.debug(itemTag, `Checking for old PRs to close`, {
            commitKey,
          });
          await evtCloseOpeningPR({
            pat: GITHUB_PAT,
            user: GITHUB_USER,
            repo: GITHUB_REPO,
            commitKey,
          });
        } catch (error) {
          itemLogger.warn(itemTag, `Failed to close old PRs (non-critical)`, {
            error: error.message,
          });
          // Continue even if closing old PR fails
        }

        // create PR
        let pull_number;
        try {
          itemLogger.info(itemTag, `Creating pull request`, { newBranchName });
          pull_number = await createPulls(
            GITHUB_PAT,
            GITHUB_USER,
            GITHUB_REPO,
            {
              head: newBranchName,
              base: GITHUB_BRANCH_BASE,
              title: commitMessage,
            }
          );
        } catch (error) {
          itemLogger.error(itemTag, `Failed to create PR`, {
            newBranchName,
            error: error.message,
          });
          return {
            status: "failed",
            reason: "pr_creation_error",
            project,
            folder,
            error: error.message,
          };
        }

        if (!pull_number) {
          itemLogger.error(itemTag, `No pull number returned`, {
            newBranchName,
          });
          return {
            status: "failed",
            reason: "no_pull_number",
            project,
            folder,
          };
        }

        itemLogger.info(itemTag, `Pull request created`, {
          pull_number,
          project,
          folder,
          version,
        });

        // assign reviewers
        if (pull_number && GITHUB_REVIEWERS) {
          try {
            const reviewers = (GITHUB_REVIEWERS || "").split("|");
            itemLogger.debug(itemTag, `Assigning reviewers`, {
              reviewers,
              pull_number,
            });
            await requestReviewer2Pull(GITHUB_PAT, GITHUB_USER, GITHUB_REPO, {
              reviewers,
              pull_number,
            });
            itemLogger.info(itemTag, `Reviewers assigned`, {
              reviewers,
              pull_number,
            });
          } catch (error) {
            itemLogger.warn(
              itemTag,
              `Failed to assign reviewers (non-critical)`,
              {
                error: error.message,
                pull_number,
              }
            );
            // Continue even if assigning reviewers fails
          }
        }

        itemLogger.info(itemTag, `Item processed successfully`, {
          project,
          folder,
          version,
          pull_number,
        });

        return { status: "success", project, folder, version, pull_number };
      } catch (error) {
        // Catch any unexpected errors
        itemLogger.error(itemTag, `Unexpected error during processing`, {
          error: error.message,
          stack: error.stack,
          item:
            item.project && item.folder
              ? { project: item.project, folder: item.folder }
              : "unknown",
        });
        return {
          status: "failed",
          reason: "unexpected_error",
          project: item.project || "unknown",
          folder: item.folder || "unknown",
          error: error.message,
        };
      }
    })
  );

  // Summary of results
  const summary = {
    total: results.length,
    success: 0,
    failed: 0,
    skipped: 0,
    details: [],
  };

  results.forEach((result) => {
    if (result.status === "fulfilled") {
      const value = result.value;
      if (value?.status === "success") {
        summary.success++;
      } else if (value?.status === "failed") {
        summary.failed++;
        summary.details.push(value);
      } else if (value?.status === "skipped") {
        summary.skipped++;
      }
    } else if (result.status === "rejected") {
      summary.failed++;
      summary.details.push({
        status: "failed",
        reason: "promise_rejected",
        error: result.reason?.message || String(result.reason),
      });
    }
  });

  const elapsedTime = Date.now() - startTime;
  const elapsedSeconds = (elapsedTime / 1000).toFixed(2);

  logger.info(tag, `Processing completed`, {
    ...summary,
    elapsedTime: `${elapsedSeconds}s`,
  });

  if (summary.failed > 0) {
    logger.error(tag, `Failed items detected`, {
      failedCount: summary.failed,
      details: summary.details,
    });
  }

  if (summary.success > 0) {
    logger.info(tag, `Successfully processed ${summary.success} item(s)`);
  }

  if (summary.skipped > 0) {
    logger.info(tag, `Skipped ${summary.skipped} item(s)`);
  }

  return "ok";
};

await checkArgv(["GITHUB_PAT", "GITHUB_USER", "GITHUB_REPO"]);
process.stdout.write(await main());
