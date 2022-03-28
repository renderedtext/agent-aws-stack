const path = require("path");
const { execSync } = require('child_process');

function hash(os) {
  packerOs = os == "windows" ? "windows" : "linux";
  hash = execSync(`find Makefile packer/${packerOs} -type f -exec md5sum "{}" + | awk '{print $1}' | sort | md5sum | awk '{print $1}'`, {
    cwd: path.resolve(__dirname, '../')
  });

  return hash.toString().replace("\n", "")
}

module.exports = { hash }
