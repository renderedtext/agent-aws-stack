const https = require('https');
const utils = require("util");
const { Agent } = require("https");
const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");
const { AutoScalingClient, DescribeAutoScalingGroupsCommand, SetDesiredCapacityCommand } = require("@aws-sdk/client-auto-scaling");
const { CloudWatchClient, PutMetricDataCommand } = require("@aws-sdk/client-cloudwatch");
const { NodeHttpHandler } = require("@aws-sdk/node-http-handler");

const CONNECTION_TIMEOUT = 1000;
const SOCKET_TIMEOUT = 1000;

function getAgentTypeToken(ssmClient, tokenParameterName) {
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

function buildMetricData(stackName, metrics) {
  let metricData = [];

  Object.keys(metrics.jobs).forEach(state => {
    metricData.push({
      MetricName: `JobCount`,
      Value: metrics.jobs[state],
      Unit: "Count",
      Timestamp: new Date(),
      Dimensions: [
        {Name: "StackName", Value: stackName},
        {Name: "JobState", Value: state}
      ]
    });
  });

  Object.keys(metrics.agents).forEach(state => {
    metricData.push({
      MetricName: `AgentCount`,
      Value: metrics.agents[state],
      Unit: "Count",
      Timestamp: new Date(),
      Dimensions: [
        {Name: "StackName", Value: stackName},
        {Name: "AgentState", Value: state}
      ]
    });
  });

  return metricData;
}

function publishOccupancyMetrics(cloudwatchClient, stackName, metrics) {
  const metricData = buildMetricData(stackName, metrics)
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

function getAgentTypeMetrics(token, semaphoreEndpoint) {
  const options = {
    hostname: semaphoreEndpoint,
    path: "/api/v1/self_hosted_agents/metrics",
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

const tick = async (agentTypeToken, stackName, autoScalingClient, cloudwatchClient, semaphoreEndpoint) => {
  try {
    const metrics = await getAgentTypeMetrics(agentTypeToken, semaphoreEndpoint);
    await publishOccupancyMetrics(cloudwatchClient, stackName, metrics);
    const asg = await describeAsg(autoScalingClient, stackName);
    await scaleUpIfNeeded(autoScalingClient, asg.name, metrics.jobs, asg);
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

  const cloudwatchClient = new CloudWatchClient({
    maxAttempts: 1,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: CONNECTION_TIMEOUT,
      socketTimeout: SOCKET_TIMEOUT,
      httpsAgent: new Agent({
        timeout: SOCKET_TIMEOUT
      })
    }),
  });

  const autoScalingClient = new AutoScalingClient({
    maxAttempts: 1,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: CONNECTION_TIMEOUT,
      socketTimeout: SOCKET_TIMEOUT,
      httpsAgent: new Agent({
        timeout: SOCKET_TIMEOUT
      })
    }),
  });

  /**
   * The interval between ticks.
   * This is required because the smallest unit for a scheduled lambda is 1 minute.
   * So, we run a tick every 10s, exiting before the 60s lambda timeout is reached.
   */
  const interval = 10;
  const timeout = epochSeconds() + 60;
  const tickDuration = 5;
  let now = epochSeconds();

  try {
    const agentTypeToken = await getAgentTypeToken(ssmClient, agentTokenParameterName);

    while (true) {
      await tick(agentTypeToken, stackName, autoScalingClient, cloudwatchClient, semaphoreEndpoint);

      // Check if we will hit the timeout before sleeping.
      // We include a worst-case scenario for the next tick duration (5s) here too,
      // to avoid hitting the timeout while running the next tick.
      now = epochSeconds();
      if ((now + interval + tickDuration) >= timeout) {
        break
      }

      console.log(`Sleeping ${interval}s...`);
      await sleep(interval * 1000);
    }

    return {
      statusCode: 200,
      message: "success",
    }
  } catch (e) {
    console.error("Error fetching agent type token", e);
    return {
      statusCode: 500,
      message: "error",
    }
  }
};