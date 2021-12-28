const aws = require("aws-sdk");
const https = require('https');

function getAgentTypeToken(tokenParameterName) {
  var ssm = new aws.SSM();

  console.log("Fetching agent type token...");

  return new Promise(function(resolve, reject) {
    var params = {
      Name: tokenParameterName,
      WithDecryption: true
    };

    ssm.getParameter(params, function(err, data) {
      if (err) {
        console.log("Error getting agent type registration token parameter: ", err);
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

function setAsgDesiredCapacity(asgName, desiredCapacity) {
  var autoscaling = new aws.AutoScaling();
  console.log(`Scaling '${asgName}' up to ${desiredCapacity}...`);

  return new Promise(function(resolve, reject) {
    var params = {
      AutoScalingGroupName: asgName,
      DesiredCapacity: desiredCapacity,
      HonorCooldown: false
    };

    autoscaling.setDesiredCapacity(params, function(err, data) {
      if (err) {
        console.log("Error scaling asg: ", err);
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

function getAgentTypeOccupancy(token) {
  const options = {
    hostname: 'semaphore.semaphoreci.com',
    path: "/api/v1/self_hosted_agents/occupancy",
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
        reject(`Request to get occupancy got ${response.statusCode}`);
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

const scaleUpIfNeeded = async (asgName, occupancy, asg) => {
  const totalJobs = Object.keys(occupancy).reduce((count, state) => count + occupancy[state], 0);

  console.log(`Agent type occupancy: `, occupancy);
  console.log(`Current asg state: `, asg);

  const desired = totalJobs > asg.maxSize ? asg.maxSize : totalJobs;
  if (desired > asg.desiredCapacity) {
    await setAsgDesiredCapacity(asgName, desired);
    console.log(`Successfully scaled up '${asg.name}'.`);
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

const tick = async (agentTokenParameterName, asgName) => {
  try {
    const agentTypeToken = await getAgentTypeToken(agentTokenParameterName);
    const occupancy = await getAgentTypeOccupancy(agentTypeToken);
    const asg = await describeAsg(asgName);
    await scaleUpIfNeeded(asgName, occupancy, asg);
  } catch (e) {
    console.error("Error fetching occupancy", e);
  }
}

exports.handler = async (event, context, callback) => {
  const agentTokenParameterName = process.env.SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME;
  if (!agentTokenParameterName) {
    console.error("No SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME specified.")
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
    await tick(agentTokenParameterName, asgName);
    console.log(`Sleeping ${interval}ms...`);
    await sleep(interval);
    now = epochSeconds();
  }

  return {
    statusCode: 200,
    message: "success",
  }
};