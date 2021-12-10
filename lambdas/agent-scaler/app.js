const aws = require("aws-sdk");
const https = require('https');

const getJobMetrics = async (token, agentType) => {
  let nextPageToken = null;
  let jobs = [];

  console.log(`Fetching jobs for ${agentType}...`);

  do {
    let response = await executeRequest(token, nextPageToken);
    jobs = jobs.concat(response.jobs);
    nextPageToken = response.next_page_token;
  } while (nextPageToken);

  return countByState(jobs, agentType);
}

function getSemaphoreApiToken(apiTokenParameterName) {
  var ssm = new aws.SSM();

  console.log("Fetching semaphore api token...");

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

function describeAsg(asgName) {
  var autoscaling = new aws.AutoScaling();

  console.log(`Describing '${asgName}'...`);

  return new Promise(function(resolve, reject) {
    var params = {
      AutoScalingGroupNames: [asgName]
    };

    autoscaling.describeAutoScalingGroups(params, function(err, data) {
      if (err) {
        console.log("Error describing asg: ", err);
        reject(err);
      } else {
        let autoScalingGroups = data.AutoScalingGroups;
        if (autoScalingGroups.length === 0) {
          reject(`Could not find auto scaling group '${asgName}'`);
        } else {
          let asg = autoScalingGroups[0];
          resolve({
            name: asg.AutoScalingGroupName,
            desiredCapacity: asg.DesiredCapacity,
            maxSize: asg.MaxSize
          });
        }
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

function scaleUpIfNeeded(metrics, asg) {
  const totalJobs = Object.keys(metrics).reduce((count, state) => count + metrics[state], 0);

  console.log(`Job metrics: `, metrics);
  console.log(`Current asg state: `, asg);
  console.log(`Total jobs: ${totalJobs}, current capacity: ${asg.desiredCapacity}`);

  if (totalJobs > asg.desiredCapacity) {
    const desired = totalJobs > asg.maxSize ? asg.maxSize : totalJobs;
    console.log(`Scaling up '${asg.name}' to ${desired} agents...`);
    // TODO: actually scale asg
  } else {
    console.log(`No need to scale up.`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function epochSeconds() {
  return Math.round(Date.now() / 1000);
}

const tick = async (apiTokenParameterName, agentType, asgName) => {
  try {
    const semaphoreApiToken = await getSemaphoreApiToken(apiTokenParameterName);
    const metrics = await getJobMetrics(semaphoreApiToken, agentType);
    const asg = await describeAsg(asgName);
    scaleUpIfNeeded(metrics, asg);
  } catch (e) {
    console.error(`Error fetching metrics for '${agentType}': `, e);
  }
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

  const asgName = process.env.SEMAPHORE_AGENT_ASG_NAME;
  if (!asgName) {
    console.error("No SEMAPHORE_AGENT_ASG_NAME specified.")
    return {
      statusCode: 500,
      message: "error",
    };
  }

  /**
   * The interval between ticks.
   * This is required because the smallest unit for a scheduled lambda is 1 minute.
   * So, we run a tick every 10s, timing out after 50s
   */
  const interval = 10000;
  const timeout = epochSeconds() + 50;

  let now = epochSeconds();
  while (now < timeout) {
    await tick(apiTokenParameterName, agentType, asgName);
    console.log(`Sleeping ${interval}ms...`);
    await sleep(interval);
    now = epochSeconds();
  }

  return {
    statusCode: 200,
    message: "success",
  }
};