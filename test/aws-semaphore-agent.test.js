const cdk = require('@aws-cdk/core');
const ssm = require("@aws-cdk/aws-ssm");
const { expect, haveResource, countResources, arrayWith, objectLike, anything, ABSENT } = require('@aws-cdk/assert');
const { AwsSemaphoreAgentStack } = require('../lib/aws-semaphore-agent-stack');
const { ArgumentStore } = require('../lib/argument-store');

describe("SSM parameter", () => {
  test("name is prefixed with stack name", () => {
    const stack = createStack(basicArgumentStore());
    expect(stack).to(haveResource('AWS::SSM::Parameter', {
      Type: "String",
      Name: "test-stack-config",
      Description: "Parameters required by the semaphore agent",
      Tier: ssm.ParameterTier.STANDARD
    }));
  })

  test("default values are used", () => {
    const stack = createStack(basicArgumentStore());
    expect(stack).to(haveResource('AWS::SSM::Parameter', {
      Value: JSON.stringify({
        organization: "test",
        agentTokenParameterName: "test-token",
        disconnectAfterJob: "true",
        disconnectAfterIdleTimeout: "300",
        envVars: []
      })
    }));
  })

  test("disconnect-after-job and disconnect-after-idle-timeout can be set", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_DISCONNECT_AFTER_JOB", "false");
    argumentStore.set("SEMAPHORE_AGENT_DISCONNECT_AFTER_IDLE_TIMEOUT", "120");

    const stack = createStack(argumentStore);
    expect(stack).to(haveResource('AWS::SSM::Parameter', {
      Value: JSON.stringify({
        organization: "test",
        agentTokenParameterName: "test-token",
        disconnectAfterJob: "false",
        disconnectAfterIdleTimeout: "120",
        envVars: []
      })
    }));
  });

  test("sets env vars, if using s3 bucket for caching", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_CACHE_BUCKET_NAME", "test-cache-bucket")

    const stack = createStack(argumentStore);
    expect(stack).to(haveResource('AWS::SSM::Parameter', {
      Value: JSON.stringify({
        organization: "test",
        agentTokenParameterName: "test-token",
        disconnectAfterJob: "true",
        disconnectAfterIdleTimeout: "300",
        envVars: ["SEMAPHORE_CACHE_BACKEND=s3", "SEMAPHORE_CACHE_S3_BUCKET=test-cache-bucket"]
      })
    }));
  });
})

describe("launch configuration", () => {
  test("name is prefixed with stack name", () => {
    const stack = createStack(basicArgumentStore());
    expect(stack).to(haveResource('AWS::AutoScaling::LaunchConfiguration', {
      LaunchConfigurationName: "test-stack-launch-configuration"
    }))
  })

  test("uses specified AMI", () => {
    const stack = createStack(basicArgumentStore());
    expect(stack).to(haveResource('AWS::AutoScaling::LaunchConfiguration', {
      ImageId: "DUMMY"
    }))
  })

  test("uses t2.micro as default", () => {
    const stack = createStack(basicArgumentStore());
    expect(stack).to(haveResource('AWS::AutoScaling::LaunchConfiguration', {
      InstanceType: "t2.micro"
    }))
  })

  test("uses specified instance type", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_INSTANCE_TYPE", "t2.medium");

    const stack = createStack(argumentStore);
    expect(stack).to(haveResource('AWS::AutoScaling::LaunchConfiguration', {
      InstanceType: "t2.medium"
    }))
  })

  test("creates security group with no ssh access, if no key is given", () => {
    const stack = createStack(basicArgumentStore());

    expect(stack).to(haveResource('AWS::EC2::SecurityGroup', {
      SecurityGroupEgress: [
        {
          CidrIp: "0.0.0.0/0",
          Description: "Allow all outbound traffic by default",
          IpProtocol: "-1"
        }
      ],
      SecurityGroupIngress: ABSENT
    }))

    expect(stack).to(haveResource('AWS::AutoScaling::LaunchConfiguration', {
      SecurityGroups: arrayWith(objectLike({
        "Fn::GetAtt": [anything(), "GroupId"]
      }))
    }))
  })

  test("creates security group with ssh access, if key is given", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_KEY_NAME", "test-key");

    const stack = createStack(argumentStore);
    expect(stack).to(haveResource('AWS::EC2::SecurityGroup', {
      SecurityGroupEgress: [
        {
          CidrIp: "0.0.0.0/0",
          Description: "Allow all outbound traffic by default",
          IpProtocol: "-1"
        }
      ],
      SecurityGroupIngress: [
        {
          CidrIp: "0.0.0.0/0",
          Description: "allow ssh access from anywhere",
          FromPort: 22,
          IpProtocol: "tcp",
          ToPort: 22
        }
      ]
    }))

    expect(stack).to(haveResource('AWS::AutoScaling::LaunchConfiguration', {
      SecurityGroups: arrayWith(objectLike({
        "Fn::GetAtt": [anything(), "GroupId"]
      }))
    }))
  })

  test("uses specified security group", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_SECURITY_GROUP_ID", "dummy-sg");

    const stack = createStack(argumentStore);
    expect(stack).to(countResources('AWS::EC2::SecurityGroup', 0));
    expect(stack).to(haveResource('AWS::AutoScaling::LaunchConfiguration', {
      SecurityGroups: ["dummy-sg"]
    }))
  })
})

