var aws = require("aws-sdk");

function completeLifecycleAction(result, event) {
  var autoscaling = new aws.AutoScaling({region: event.region});

  console.log("Completing lifecycle action with result '" + result + "'.");

  return new Promise(function(resolve, reject) {
    var params = {
      LifecycleActionResult: result,
      AutoScalingGroupName: event.detail.AutoScalingGroupName,
      LifecycleHookName: event.detail.LifecycleHookName,
      InstanceId: event.detail.EC2InstanceId,
      LifecycleActionToken: event.detail.LifecycleActionToken
    };

    autoscaling.completeLifecycleAction(params, function(err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getInstanceStatus(instanceId) {
  var ssm = new aws.SSM();

  return new Promise(function(resolve, reject) {
    var params = {
      Filters: [
        {
          Key: 'InstanceIds',
          Values: [instanceId]
        }
      ]
    };

    ssm.describeInstanceInformation(params, function(err, data) {
      if (err) {
        console.log("Error describing instance information: ", err);
        reject(err);
      } else {
        console.log("Describe instance information: ", data);
        if (data.InstanceInformationList.length === 0) {
          resolve('Offline');
        } else {
          var instance = data.InstanceInformationList[0];
          resolve(instance.PingStatus);
        }
      }
    });
  });
}

function startAgentOnInstance(agentConfigParameterName, instanceId) {
  var ssm = new aws.SSM();

  return new Promise(function(resolve, reject) {
    var params = {
      InstanceIds: [instanceId],
      DocumentName: 'AWS-RunShellScript',
      Parameters: {
        commands: [`/opt/semaphore/install-agent.sh ${agentConfigParameterName}`],
        executionTimeout: ['20']
      },
    };

    ssm.sendCommand(params, function(err, data) {
      if (err) {
        reject(err);
      } else {
        console.log("sendCommand: ", data);
        resolve(data.Command.CommandId);
      }
    });
  });
}

function getCommandStatus(commandId) {
  var ssm = new aws.SSM();

  return new Promise(function(resolve, reject) {
    var params = {
      CommandId: commandId
    };

    ssm.listCommands(params, function(err, data) {
      if (err) {
        reject(err);
      } else {
        console.log("listCommands: ", data);
        var command = data.Commands[0];
        resolve(command.Status);
      }
    });
  });
}

function isFinalCommandStatus(status) {
  return status === "Success" || status === "Cancelled" || status === "Failed" || status === "TimedOut";
}

exports.handler = async (event, context, callback) => {
  console.log('Received event: ', JSON.stringify(event, null, 2));

  var agentConfigParameterName = process.env.AGENT_CONFIG_PARAMETER_NAME;
  var lifecycleActionResult = 'CONTINUE';
  var eventDetail = event.detail;
  var instanceId = eventDetail.EC2InstanceId;

  switch (eventDetail.Destination) {
    case "WarmPool":
      console.log("Instance '" + instanceId + "' entered the warm pool. Nothing to do for now.");
      break;
    case "AutoScalingGroup":
      try {

        // Poll instance state
        // SSM Run Command can only run once the SSM agent in the instance is Online
        var instanceStatus = 'Offline';
        for (let i = 0; i <= 12 && instanceStatus != 'Online'; i++) {
          console.log("Checking status for '" + instanceId + "'...");
          instanceStatus = await getInstanceStatus(instanceId);
          console.log("Status for instance '" + instanceId + "' is '" + instanceStatus + "'.");
          if (instanceStatus != 'Online') {
            console.log("Instance '" + instanceId + "' is '" + instanceStatus + "'. Waiting 5s before checking again...");
            await sleep(5000);
          }
        }

        // If after waiting for a while, the instance is not online yet, abort
        if (instanceStatus != 'Online') {
          console.log("Instance '" + instanceId + "' is still '" + instanceStatus + "'. Giving up.");
          lifecycleActionResult = 'ABANDON';
          break;
        }

        // Instance is online, let's execute the command to start the agent
        console.log("Instance '" + instanceId + "' is '" + instanceStatus + "'. Sending command to start agent...");
        var commandId = await startAgentOnInstance(agentConfigParameterName, instanceId);
        var commandStatus = 'Pending';

        // Poll the command status
        for (let i = 0; i <= 12 && !isFinalCommandStatus(commandStatus); i++) {
          console.log("Checking status for command '" + commandId + "'...");
          commandStatus = await getCommandStatus(commandId);
          console.log("Status for command '" + commandId + "' is '" + commandStatus + "'.");
          if (!isFinalCommandStatus(commandStatus)) {
            console.log("Command '" + commandId + "' is '" + commandStatus + "'. Waiting 2s before checking again...");
            await sleep(2000);
          }
        }

        if (commandStatus != 'Success') {
          console.log("Command to start agent on '" + instanceId + "' failed. Aborting.");
          lifecycleActionResult = 'ABANDON';
          break;
        } else {
          console.log("Successfully started agent on '" + instanceId + "'.");
        }
      } catch (e) {
        console.log("Error polling or starting agent on instance '" + instanceId + "'.", e);
        lifecycleActionResult = 'ABANDON';
      }

      break;
    default:
      console.log("Unknown destination '" + eventDetail.Destination + "'. Ignoring.");
  }

  try {
    await completeLifecycleAction(lifecycleActionResult, event);
    return {
      statusCode: 200,
      message: "success",
    };
  } catch (e) {
    console.log("Error completing lifecycle action for instance '" + eventDetail.EC2InstanceId + "'.", e);
    return {
      statusCode: 500,
      message: "error",
    };
  }
};
