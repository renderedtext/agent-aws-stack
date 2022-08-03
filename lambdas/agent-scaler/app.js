const https = require('https');
const utils = require("util");
const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");
const { AutoScalingClient, DescribeAutoScalingGroupsCommand, SetDesiredCapacityCommand } = require("@aws-sdk/client-auto-scaling");
const { CloudWatchClient, PutMetricDataCommand } = require("@aws-sdk/client-cloudwatch");

function getAgentTypeToken(tokenParameterName) {
  const ssmClient = new SSMClient();
  const params = {
    Name: tokenParameterName,
    WithDecryption: true
  };

  console.log("Fetching agent type token...");

  return new Promise(function(resolve, reject) {
    const command = new GetParameterCommand(params);
    ssmClient.send(command, function(err, data) {
      if (err) {
        console.log("Error getting agent type registration token parameter: ", err);
        reject(err);
      } else {
        resolve(data.Parameter.Value);
      }
    });
  });
}

function describeAsg(autoScalingClient, stackName) {
  console.log(`Describing asg for '${stackName}'...`);

  const params = {
    Filters: [
      {
        Name: "tag:aws:cloudformation:stack-name",
        Values: [stackName]
      }
    ]
  };

  return new Promise(function(resolve, reject) {
    const command = new DescribeAutoScalingGroupsCommand(params);
    autoScalingClient.send(command, function(err, data) {
      if (err) {
        console.log("Error describing asg: ", err);
        reject(err);
      } else {
        let autoScalingGroups = data.AutoScalingGroups;
        if (autoScalingGroups.length === 0) {
          reject(`Could not find asg for stack '${stackName}'`);
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

function setAsgDesiredCapacity(autoScalingClient, asgName, desiredCapacity) {
  console.log(`Scaling '${asgName}' up to ${desiredCapacity}...`);

  var params = {
    AutoScalingGroupName: asgName,
    DesiredCapacity: desiredCapacity,
    HonorCooldown: false
  };

  return new Promise(function(resolve, reject) {
    const command = new SetDesiredCapacityCommand(params);
    autoScalingClient.send(command, function(err, data) {
      if (err) {
        console.log("Error scaling asg: ", err);
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

function publishOccupancyMetrics(stackName, occupancy) {
  const cloudwatchClient = new CloudWatchClient();
  const metricData = Object.keys(occupancy)
    .map(state => {
      return {
        MetricName: `JobCount`,
        Value: occupancy[state],
        Unit: "Count",
        Timestamp: new Date(),
        Dimensions: [
          {Name: "StackName", Value: stackName},
          {Name: "JobState", Value: state}
        ]
      }
    });

  console.log(`Publishing metrics to CloudWatch: ${utils.inspect(metricData, {depth: 3})}`);

  return new Promise(function(resolve, reject) {
    const command = new PutMetricDataCommand({ MetricData: metricData, Namespace: "Semaphore" });
    cloudwatchClient.send(command, function(err, data) {
      if (err) {
        console.log("Error publishing metrics: ", err);
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

function getAgentTypeOccupancy(token, semaphoreEndpoint) {
  const options = {
    hostname: semaphoreEndpoint,
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

const scaleUpIfNeeded = async (autoScalingClient, asgName, occupancy, asg) => {
  const totalJobs = Object.keys(occupancy).reduce((count, state) => count + occupancy[state], 0);

  console.log(`Agent type occupancy: `, occupancy);
  console.log(`Current asg state: `, asg);

  const desired = totalJobs > asg.maxSize ? asg.maxSize : totalJobs;
  if (desired > asg.desiredCapacity) {
    await setAsgDesiredCapacity(autoScalingClient, asgName, desired);
    console.log(`Successfully scaled up '${asg.name}'.`);
  } else {
    console.log(`No need to scale up '${asgName}'.`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function epochSeconds() {
  return Math.round(Date.now() / 1000);
}

const tick = async (agentTokenParameterName, stackName, autoScalingClient, semaphoreEndpoint) => {
  try {
    const agentTypeToken = await getAgentTypeToken(agentTokenParameterName);
    const occupancy = await getAgentTypeOccupancy(agentTypeToken, semaphoreEndpoint);
    await publishOccupancyMetrics(stackName, occupancy);
    const asg = await describeAsg(autoScalingClient, stackName);
    await scaleUpIfNeeded(autoScalingClient, asg.name, occupancy, asg);
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

  const stackName = process.env.SEMAPHORE_AGENT_STACK_NAME;
  if (!stackName) {
    console.error("No SEMAPHORE_AGENT_STACK_NAME specified.")
    return {
      statusCode: 500,
      message: "error",
    };
  }

  const semaphoreEndpoint = process.env.SEMAPHORE_ENDPOINT;
  if (!semaphoreEndpoint) {
    console.error("No SEMAPHORE_ENDPOINT specified.")
    return {
      statusCode: 500,
      message: "error",
    };
  }

  const autoScalingClient = new AutoScalingClient();

  /**
   * The interval between ticks.
   * This is required because the smallest unit for a scheduled lambda is 1 minute.
   * So, we run a tick every 10s, timing out after 50s
   */
  const interval = 10000;
  const timeout = epochSeconds() + 50;

  let now = epochSeconds();
  while (now < timeout) {
    await tick(agentTokenParameterName, stackName, autoScalingClient, semaphoreEndpoint);
    console.log(`Sleeping ${interval}ms...`);
    await sleep(interval);
    now = epochSeconds();
  }

  return {
    statusCode: 200,
    message: "success",
  }
};