describe("auto scaling group", () => {
  test("name is prefixed with stack name", () => {
    const stack = createStack(basicArgumentStore());
    expect(stack).to(haveResource('AWS::AutoScaling::AutoScalingGroup', {
      AutoScalingGroupName: "test-stack-asg"
    }))
  })

  test("default values are set if nothing is given", () => {
    const stack = createStack(basicArgumentStore());
    expect(stack).to(haveResource('AWS::AutoScaling::AutoScalingGroup', {
      DesiredCapacity: "1",
      MinSize: "0",
      MaxSize: "1"
    }))
  })

  test("desired, min and max can be specified", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_ASG_MIN_SIZE", "1");
    argumentStore.set("SEMAPHORE_AGENT_ASG_MAX_SIZE", "5");
    argumentStore.set("SEMAPHORE_AGENT_ASG_DESIRED", "3");

    const stack = createStack(argumentStore);
    expect(stack).to(haveResource('AWS::AutoScaling::AutoScalingGroup', {
      DesiredCapacity: "3",
      MinSize: "1",
      MaxSize: "5"
    }))
  })

  test("lifecycle hook for EC2_INSTANCE_LAUNCHING is created", () => {
    const stack = createStack(basicArgumentStore());
    expect(stack).to(haveResource('AWS::AutoScaling::AutoScalingGroup', {
      LifecycleHookSpecificationList: [
        {
          "DefaultResult": "ABANDON",
          "HeartbeatTimeout": 180,
          "LifecycleHookName": "test-stack-asg-lifecycle-hook",
          "LifecycleTransition": "autoscaling:EC2_INSTANCE_LAUNCHING"
        }
      ]
    }))
  })

  test("tags are used", () => {
    const stack = createStack(basicArgumentStore());
    expect(stack).to(haveResource('AWS::AutoScaling::AutoScalingGroup', {
      Tags: [
        {
          "Key": "application",
          "PropagateAtLaunch": true,
          "Value": "semaphore-agent"
        }
      ]
    }))
  })
})

describe("warm pool", () => {
  test("warm pool is used by default", () => {
    const stack = createStack(basicArgumentStore());
    expect(stack).to(haveResource('AWS::AutoScaling::WarmPool', {
      AutoScalingGroupName: "test-stack-asg",
      PoolState: "Stopped"
    }))
  })

  test("warm pool state can be set", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_ASG_WARM_POOL_STATE", "Running");
    const stack = createStack(argumentStore);
    expect(stack).to(haveResource('AWS::AutoScaling::WarmPool', {
      AutoScalingGroupName: "test-stack-asg",
      PoolState: "Running"
    }))
  })

  test("warm pool can be disabled", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_USE_WARM_POOL", "false");
    const stack = createStack(argumentStore);
    expect(stack).to(countResources("AWS::AutoScaling::WarmPool", 0))
  })
})

describe("scaler lambda", () => {
  test("all needed properties are set", () => {
    const stack = createStack(basicArgumentStore());

    expect(stack).to(countResources("AWS::Lambda::Function", 2))
    expect(stack).to(haveResource('AWS::Lambda::Function', {
      FunctionName: "test-stack-scaler-lambda",
      Description: "Lambda function to dynamically scale Semaphore agents for test-stack-asg based on jobs demand.",
      Runtime: "nodejs14.x",
      Timeout: 60,
      Code: anything(),
      Handler: "app.handler",
      Environment: {
        Variables: {
          SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME: "test-token",
          SEMAPHORE_AGENT_ASG_NAME: "test-stack-asg"
        }
      },
      Role: {
        "Fn::GetAtt": [
          anything(),
          "Arn"
        ]
      }
    }))
  })

  test("it can be disabled", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_USE_DYNAMIC_SCALING", "false");

    const stack = createStack(argumentStore);
    expect(stack).to(countResources("AWS::Lambda::Function", 1))
    expect(stack).notTo(haveResource('AWS::Lambda::Function', {
      FunctionName: "test-stack-scaler-lambda"
    }))
  })
})

function createStack(argumentStore) {
  const app = new cdk.App();
  return new AwsSemaphoreAgentStack(app, 'MyTestStack', {
    argumentStore,
    stackName: "test-stack",
    env: {
      account: "DUMMYACCOUNT",
      region: "us-east-1"
    }
  });
}

function basicArgumentStore() {
  return ArgumentStore.fromMap({
    SEMAPHORE_AGENT_AMI: "DUMMY",
    SEMAPHORE_AGENT_STACK_NAME: "test-stack",
    SEMAPHORE_ORGANIZATION: "test",
    SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME: "test-token"
  });
}