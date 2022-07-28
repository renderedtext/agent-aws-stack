const https = require('https');
const aws = require('aws-sdk');

function getGitHubSSHKeys() {
  const options = {
    hostname: "api.github.com",
    path: "/meta",
    method: 'GET',
    headers: { "User-Agent": "ssh-keys-updater" }
  }

  return new Promise((resolve, reject) => {
    let data = '';
    https.request(options, response => {
      if (response.statusCode !== 200) {
        reject(`Request to get GitHub SSH keys got ${response.statusCode}`);
        return;
      }

      response.on('data', function (chunk) {
        data += chunk;
      });

      response.on('end', function () {
        resolve(JSON.parse(data).ssh_keys);
      });
    })
    .on('error', error => reject(error))
    .end();
  })
}

function getCurrentKeys(ssmClient, parameterName) {
  console.log(`Getting current keys...`);
  const params = { Name: parameterName };

  return new Promise(function(resolve, reject) {
    ssmClient.getParameter(params, function(err, data) {
      if (err) {
        if (err.name == "ParameterNotFound") {
          console.log("Could not find parameter.");
          resolve([]);
        } else {
          console.log("Error getting current keys: ", err);
          reject(err);
        }
      } else {
        resolve(JSON.parse(data.Parameter.Value));
      }
    });
  });
}

function updateKeys(ssmClient, parameterName, newKeys) {
  const params = {
    Name: parameterName,
    Value: JSON.stringify(newKeys),
    Type: "String",
    Overwrite: true,
    Tier: "Standard",
    DataType: "text"
  };

  return new Promise(function(resolve, reject) {
    ssmClient.putParameter(params, function(err, data) {
      if (err) {
        console.log("Error updating current keys: ", err);
        reject(err);
      } else {
        console.log("Successfully updated parameter", data);
        resolve();
      }
    });
  });
}

function keysAreEqual(currentKeys, newKeys) {
  return currentKeys.length === newKeys.length && currentKeys.every((key, index) => key === newKeys[index]);
}

exports.handler = async (event, context, callback) => {
  console.log('Received event: ', JSON.stringify(event, null, 2));

  const parameterName = process.env.SSM_PARAMETER;
  if (!parameterName) {
    console.error("No SSM_PARAMETER specified.")
    return {
      statusCode: 500,
      message: "error",
    };
  }

  const newKeys = await getGitHubSSHKeys();
  const ssmClient = new aws.SSM();
  const currentKeys = await getCurrentKeys(ssmClient, parameterName);
  if (!keysAreEqual(currentKeys, newKeys)) {
    console.log("Keys changed. Updating...")
    await updateKeys(ssmClient, parameterName, newKeys);
  } else {
    console.log("Keys haven't changed. Not updating.")
  }

  return {
    statusCode: 200,
    message: "sucess"
  };
};