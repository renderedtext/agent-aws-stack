const packageInfo = require("../package.json");
const { hash } = require("./ami-hash");
const { DependencyGroup } = require("constructs");
const { Stack, Duration, Fn, CustomResource } = require("aws-cdk-lib");
const { Provider } = require("aws-cdk-lib/custom-resources");
const { Rule, Schedule } = require("aws-cdk-lib/aws-events");
const { LambdaFunction } = require("aws-cdk-lib/aws-events-targets");
const { RetentionDays } = require("aws-cdk-lib/aws-logs");
const { StringParameter, ParameterTier } = require("aws-cdk-lib/aws-ssm");
const { Function, Runtime, AssetCode } = require("aws-cdk-lib/aws-lambda");
const { Policy, PolicyStatement, Role, ServicePrincipal, ManagedPolicy, CfnInstanceProfile, Effect } = require("aws-cdk-lib/aws-iam");
const { CfnAutoScalingGroup, CfnLaunchConfiguration } = require("aws-cdk-lib/aws-autoscaling");
const { Alias } = require("aws-cdk-lib/aws-kms");
const { SecurityGroup, Vpc, Peer, Port, LookupMachineImage, UserData } = require("aws-cdk-lib/aws-ec2");

class AwsSemaphoreAgentStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    this.argumentStore = props.argumentStore;

    const defaultSSMKey = Alias.fromAliasName(this, 'DefaultSSMKey', 'alias/aws/ssm');

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
    let iamInstanceProfile = this.createIamInstanceProfile(defaultSSMKey);
    let securityGroups = this.createSecurityGroups();
    let launchConfiguration = this.createLaunchConfiguration(ssmParameter, iamInstanceProfile, securityGroups);
    let autoScalingGroup = this.createAutoScalingGroup(launchConfiguration);
    this.createAzRebalanceSuspender(autoScalingGroup);

    if (this.argumentStore.get("SEMAPHORE_AGENT_USE_DYNAMIC_SCALING") == "true") {
      let scalerLambdaRole = this.createScalerLambdaRole(defaultSSMKey, autoScalingGroup);
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
      ? [
        "SEMAPHORE_CACHE_BACKEND=s3",
        "SEMAPHORE_CACHE_AWS_PROFILE=semaphore__agent-aws-stack-instance-profile",
        `SEMAPHORE_CACHE_S3_BUCKET=${cacheBucketName}`
      ]
      : [];

    return new StringParameter(this, `SemaphoreAgentConfigParameter`, {
      description: 'Parameters required by the semaphore agent',
      parameterName: this.agentConfigParamName(),
      tier: ParameterTier.STANDARD,
      stringValue: JSON.stringify({
        endpoint: this.argumentStore.getSemaphoreEndpoint(),
        agentTokenParameterName: this.argumentStore.get("SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME"),
        disconnectAfterJob: this.argumentStore.get("SEMAPHORE_AGENT_DISCONNECT_AFTER_JOB"),
        disconnectAfterIdleTimeout: this.argumentStore.get("SEMAPHORE_AGENT_DISCONNECT_AFTER_IDLE_TIMEOUT"),
        envVars: envVars
      })
    });
  }

  createIamInstanceProfile(defaultAWSSSMKey) {
    let tokenKmsKey = this.argumentStore.get("SEMAPHORE_AGENT_TOKEN_KMS_KEY") || defaultAWSSSMKey.keyId
    let policy = new Policy(this, 'instanceProfilePolicy', {
      policyName: `${this.stackName}-instance-profile-policy`,
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            "autoscaling:SetInstanceHealth",
            "autoscaling:TerminateInstanceInAutoScalingGroup"
          ],
          resources: [`arn:aws:autoscaling:*:${this.account}:autoScalingGroup:*:autoScalingGroupName/${this.stackName}-autoScalingGroup-*`]
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
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            "logs:CreateLogGroup",
            "logs:PutRetentionPolicy",
            "logs:DeleteLogGroup"
          ],
          resources: [
            "arn:aws:logs:*:*:log-group:/semaphore/*"
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

    // We need to add this permission here, because we need to use
    // the exact ARN for the role. CloudFormation will truncate the
    // stack name from the role name, to make it fit into 64 characters.
    policy.addStatements(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["sts:AssumeRole"],
      resources: [role.roleArn]
    }))

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

    if (this.argumentStore.shouldAllowSSHIngress()) {
      securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(22), 'allow ssh access from anywhere');
    }

    return [securityGroup.securityGroupId];
  }

  createScalerLambdaRole(defaultAWSSSMKey, autoScalingGroup) {
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
          resources: [`arn:aws:autoscaling:*:${this.account}:autoScalingGroup:*:autoScalingGroupName/${this.stackName}-autoScalingGroup-*`]
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
      description: `Dynamically scale Semaphore agents based on jobs demand`,
      runtime: Runtime.NODEJS_14_X,
      timeout: Duration.seconds(60),
      code: new AssetCode('lambdas/agent-scaler/build'),
      handler: 'app.handler',
      role: lambdaRole,
      logRetention: RetentionDays.ONE_MONTH,
      environment: {
        "SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME": this.argumentStore.get("SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME"),
        "SEMAPHORE_AGENT_STACK_NAME": this.stackName,
        "SEMAPHORE_ENDPOINT": this.argumentStore.getSemaphoreEndpoint()
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

  createLaunchConfiguration(ssmParameter, iamInstanceProfile, securityGroups) {
    const launchConfigDependencies = new DependencyGroup();
    launchConfigDependencies.add(iamInstanceProfile);
    launchConfigDependencies.add(ssmParameter);

    let imageId = this.argumentStore.get("SEMAPHORE_AGENT_AMI")
    if (!imageId) {
      const os = this.argumentStore.get("SEMAPHORE_AGENT_OS");
      const arch = "x86_64";
      const props = {
        architecture: arch,
        name: `semaphore-agent-v${packageInfo.version}-${os}-${arch}-${hash(os)}`,
        owners: [this.account]
      }

      const machineImage = new LookupMachineImage(props).getImage(this)
      imageId = machineImage.imageId
    }

    let launchConfig = new CfnLaunchConfiguration(this, 'launchConfiguration', {
      imageId: imageId,
      instanceType: this.argumentStore.get("SEMAPHORE_AGENT_INSTANCE_TYPE"),
      iamInstanceProfile: iamInstanceProfile.attrArn,
      securityGroups: securityGroups,
      userData: Fn.base64(this.getUserData().render())
    });

    const keyName = this.argumentStore.get("SEMAPHORE_AGENT_KEY_NAME")
    if (keyName) {
      launchConfig.keyName = keyName;
    }

    launchConfig.node.addDependency(launchConfigDependencies);
    return launchConfig;
  }

  createAutoScalingGroup(launchConfiguration) {
    let autoScalingGroup = new CfnAutoScalingGroup(this, 'autoScalingGroup', {
      launchConfigurationName: launchConfiguration.ref,
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

    // if the desired capacity is not specified, leave it empty.
    // Setting a default desired capacity leads to Cloudformation resetting it during an in-place update.
    // That can be an issue if you have your stack configured to automatically scale up/down, so we don't do that here.
    const desiredCapacity = this.argumentStore.get("SEMAPHORE_AGENT_ASG_DESIRED")
    if (desiredCapacity != "") {
      autoScalingGroup.desiredCapacity = desiredCapacity;
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

  createAzRebalanceSuspender(autoScalingGroup) {
    let suspenderPolicy = new Policy(this, 'azRebalanceSuspenderPolicy', {
      policyName: `${this.stackName}-az-rebalance-suspender-policy`,
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["autoscaling:SuspendProcesses"],
          resources: [`arn:aws:autoscaling:*:${this.account}:autoScalingGroup:*:autoScalingGroupName/${this.stackName}-autoScalingGroup-*`]
        })
      ]
    });

    let suspenderRole = new Role(this, 'azRebalanceSuspenderRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ]
    });

    suspenderPolicy.attachToRole(suspenderRole);

    let suspenderFunction = new Function(this, 'azRebalanceSuspenderLambda', {
      description: "Suspend AZRebalance process for auto scaling group",
      runtime: Runtime.NODEJS_14_X,
      code: new AssetCode("lambdas/az-rebalance-suspender"),
      handler: "app.handler",
      role: suspenderRole,
      logRetention: RetentionDays.ONE_MONTH
    });

    const provider = new Provider(this, "azRebalanceSuspenderProvider", {
      onEventHandler: suspenderFunction,
      logRetention: RetentionDays.ONE_MONTH
    });

    return new CustomResource(this, "azRebalanceSuspender", {
      serviceToken: provider.serviceToken,
      properties: {
        AutoScalingGroupName: autoScalingGroup.ref
      }
    })
  }

  getUserData() {
    if (this.argumentStore.isWindowsStack()) {
      let userData = UserData.forWindows();
      userData.addCommands(`C:\\semaphore-agent\\start.ps1 ${this.agentConfigParamName()}`);
      return userData;
    }

    let userData = UserData.forLinux();
    userData.addCommands(`/opt/semaphore/agent/start.sh ${this.agentConfigParamName()}`);
    return userData;
  }
}

module.exports = { AwsSemaphoreAgentStack }
