const PAT = process.env.GITHUB_PAT

const ORG = process.env.GITHUB_ORG
const REPO = process.env.GITHUB_REPO
const PATH = process.env.GITHUB_PATH
const URL = process.env.GITHUB_URL || `https://api.github.com/repos/${process.env.GITHUB_ORG}/${process.env.GITHUB_REPO}/contents/${process.env.GITHUB_PATH}`


let response = await fetch(URL, {
  headers: { 'Authorization': `token ${PAT}` }
})

const data = await response.text();

$`echo ${data}`
