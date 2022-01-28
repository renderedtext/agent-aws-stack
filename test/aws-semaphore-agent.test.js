const cdk = require('@aws-cdk/core');
const ssm = require("@aws-cdk/aws-ssm");
const { expect, haveResource, countResources, arrayWith, objectLike, anything, ABSENT } = require('@aws-cdk/assert');
const { AwsSemaphoreAgentStack } = require('../lib/aws-semaphore-agent-stack');
const { ArgumentStore } = require('../lib/argument-store');
const { hash } = require('../lib/ami-hash');
const packageInfo = require("../package.json");

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

describe("instance profile", () => {
  test("name is prefixed with stack name", () => {
    const stack = createStack(basicArgumentStore());
    expect(stack).to(haveResource('AWS::IAM::InstanceProfile', {
      InstanceProfileName: "test-stack-instance-profile",
      Roles: anything(),
      Path: "/"
    }))
  })

  test("creates role", () => {
    const stack = createStack(basicArgumentStore());
    expect(stack).to(haveResource('AWS::IAM::Role', {
      RoleName: "test-stack-instance-profile-role",
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: {
              Service: "ec2.amazonaws.com"
            }
          }
        ],
        Version: anything()
      }
    }))
  })

  test("permissions to access cache bucket are not included, if bucket is not specified", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_TOKEN_KMS_KEY", "dummy-kms-key-id");

    const stack = createStack(argumentStore);
    expect(stack).to(haveResource('AWS::IAM::Policy', {
      PolicyName: "test-stack-instance-profile-policy",
      PolicyDocument: {
        Statement: [
          {
            Action: "autoscaling:TerminateInstanceInAutoScalingGroup",
            Effect: "Allow",
            Resource: "arn:aws:autoscaling:*:DUMMYACCOUNT:autoScalingGroup:*:autoScalingGroupName/test-stack-asg"
          },
          {
            Action: "ssm:GetParameter",
            Effect: "Allow",
            Resource: [
              "arn:aws:ssm:*:*:parameter/test-stack-config",
              "arn:aws:ssm:*:*:parameter/test-token"
            ]
          },
          {
            Action: "kms:Decrypt",
            Effect: "Allow",
            Resource: "arn:aws:kms:*:*:key/dummy-kms-key-id"
          }
        ],
        Version: anything()
      },
      Roles: anything(),
    }))
  })

  test("permissions to access cache bucket are included, if bucket is specified", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_TOKEN_KMS_KEY", "dummy-kms-key-id");
    argumentStore.set("SEMAPHORE_AGENT_CACHE_BUCKET_NAME", "test-cache-bucket");

    const stack = createStack(argumentStore);
    expect(stack).to(haveResource('AWS::IAM::Policy', {
      PolicyName: "test-stack-instance-profile-policy",
      PolicyDocument: {
        Statement: [
          {
            Action: "autoscaling:TerminateInstanceInAutoScalingGroup",
            Effect: "Allow",
            Resource: "arn:aws:autoscaling:*:DUMMYACCOUNT:autoScalingGroup:*:autoScalingGroupName/test-stack-asg"
          },
          {
            Action: "ssm:GetParameter",
            Effect: "Allow",
            Resource: [
              "arn:aws:ssm:*:*:parameter/test-stack-config",
              "arn:aws:ssm:*:*:parameter/test-token"
            ]
          },
          {
            Action: "kms:Decrypt",
            Effect: "Allow",
            Resource: "arn:aws:kms:*:*:key/dummy-kms-key-id"
          },
          {
            Action: [
              "s3:PutObject",
              "s3:GetObject",
              "s3:ListBucket",
              "s3:DeleteObject"
            ],
            Effect: "Allow",
            Resource: [
              "arn:aws:s3:::test-cache-bucket/*",
              `arn:aws:s3:::test-cache-bucket`
            ]
          }
        ],
        Version: anything()
      },
      Roles: anything(),
    }))
  })
})

