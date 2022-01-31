const packageInfo = require("../package.json");
const { hash } = require("./ami-hash");
const { DependencyGroup } = require("constructs");
const { Stack, Duration, Fn } = require("aws-cdk-lib");
const { Rule, Schedule } = require("aws-cdk-lib/aws-events");
const { LambdaFunction } = require("aws-cdk-lib/aws-events-targets");
const { StringParameter, ParameterTier } = require("aws-cdk-lib/aws-ssm");
const { Function, Runtime, AssetCode } = require("aws-cdk-lib/aws-lambda");
const { Policy, PolicyStatement, Role, ServicePrincipal, ManagedPolicy, CfnInstanceProfile, Effect } = require("aws-cdk-lib/aws-iam");
const { CfnAutoScalingGroup, CfnLaunchConfiguration, CfnWarmPool, DefaultResult, LifecycleTransition } = require("aws-cdk-lib/aws-autoscaling");
const { Key } = require("aws-cdk-lib/aws-kms");
const { SecurityGroup, Vpc, Peer, Port, LookupMachineImage, UserData } = require("aws-cdk-lib/aws-ec2");

class AwsSemaphoreAgentStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    this.argumentStore = props.argumentStore;

    const defaultAWSSSMKey = Key.fromLookup(this, 'AWSSSMKey', { aliasName: 'alias/aws/ssm' });

    /**
     * When processing the lifecycle hook event for the instance going into rotation,
     * the lambda executes a script in the instance to install and start the agent.
     * That script needs the agent parameters (organization, agent version and user).
     * We expose those parameters through an SSM parameter.
     *
     * Note that the agent token is a sensitive piece of information and therefore,
     * is not stored in this parameter, but in a separate, encrypted parameter,
     * and passed to this application through the SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME
     * environment variable.
     */
    let ssmParameter = this.createSSMParameter();
    let hasWarmPool = this.argumentStore.get("SEMAPHORE_AGENT_USE_WARM_POOL") == "true";

    if (hasWarmPool) {
      /**
       * The starter lambda and EventBridge rule is created before the scaling group
       * because it needs to be present before the auto scaling group exists.
       * Otherwise, the initial instances will not have the agent started.
       */
      let lambdaRole = this.createStarterLambdaRole(ssmParameter);
      let lambda = this.createStarterLambda(lambdaRole);
      this.createStarterRule(lambda);
    }

    let iamInstanceProfile = this.createIamInstanceProfile(defaultAWSSSMKey);
    let securityGroups = this.createSecurityGroups();
    let launchConfiguration = this.createLaunchConfiguration(iamInstanceProfile, securityGroups, hasWarmPool);
    let autoScalingGroup = this.createAutoScalingGroup(launchConfiguration, hasWarmPool);

    if (hasWarmPool) {
      this.createWarmPool(autoScalingGroup);
    }

    if (this.argumentStore.get("SEMAPHORE_AGENT_USE_DYNAMIC_SCALING") == "true") {
      let scalerLambdaRole = this.createScalerLambdaRole(defaultAWSSSMKey, autoScalingGroup);
      let scalerLambda = this.createScalerLambda(scalerLambdaRole);
      this.createEventRuleForScaler(scalerLambda);
    }
  }

  agentConfigParamName() {
    return `${this.stackName}-config`;
  }

  createSSMParameter() {
    const cacheBucketName = this.argumentStore.get("SEMAPHORE_AGENT_CACHE_BUCKET_NAME");
    const envVars = cacheBucketName
      ? ["SEMAPHORE_CACHE_BACKEND=s3", `SEMAPHORE_CACHE_S3_BUCKET=${cacheBucketName}`]
      : [];

    return new StringParameter(this, `SemaphoreAgentConfigParameter`, {
      description: 'Parameters required by the semaphore agent',
      parameterName: this.agentConfigParamName(),
      tier: ParameterTier.STANDARD,
      stringValue: JSON.stringify({
        organization: this.argumentStore.get("SEMAPHORE_ORGANIZATION"),
        agentTokenParameterName: this.argumentStore.get("SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME"),
        disconnectAfterJob: this.argumentStore.get("SEMAPHORE_AGENT_DISCONNECT_AFTER_JOB"),
        disconnectAfterIdleTimeout: this.argumentStore.get("SEMAPHORE_AGENT_DISCONNECT_AFTER_IDLE_TIMEOUT"),
        envVars: envVars
      })
    });
  }

  createIamInstanceProfile(defaultAWSSSMKey) {
    let account = Stack.of(this).account;
    let tokenKmsKey = this.argumentStore.get("SEMAPHORE_AGENT_TOKEN_KMS_KEY") || defaultAWSSSMKey.keyId
    let policy = new Policy(this, 'instanceProfilePolicy', {
      policyName: `${this.stackName}-instance-profile-policy`,
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["autoscaling:TerminateInstanceInAutoScalingGroup"],
          resources: [`arn:aws:autoscaling:*:${account}:autoScalingGroup:*:autoScalingGroupName/${this.stackName}-autoScalingGroup-*`]
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["ssm:GetParameter"],
          resources: [
            `arn:aws:ssm:*:*:parameter/${this.agentConfigParamName()}`,
            `arn:aws:ssm:*:*:parameter/${this.argumentStore.get("SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME")}`
          ]
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["kms:Decrypt"],
          resources: [
            `arn:aws:kms:*:*:key/${tokenKmsKey}`
          ]
        })
      ]
    })

    const cacheBucket = this.argumentStore.get("SEMAPHORE_AGENT_CACHE_BUCKET_NAME");
    if (cacheBucket) {
      policy.addStatements(new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "s3:PutObject",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:DeleteObject"
        ],
        resources: [
          `arn:aws:s3:::${cacheBucket}/*`,
          `arn:aws:s3:::${cacheBucket}`
        ]
      }))
    }

    let role = new Role(this, 'instanceProfileRole', {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2RoleforSSM')
      ]
    });

    policy.attachToRole(role);

    let instanceProfileDeps = new DependencyGroup();
    instanceProfileDeps.add(role);

    let iamInstanceProfile = new CfnInstanceProfile(this, 'instanceProfile', {
      roles: [role.roleName],
      path: '/'
    })

    iamInstanceProfile.node.addDependency(instanceProfileDeps);
    return iamInstanceProfile;
  }

  createSecurityGroups() {
    let securityGroupId = this.argumentStore.get("SEMAPHORE_AGENT_SECURITY_GROUP_ID");
    if (securityGroupId) {
      return [securityGroupId]
    }

    const vpcLookupOptions = this.argumentStore.isEmpty("SEMAPHORE_AGENT_VPC_ID") ?
      {isDefault: true} : {vpcId: this.argumentStore.get("SEMAPHORE_AGENT_VPC_ID")}

    const securityGroup = new SecurityGroup(this, 'securityGroup', {
      vpc: Vpc.fromLookup(this, 'VPC', vpcLookupOptions),
      allowAllOutbound: true
    });

    // if key name is set, we allow ssh inbound access
    if (!this.argumentStore.isEmpty("SEMAPHORE_AGENT_KEY_NAME")) {
      securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(22), 'allow ssh access from anywhere');
    }

    return [securityGroup.securityGroupId];
  }

  createStarterLambdaRole(ssmParameter) {
    let account = Stack.of(this).account;
    let policy = new Policy(this, 'starterLambdaPolicy', {
      policyName: `${this.stackName}-starter-lambda-policy`,
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["autoscaling:CompleteLifecycleAction"],
          resources: [`arn:aws:autoscaling:*:${account}:autoScalingGroup:*:autoScalingGroupName/${this.stackName}-autoScalingGroup-*`]
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["ssm:SendCommand"],
          resources: [
            "arn:aws:ssm:*:*:document/AWS-RunShellScript",
            "arn:aws:ec2:*:*:instance/*"
          ]
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            "ssm:DescribeInstanceInformation",
            "ssm:ListCommands"
          ],
          resources: ["*"]
        })
      ]
    })

    let role = new Role(this, 'starterLambdaRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ]
    });

    policy.attachToRole(role);

    let roleDependencies = new DependencyGroup();
    roleDependencies.add(ssmParameter);
    role.node.addDependency(roleDependencies);

    return role;
  }

  createStarterLambda(lambdaRole) {
    const lambdaDependencies = new DependencyGroup();
    lambdaDependencies.add(lambdaRole);

    let lambdaFunction = new Function(this, 'starterLambda', {
      description: `Lambda function to start Semaphore agents`,
      runtime: Runtime.NODEJS_14_X,
      timeout: Duration.seconds(180),
      code: new AssetCode('lambdas/agent-starter'),
      handler: 'app.handler',
      role: lambdaRole,
      environment: {
        "AGENT_CONFIG_PARAMETER_NAME": this.agentConfigParamName()
      }
    });

    lambdaFunction.node.addDependency(lambdaDependencies);
    return lambdaFunction;
  }

  createScalerLambdaRole(defaultAWSSSMKey, autoScalingGroup) {
    let account = Stack.of(this).account;
    let agentTokenParameterName = this.argumentStore.get("SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME");
    let tokenKmsKey = this.argumentStore.get("SEMAPHORE_AGENT_TOKEN_KMS_KEY") || defaultAWSSSMKey.keyId
    let policy = new Policy(this, 'scalerLambdaPolicy', {
      policyName: `${this.stackName}-scaler-lambda-policy`,
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["autoscaling:DescribeAutoScalingGroups"],
          resources: ["*"]
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["autoscaling:SetDesiredCapacity"],
          resources: [`arn:aws:autoscaling:*:${account}:autoScalingGroup:*:autoScalingGroupName/${this.stackName}-autoScalingGroup-*`]
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["ssm:GetParameter"],
          resources: [
            `arn:aws:ssm:*:*:parameter/${agentTokenParameterName}`
          ]
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["kms:Decrypt"],
          resources: [
            `arn:aws:kms:*:*:key/${tokenKmsKey}`
          ]
        })
      ]
    });

    let role = new Role(this, 'scalerLambdaRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ]
    });

    policy.attachToRole(role);

    const roleDependencies = new DependencyGroup();
    roleDependencies.add(autoScalingGroup);
    role.node.addDependency(roleDependencies);

    return role;
  }

  createScalerLambda(lambdaRole) {
    const lambdaDependencies = new DependencyGroup();
    lambdaDependencies.add(lambdaRole);

    let lambdaFunction = new Function(this, 'scalerLambda', {
      description: `Lambda function to dynamically scale Semaphore agents based on jobs demand`,
      runtime: Runtime.NODEJS_14_X,
      timeout: Duration.seconds(60),
      code: new AssetCode('lambdas/agent-scaler/build'),
      handler: 'app.handler',
      role: lambdaRole,
      environment: {
        "SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME": this.argumentStore.get("SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME"),
        "SEMAPHORE_AGENT_STACK_NAME": this.stackName
      }
    });

    lambdaFunction.node.addDependency(lambdaDependencies);
    return lambdaFunction;
  }

  createEventRuleForScaler(lambda) {
    const ruleDependencies = new DependencyGroup();
    ruleDependencies.add(lambda);

    const rule = new Rule(this, 'scalerRule', {
      description: `Rule to dynamically invoke lambda function to scale Semaphore agent asg`,
      schedule: Schedule.expression('rate(1 minute)'),
      targets: [new LambdaFunction(lambda)]
    });

    rule.node.addDependency(ruleDependencies);
    return rule;
  }

  createStarterRule(lambda) {
    const ruleDependencies = new DependencyGroup();
    ruleDependencies.add(lambda);

    let rule = new Rule(this, 'starterRule', {
      description: `Rule to route Semaphore agent asg events to a lambda function`,
      eventPattern: {
        source: [ "aws.autoscaling" ],
        detailType: [ "EC2 Instance-launch Lifecycle Action" ]
      },
      targets: [new LambdaFunction(lambda)]
     });

    rule.node.addDependency(ruleDependencies);
  }

  createLaunchConfiguration(iamInstanceProfile, securityGroups, hasWarmPool) {
    const launchConfigDependencies = new DependencyGroup();
    launchConfigDependencies.add(iamInstanceProfile);

    let imageId = this.argumentStore.get("SEMAPHORE_AGENT_AMI")
    if (!imageId) {
      const name = `semaphore-agent-v${packageInfo.version}-ubuntu-focal-amd64-server-${hash()}`
      const machineImage = new LookupMachineImage({name}).getImage(this)
      imageId = machineImage.imageId
    }

    let launchConfig = new CfnLaunchConfiguration(this, 'launchConfiguration', {
      imageId: imageId,
      instanceType: this.argumentStore.get("SEMAPHORE_AGENT_INSTANCE_TYPE"),
      iamInstanceProfile: iamInstanceProfile.attrArn,
      securityGroups: securityGroups
    });

    const keyName = this.argumentStore.get("SEMAPHORE_AGENT_KEY_NAME")
    if (keyName) {
      launchConfig.keyName = keyName;
    }

    if (!hasWarmPool) {
      let userData = UserData.forLinux();
      userData.addCommands(`/opt/semaphore/agent/start.sh ${this.agentConfigParamName()}`)
      launchConfig.userData = Fn.base64(userData.render())
    }

    launchConfig.node.addDependency(launchConfigDependencies);
    return launchConfig;
  }

  createAutoScalingGroup(launchConfiguration, hasWarmPool) {
    let autoScalingGroup = new CfnAutoScalingGroup(this, 'autoScalingGroup', {
      launchConfigurationName: launchConfiguration.ref,
      desiredCapacity: this.argumentStore.get("SEMAPHORE_AGENT_ASG_DESIRED"),
      minSize: this.argumentStore.get("SEMAPHORE_AGENT_ASG_MIN_SIZE"),
      maxSize: this.argumentStore.get("SEMAPHORE_AGENT_ASG_MAX_SIZE"),
      cooldown: "60",
      tags: [
        {
          key: "application",
          value: "semaphore-agent",
          propagateAtLaunch: true
        }
      ],
    });

    if (hasWarmPool) {
      autoScalingGroup.lifecycleHookSpecificationList = [
        {
          lifecycleHookName: `${this.stackName}-boot-lifecycle-hook`,
          lifecycleTransition: LifecycleTransition.INSTANCE_LAUNCHING,
          defaultResult: DefaultResult.ABANDON,
          heartbeatTimeout: 180
        }
      ]
    }

    if (this.argumentStore.isEmpty("SEMAPHORE_AGENT_VPC_ID")) {
      autoScalingGroup.availabilityZones = Stack.of(this).availabilityZones;
    } else {
      const subnets = this.argumentStore
        .get("SEMAPHORE_AGENT_SUBNETS")
        .split(",")
        .filter(subnet => subnet != "");
      autoScalingGroup.vpcZoneIdentifier = subnets
    }

    return autoScalingGroup;
  }

  createWarmPool(autoScalingGroup) {
    new CfnWarmPool(this, 'warmPool', {
      autoScalingGroupName: autoScalingGroup.ref,
      poolState: this.argumentStore.get("SEMAPHORE_AGENT_ASG_WARM_POOL_STATE")
    });
  }
}

module.exports = { AwsSemaphoreAgentStack }
