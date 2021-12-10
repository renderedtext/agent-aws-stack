const aws = require("aws-sdk");
const https = require('https');

const getJobMetrics = async (token, agentType) => {
  let nextPageToken = null;
  let jobs = [];

  do {
    let response = await executeRequest(token, nextPageToken);
    jobs = jobs.concat(response.jobs);
    nextPageToken = response.next_page_token;
  } while (nextPageToken);

  return countByState(jobs, agentType);
}

function getSemaphoreApiToken(apiTokenParameterName) {
  var ssm = new aws.SSM();

  return new Promise(function(resolve, reject) {
    var params = {
      Name: apiTokenParameterName,
      WithDecryption: true
    };

    ssm.getParameter(params, function(err, data) {
      if (err) {
        console.log("Error getting semaphore api token parameter: ", err);
        reject(err);
      } else {
        resolve(data.Parameter.Value);
      }
    });
  });
}

function executeRequest(token, nextPageToken) {
  const url = "/api/v1alpha/jobs?states=QUEUED&states=RUNNING";
  const options = {
    hostname: 'semaphore.semaphoreci.com',
    path: nextPageToken ? `${url}&pageToken=${nextPageToken}` : url,
    method: 'GET',
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Token ${token}`,
      "Agent": "aws-dynamic-scaler"
    }
  }

  return new Promise((resolve, reject) => {
    let data = '';
    https.request(options, response => {
      if (response.statusCode !== 200) {
        reject(`Request to get job metrics got ${response.statusCode}`);
        return;
      }

      response.on('data', function (chunk) {
        data += chunk;
      });

      response.on('end', function () {
        resolve(JSON.parse(data));
      });
    })
    .on('error', error => reject(error))
    .end();
  })
}

function countByState(jobs, machineType) {
  const initialMap = {
    "RUNNING": 0,
    "QUEUED": 0
  };

  return jobs
    .filter(job => job.spec.agent.machine.type === machineType)
    .reduce((state_map, job) => {
      const state = job.status.state;
      if (state_map[state]) {
        state_map[state] = state_map[state]+1
      } else {
        state_map[state] = 1
      }

      return state_map;
    }, initialMap);
}

exports.handler = async (event, context, callback) => {
  const apiTokenParameterName = process.env.SEMAPHORE_API_TOKEN_PARAMETER_NAME;
  if (!apiTokenParameterName) {
    console.error("No SEMAPHORE_API_TOKEN_PARAMETER_NAME specified.")
    return {
      statusCode: 500,
      message: "error",
    };
  }

  // TODO: this is not ideal, since it requires customers to specify agent type token and name.
  const agentType = process.env.SEMAPHORE_AGENT_TYPE_NAME;
  if (!agentType) {
    console.error("No SEMAPHORE_AGENT_TYPE_NAME specified.")
    return {
      statusCode: 500,
      message: "error",
    };
  }

  try {
    const semaphoreApiToken = await getSemaphoreApiToken(apiTokenParameterName);
    const metrics = await getJobMetrics(semaphoreApiToken, agentType);
    console.log(`Successfully fetched metrics for '${agentType}': `, metrics);
    return {
      statusCode: 200,
      message: "success",
    }
  } catch (e) {
    console.error(`Error fetching metrics for '${agentType}': `, e);
    return {
      statusCode: 500,
      message: "error",
    }
  }
};