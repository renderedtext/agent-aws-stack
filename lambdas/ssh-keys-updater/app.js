const { request, Agent } = require('https');
const { NodeHttpHandler } = require("@aws-sdk/node-http-handler");
const { SSMClient, GetParameterCommand, PutParameterCommand } = require("@aws-sdk/client-ssm");

const CONNECTION_TIMEOUT = 1000;
const SOCKET_TIMEOUT = 1000;

function getGitHubSSHKeys() {
  const options = {
    hostname: "api.github.com",
    path: "/meta",
    method: 'GET',
    headers: { "User-Agent": "ssh-keys-updater" }
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

function getCurrentKeys(ssmClient, parameterName) {
  console.log(`Getting current keys...`);
  const params = { Name: parameterName };

  return new Promise(function(resolve, reject) {
    const command = new GetParameterCommand(params);
    ssmClient.send(command, function(err, data) {
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
    const command = new PutParameterCommand(params)
    ssmClient.send(command, function(err, data) {
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

  const ssmClient = new SSMClient({
    maxAttempts: 1,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: CONNECTION_TIMEOUT,
      socketTimeout: SOCKET_TIMEOUT,
      httpsAgent: new Agent({
        timeout: SOCKET_TIMEOUT
      })
    }),
  });

  const newKeys = await getGitHubSSHKeys();
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