describe("launch configuration", () => {
  test("name is prefixed with stack name", () => {
    const stack = createStack(basicArgumentStore());
    expect(stack).to(haveResource('AWS::AutoScaling::LaunchConfiguration', {
      LaunchConfigurationName: "test-stack-launch-configuration"
    }))
  })

  test("uses default AMI", () => {
    const stack = createStack(basicArgumentStore());
    expect(stack).to(haveResource('AWS::AutoScaling::LaunchConfiguration', {
      ImageId: "default-ami-id"
    }))
  })

  test("uses specified AMI", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_AMI", "ami-custom")

    const stack = createStack(argumentStore);
    expect(stack).to(haveResource('AWS::AutoScaling::LaunchConfiguration', {
      ImageId: "ami-custom"
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
})

describe("security group", () => {
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

describe("starter lambda", () => {
  test("all needed properties are set", () => {
    const stack = createStack(basicArgumentStore());

    expect(stack).to(countResources("AWS::Lambda::Function", 2))
    expect(stack).to(haveResource('AWS::Lambda::Function', {
      FunctionName: "test-stack-starter-lambda",
      Description: "Lambda function to start the Semaphore agent on instances of test-stack-asg that went into rotation.",
      Runtime: "nodejs14.x",
      Timeout: 180,
      Code: anything(),
      Handler: "app.handler",
      Environment: {
        Variables: {
          AGENT_CONFIG_PARAMETER_NAME: "test-stack-config"
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

  test("rule to route asg lifecycle events to lambda is created", () => {
    const stack = createStack(basicArgumentStore());
    expect(stack).to(haveResource('AWS::Events::Rule', {
      Name: "test-stack-asg-events-rule",
      Description: "Rule to route autoscaling events for test-stack-asg to a lambda function",
      EventPattern: {
        "source": ["aws.autoscaling"],
        "detail-type": ["EC2 Instance-launch Lifecycle Action"]
      },
      State: "ENABLED",
      Targets: anything()
    }))
  })

  test("proper permissions are in place", () => {
    const stack = createStack(basicArgumentStore());
    expect(stack).to(haveResource('AWS::IAM::Policy', {
      PolicyName: "test-stack-starter-lambda-policy",
      PolicyDocument: {
        Statement: [
          {
            Action: "autoscaling:CompleteLifecycleAction",
            Effect: "Allow",
            Resource: "arn:aws:autoscaling:*:DUMMYACCOUNT:autoScalingGroup:*:autoScalingGroupName/test-stack-asg"
          },
          {
            Action: "ssm:SendCommand",
            Effect: "Allow",
            Resource: [
              "arn:aws:ssm:*:*:document/AWS-RunShellScript",
              "arn:aws:ec2:*:*:instance/*"
            ]
          },
          {
            Action: [
              "ssm:DescribeInstanceInformation",
              "ssm:ListCommands"
            ],
            Effect: "Allow",
            Resource: "*"
          }
        ],
        Version: anything()
      },
      Roles: anything(),
    }))
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

  test("rule to schedule lambda execution is created", () => {
    const stack = createStack(basicArgumentStore());
    expect(stack).to(haveResource('AWS::Events::Rule', {
      Description: "Rule to dynamically invoke lambda function to scale test-stack-asg",
      Name: "test-stack-asg-scaler-rule",
      ScheduleExpression: "rate(1 minute)",
      State: "ENABLED",
      Targets: anything()
    }))
  })

  test("proper permissions created", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_TOKEN_KMS_KEY", "dummy-kms-key-id");

    const stack = createStack(argumentStore);
    expect(stack).to(haveResource('AWS::IAM::Policy', {
      PolicyName: "test-stack-scaler-lambda-policy",
      PolicyDocument: {
        Statement: [
          {
            Action: "autoscaling:DescribeAutoScalingGroups",
            Effect: "Allow",
            Resource: "*"
          },
          {
            Action: "autoscaling:SetDesiredCapacity",
            Effect: "Allow",
            Resource: "arn:aws:autoscaling:*:DUMMYACCOUNT:autoScalingGroup:*:autoScalingGroupName/test-stack-asg"
          },
          {
            Action: "ssm:GetParameter",
            Effect: "Allow",
            Resource: "arn:aws:ssm:*:*:parameter/test-token"
          },
          {
            Action: "kms:Decrypt",
            Effect: "Allow",
            Resource: "arn:aws:kms:*:*:key/dummy-kms-key-id"
          }
        ],
        Version: anything()
      },
      Roles: anything(),
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

describe("vpc and subnets", () => {
  test("uses default vpc if none is given", () => {
    const stack = createStack(basicArgumentStore());
    expect(stack).to(haveResource('AWS::AutoScaling::AutoScalingGroup', {
      VPCZoneIdentifier: ABSENT,
      AvailabilityZones: anything(),
    }))

    expect(stack).to(haveResource('AWS::EC2::SecurityGroup', {
      VpcId: "vpc-00000-default"
    }))
  })

  test("uses vpc and subnets if specified", () => {
    const argumentStore = basicArgumentStore();
    argumentStore.set("SEMAPHORE_AGENT_VPC_ID", "vpc-000000000-custom");
    argumentStore.set("SEMAPHORE_AGENT_SUBNETS", "subnet-00001,subnet-00002,subnet-00003");

    const stack = createStack(argumentStore);
    expect(stack).to(haveResource('AWS::AutoScaling::AutoScalingGroup', {
      VPCZoneIdentifier: ["subnet-00001", "subnet-00002", "subnet-00003"],
      AvailabilityZones: ABSENT,
    }))

    expect(stack).to(haveResource('AWS::EC2::SecurityGroup', {
      VpcId: "vpc-000000000-custom"
    }))
  })
})

function createStack(argumentStore) {
  const account = "DUMMYACCOUNT";
  const region = "us-east-1";
  const customVpcId = "vpc-000000000-custom";
  const defaultAmiName = `semaphore-agent-v${packageInfo.version}-ubuntu-focal-amd64-server-${hash()}`;
  const amiLookupContextKey = `ami:account=${account}:filters.image-type.0=machine:filters.name.0=${defaultAmiName}:filters.state.0=available:region=${region}`;
  const defaultVpcContextKey = `vpc-provider:account=${account}:filter.isDefault=true:region=${region}:returnAsymmetricSubnets=true`
  const customVpcContextKey = `vpc-provider:account=${account}:filter.vpc-id=${customVpcId}:region=${region}:returnAsymmetricSubnets=true`

  const app = new cdk.App({
    context: {
      [amiLookupContextKey]: "default-ami-id",
      [defaultVpcContextKey]: {
        "vpcId": "vpc-00000-default",
        "vpcCidrBlock": "172.31.0.0/16",
        "availabilityZones": [],
        "subnetGroups": [
          {
            "name": "Public",
            "type": "Public",
            "subnets": [
              {
                "subnetId": "subnet-dummy-1",
                "cidr": "172.31.32.0/20",
                "availabilityZone": "us-east-1a",
                "routeTableId": "rtb-dummy"
              },
              {
                "subnetId": "subnet-dummy-2",
                "cidr": "172.31.0.0/20",
                "availabilityZone": "us-east-1b",
                "routeTableId": "rtb-dummy"
              }
            ]
          }
        ]
      },
      [customVpcContextKey]: {
        "vpcId": "vpc-000000000-custom",
        "vpcCidrBlock": "10.0.0.0/16",
        "availabilityZones": [],
        "subnetGroups": [
          {
            "name": "public-subnet-for-testing",
            "type": "Public",
            "subnets": [
              {
                "subnetId": "subnet-00001",
                "cidr": "10.0.3.0/24",
                "availabilityZone": "us-east-1a",
                "routeTableId": "rtb-dummy"
              },
              {
                "subnetId": "subnet-00002",
                "cidr": "10.0.4.0/24",
                "availabilityZone": "us-east-1b",
                "routeTableId": "rtb-dummy"
              },
              {
                "subnetId": "subnet-00003",
                "cidr": "10.0.5.0/24",
                "availabilityZone": "us-east-1c",
                "routeTableId": "rtb-dummy"
              }
            ]
          }
        ]
      }
    }
  });

  return new AwsSemaphoreAgentStack(app, 'MyTestStack', {
    argumentStore,
    stackName: "test-stack",
    env: { account, region }
  });
}

function basicArgumentStore() {
  return ArgumentStore.fromMap({
    SEMAPHORE_AGENT_STACK_NAME: "test-stack",
    SEMAPHORE_ORGANIZATION: "test",
    SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME: "test-token"
  });
}