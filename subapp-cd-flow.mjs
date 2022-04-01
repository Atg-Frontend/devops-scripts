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

const downloadAzCopy = async ({
  azCopyPath = "./build/",
  azCopyDownloadLink,
}) => {
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
  const destUrl = `https://${blobAccountName}.blob.core.windows.net/${blobContainerName}${destPath}${blobSAS}`;
  return $`${azCopyExecPath} sync ${uploadPath} ${destUrl} ${azCopyArg}`;
};

const deploy2AzureBlob = async ({
  azCopyDownloadLink,
  azCopyPath,
  blobAccountName,
  blobSAS,
  assetPath,
  indexPath,
  folderPath,
}) => {
  const { azCopyExecPath } = await downloadAzCopy({
    azCopyDownloadLink,
    azCopyPath,
  });

  // update version folder
  await azCopySyncFile2Blob({
    azCopyExecPath,
    azCopyArg: ["--recursive", "--delete-destination=true"],
    destPath: assetPath,
    uploadPath: folderPath,
    blobAccountName,
    blobSAS,
  });

  // update index folder
  await azCopySyncFile2Blob({
    azCopyExecPath,
    azCopyArg: [
      "--exclude-path=v",
      "--delete-destination=true",
      "--recursive=false",
    ],
    destPath: indexPath,
    uploadPath: folderPath,
    blobAccountName,
    blobSAS,
  });
};

// -- main
const main = async () => {
  const APP_BUILD_FOLDER_PATH =
    process.env.APP_BUILD_FOLDER_PATH || argv.APP_BUILD_FOLDER_PATH;
  const APP_CICD_FILE_PATH =
    process.env.APP_CICD_FILE_PATH || argv.APP_CICD_FILE_PATH;
  const AZCOPY_DOWNLOAD_URL =
    process.env.AZCOPY_DOWNLOAD_URL || argv.AZCOPY_DOWNLOAD_URL;
  const AZ_BLOB_ACC_NAME =
    process.env.AZ_BLOB_ACC_NAME || argv.AZ_BLOB_ACC_NAME;
  const AZ_BLOB_SAS_TOKEN =
    process.env.AZ_BLOB_SAS_TOKEN || argv.AZ_BLOB_SAS_TOKEN;

  const { folderPath } = await getFilesAndPaths(APP_BUILD_FOLDER_PATH);

  const { assetPath, indexPath } = await getCICDfile(APP_CICD_FILE_PATH);

  await deploy2AzureBlob({
    azCopyDownloadLink: AZCOPY_DOWNLOAD_URL,
    assetPath,
    indexPath,
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
