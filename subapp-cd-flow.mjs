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

const getFilesAndPaths = async (path) => {
  path = path || "drop";
  const files2Save = [];
  const folder2Save = [];
  await fs.readdirSync(path).forEach((file) => {
    const filePath = path + "/" + file;
    if (fs.statSync(filePath).isDirectory()) {
      folder2Save.push(filePath);
    } else {
      files2Save.push(filePath);
    }
  });
  return { files2Save, folder2Save, folderPath: path };
};

const getCICDfile = async (path) => {
  path = path || "cicd.json";
  const file = await fs.readFileSync(path);
  return JSON.parse(file);
};

const downloadAzCopy = async ({ azCopyPath = "temp", azCopyDownloadLink }) => {
  await $`mkdir -p ${azCopyPath}`;
  azCopyPath = `./${azCopyPath}/`;
  const azCopySavePath = azCopyPath + "azcopy.tar.gz";
  const azCopyExecPath = azCopyPath + "azcopy";

  try {
    await fs.readFileSync(azCopyExecPath);
  } catch (error) {
    // download and unzip
    azCopyDownloadLink =
      azCopyDownloadLink || "https://aka.ms/downloadazcopy-v10-linux";
    await $`wget -O ${azCopySavePath} ${azCopyDownloadLink} && tar -xf ${azCopySavePath} -C ${azCopyPath} --strip-components=1`;
  } finally {
    return { azCopyExecPath, azCopySavePath };
  }
};

const azCopySyncFile2Blob = async ({
  azCopyExecPath,
  blobAccountName,
  blobContainerName = "%24web",
  blobSAS,
  destPath,
  uploadPath,
  azCopyArg,
}) => {
  const getDestUrl = (filePath) => {
    return `https://${blobAccountName}.blob.core.windows.net/${blobContainerName}${filePath}${blobSAS}`;
  };
  await $`${azCopyExecPath} sync ${uploadPath} ${getDestUrl(
    destPath
  )} ${azCopyArg}`;
  // update index.html file
  await $`${azCopyExecPath} copy ${uploadPath + "/index.html"} ${getDestUrl(
    destPath + "/index.html"
  )} ${["--cache-control=max-age=0, must-revalidate"]}`;
};

const deploy2AzureBlob = async ({
  azCopyDownloadLink,
  azCopyPath,
  blobAccountName,
  blobSAS,
  assetPath,
  indexPath,
  latestPath,
  rootPath,
  isRoot,
  folderPath,
}) => {
  const { azCopyExecPath } = await downloadAzCopy({
    azCopyDownloadLink,
    azCopyPath,
  });

  // update version folder
  await azCopySyncFile2Blob({
    azCopyExecPath,
    azCopyArg: [
      "--exclude-path=temp",
      "--recursive",
      "--delete-destination=true",
    ],
    destPath: assetPath,
    uploadPath: folderPath,
    blobAccountName,
    blobSAS,
  });

  // update latest folder
  if (latestPath) {
    await azCopySyncFile2Blob({
      azCopyExecPath,
      azCopyArg: [
        "--exclude-path=temp",
        "--recursive",
        "--delete-destination=true",
      ],
      destPath: latestPath,
      uploadPath: folderPath,
      blobAccountName,
      blobSAS,
    });
  }

  // update index folder
  await azCopySyncFile2Blob({
    azCopyExecPath,
    azCopyArg: [
      "--exclude-path=v;temp",
      "--delete-destination=true",
      "--recursive=false",
    ],
    destPath: indexPath,
    uploadPath: folderPath,
    blobAccountName,
    blobSAS,
  });

  // update root folder
  if (isRoot && Boolean(isRoot) === true) {
    await azCopySyncFile2Blob({
      azCopyExecPath,
      azCopyArg: [
        "--exclude-path=v;temp",
        "--delete-destination=true",
        "--recursive=false",
      ],
      destPath: rootPath,
      uploadPath: folderPath,
      blobAccountName,
      blobSAS,
    });
  }
};

// -- main
const main = async () => {
  const APP_BUILD_FOLDER_PATH =
    process.env.APP_BUILD_FOLDER_PATH || argv.APP_BUILD_FOLDER_PATH;
  const APP_CICD_FILE_PATH =
    process.env.APP_CICD_FILE_PATH || argv.APP_CICD_FILE_PATH || "cicd.json";
  const AZCOPY_DOWNLOAD_URL =
    process.env.AZCOPY_DOWNLOAD_URL || argv.AZCOPY_DOWNLOAD_URL;
  const AZ_BLOB_ACC_NAME =
    process.env.AZ_BLOB_ACC_NAME || argv.AZ_BLOB_ACC_NAME;
  const AZ_BLOB_SAS_TOKEN =
    process.env.AZ_BLOB_SAS_TOKEN || argv.AZ_BLOB_SAS_TOKEN;

  const APP_IS_ROOT_VERSION =
    process.env.APP_IS_ROOT_VERSION || argv.APP_IS_ROOT_VERSION;

  const { folderPath } = await getFilesAndPaths(APP_BUILD_FOLDER_PATH);

  const { assetPath, indexPath, latestPath, APP_PATH } = await getCICDfile(
    `${folderPath}/${APP_CICD_FILE_PATH}`
  );

  await deploy2AzureBlob({
    azCopyDownloadLink: AZCOPY_DOWNLOAD_URL,
    assetPath,
    indexPath,
    latestPath,
    rootPath: APP_PATH,
    isRoot: APP_IS_ROOT_VERSION || false,
    folderPath,
    blobAccountName: AZ_BLOB_ACC_NAME,
    blobSAS: AZ_BLOB_SAS_TOKEN,
  });

  return "ok";
};

await checkArgv([
  "APP_BUILD_FOLDER_PATH",
  "AZ_BLOB_ACC_NAME",
  "AZ_BLOB_SAS_TOKEN",
]);
process.stdout.write(await main());
