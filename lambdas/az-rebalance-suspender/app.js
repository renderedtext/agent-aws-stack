const { Agent } = require("https");
const { NodeHttpHandler } = require("@aws-sdk/node-http-handler");
const { AutoScalingClient, SuspendProcessesCommand } = require("@aws-sdk/client-auto-scaling");

const CONNECTION_TIMEOUT = 1000;
const SOCKET_TIMEOUT = 1000;

function suspendAutoScalingProcess(autoScalingClient, autoScalingGroupName) {
  console.log(`Suspending AZRebalance process for ${autoScalingGroupName}...`)

  const params = {
    AutoScalingGroupName: autoScalingGroupName,
    ScalingProcesses: ["AZRebalance"]
  }

  return new Promise(function(resolve, reject) {
    const command = new SuspendProcessesCommand(params);
    autoScalingClient.send(command, function(err, _data) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

exports.handler = async (event, context, callback) => {
  console.log('Received event: ', JSON.stringify(event, null, 2));

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

  if (event.RequestType != "Delete") {
    await suspendAutoScalingProcess(autoScalingClient, event.ResourceProperties.AutoScalingGroupName);
  }

  return {
    PhysicalResourceId: "CustomResourcePhysicalID"
  }
};