var aws = require("aws-sdk");

function suspendAutoScalingProcess(autoScalingGroupName) {
  console.log(`Suspending AZRebalance process for ${autoScalingGroupName}...`)
  const autoscaling = new aws.AutoScaling();
  const params = {
    AutoScalingGroupName: autoScalingGroupName,
    ScalingProcesses: ["AZRebalance"]
  }

  return new Promise(function(resolve, reject) {
    autoscaling.suspendProcesses(params, function(err, _data) {
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
  if (event.RequestType != "Delete") {
    await suspendAutoScalingProcess(event.ResourceProperties.AutoScalingGroupName);
  }

  return {
    PhysicalResourceId: "CustomResourcePhysicalID"
  }
};