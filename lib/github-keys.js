const path = require("path");
const { readFileSync, writeFileSync, readdirSync } = require('fs');
const { execSync } = require('child_process');

// To make sure we don't always hit the Github API
// to determine its keys, we cache the keys in a local file.
const cacheFilePrefix = ".gh_ssh_keys";

// We expire the cache file after 1 hour.
const expirationPeriod = 60 * 60;

function getKeys() {
  let cachedFile = findCacheFile()
  if (!cachedFile) {
    const newFilePath = newCacheFileName()
    const newFileName = path.basename(newFilePath)
    console.log(`==> GitHub SSH keys not found locally. Fetching and storing at '${newFileName}' ...`);
    return fetchAndStore(newFilePath)
  }

  if (cachedFile.expired) {
    const newFilePath = newCacheFileName()
    const newFileName = path.basename(newFilePath)
    console.log(`==> GitHub SSH keys found locally at '${cachedFile.fileName}', but expired. Fetching and storing at '${newFileName}' ...`);
    return fetchAndStore(newFilePath)
  }

  console.log(`==> GitHub SSH keys found locally at '${cachedFile.fileName}'.`);
  return JSON.parse(readFileSync(cachedFile.fileName).toString())
}

function findCacheFile() {
  const fileName = readdirSync(path.resolve(__dirname, ".."))
    .find(fileName => fileName.startsWith(cacheFilePrefix))

  if (fileName) {
    const fileNameParts = fileName.split("_")
    const timestamp = parseInt(fileNameParts[fileNameParts.length - 1])
    const expireAt = (timestamp + expirationPeriod)
    const now = epochSeconds()
    if (now < expireAt) {
      return {fileName, expired: false}
    }

    return {fileName, expired: true}
  }

  return null
}

function fetchAndStore(filePath) {
  // TODO: handle command error
  meta = execSync(`curl -s https://api.github.com/meta`, {
    cwd: path.resolve(__dirname, '../')
  });

  // TODO: handle missing keys
  let keys = JSON.parse(meta.toString()).ssh_keys

  // TODO: handle error
  writeFileSync(filePath, JSON.stringify(keys))
  return keys
}

function newCacheFileName() {
  return path.resolve(__dirname, '..', `${cacheFilePrefix}_${epochSeconds()}`)
}

function epochSeconds() {
  return Math.floor(new Date().getTime() / 1000)
}

module.exports = { getKeys }
