#!/usr/bin/env zx

const getApiLink = (org, repo, path, branch) => {
  return `https://api.github.com/repos/${org}/${repo}/contents/${path}${
    branch ? `?ref=${branch}` : ""
  }`;
};

const parseURL = (url) => {
  if (!url) return "";
  // check github.com url
  if (url.includes("github.com")) {
    const p1 = /github.com\/(.*?)\/blob/g.exec(url);
    const p2 = /blob\/(.*)/g.exec(url);
    if (!p1 || !p2) return;

    const p1Arr = p1[1].split("/");
    const org = p1Arr[0];
    const repo = p1Arr[1];

    const p2Arr = p2[1].split("/");
    const branch = p2Arr.shift();
    const path = p2Arr.join("/");

    const outUrl = getApiLink(org, repo, path, branch);
    return outUrl;
  } else if (url.includes("raw.githubusercontent.com")) {
    const p1 = url.split("raw.githubusercontent.com/")[1];
    if (!p1) return;

    const p1Arr = p1.split("/");
    const org = p1Arr.shift();
    const repo = p1Arr.shift();
    const branch = p1Arr.shift();
    const path = p1Arr.join("/").split("?")[0];

    const outUrl = getApiLink(org, repo, path, branch);
    return outUrl;
  }

  return url;
};

const main = async () => {
  const GITHUB_PAT = process.env.GITHUB_PAT || argv.GITHUB_PAT;
  const GITHUB_REPO = process.env.GITHUB_REPO || argv.GITHUB_REPO;
  const GITHUB_PATH = process.env.GITHUB_PATH || argv.GITHUB_PATH;
  const GITHUB_URL = process.env.GITHUB_URL || argv.GITHUB_URL;
  let url = GITHUB_URL || getApiLink(GITHUB_ORG, GITHUB_REPO, GITHUB_PATH);

  url = parseURL(url);
  let response = await fetch(url, {
    headers: { Authorization: `token ${GITHUB_PAT}` },
  });
  const data = await response.text();
  return data;
};

process.stdout.write(await main());
