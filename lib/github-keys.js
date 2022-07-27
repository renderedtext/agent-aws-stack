const path = require("path");
const { existsSync, readFileSync, writeFileSync } = require('fs');
const { execSync } = require('child_process');

// To make sure we don't always hit the Github API
// to determine its keys, we cache the keys in a local file.
// TODO: add timestamp to file.
const cacheFilePath = path.resolve(__dirname, '../.gh_ssh_keys')

function getKeys() {
  if (existsSync(cacheFilePath)) {
    console.log(`==> GitHub SSH keys found locally.`);
    return JSON.parse(readFileSync(cacheFilePath).toString())
  }

  console.log(`==> GitHub SSH keys not found locally. Fetching ...`);

  // TODO: handle command error
  meta = execSync(`curl -s https://api.github.com/meta`, {
    cwd: path.resolve(__dirname, '../')
  });

  // TODO: handle missing keys
  let keys = JSON.parse(meta.toString()).ssh_keys
    .map(key => `github.com ${key}`)

  // TODO: handle error
  writeFileSync(cacheFilePath, JSON.stringify(keys))

  return keys
}

module.exports = { getKeys }
