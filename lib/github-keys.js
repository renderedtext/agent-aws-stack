const path = require("path");
const { request } = require('https');
const { readFileSync, writeFileSync, readdirSync, unlinkSync } = require('fs');

// To make sure we don't always hit the Github API
// to determine its keys, we cache the keys in a local file.
const cacheFilePrefix = ".gh_ssh_keys";

// We expire the cache file after 1 hour.
const expirationPeriod = 60 * 60;

async function getKeys() {
  let cachedFile = findCacheFile()
  if (!cachedFile) {
    const newFilePath = newCacheFileName()
    const newFileName = path.basename(newFilePath)
    console.log(`==> GitHub SSH keys not found locally. Fetching and storing at '${newFileName}' ...`);
    return await fetchAndStore(newFilePath)
  }

  if (cachedFile.expired) {
    const newFilePath = newCacheFileName()
    const newFileName = path.basename(newFilePath)
    console.log(`==> GitHub SSH keys found locally at '${cachedFile.fileName}', but expired. Fetching and storing at '${newFileName}' ...`);
    const keys = await fetchAndStore(newFilePath)
    unlinkSync(path.resolve(__dirname, '..', cachedFile.fileName))
    return keys
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

async function fetchAndStore(filePath) {
  let keys = await fetchKeys();
  writeFileSync(filePath, JSON.stringify(keys))
  return keys
}

function fetchKeys() {
  const options = {
    hostname: "api.github.com",
    path: "/meta",
    method: 'GET',
    headers: { "User-Agent": "agent-aws-stack" }
  }

  return new Promise((resolve, reject) => {
    let data = '';

    request(options, response => {
      response.on('data', function (chunk) {
        data += chunk;
      });

      response.on('end', function () {
        if (response.statusCode !== 200) {
          const errMessage = `Request to get GitHub SSH keys failed with ${response.statusCode}`
          console.error(errMessage);
          console.error(`Response: ${data}`);
          console.error(`Headers: ${JSON.stringify(response.headers)}`);
          reject(errMessage);
        } else {
          resolve(JSON.parse(data).ssh_keys);
        }
      });
    })
    .on('error', error => reject(error))
    .end();
  })
}

function newCacheFileName() {
  return path.resolve(__dirname, '..', `${cacheFilePrefix}_${epochSeconds()}`)
}

function epochSeconds() {
  return Math.floor(new Date().getTime() / 1000)
}

module.exports = { getKeys }
