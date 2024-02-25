const packageInfo = require("../package.json");
const { hash } = require("./ami-hash");
const { DynamicSSHKeysUpdater } = require("./dynamic-ssh-keys-updater");
const { DependencyGroup } = require("constructs");
const { Stack, Duration, Fn, CustomResource } = require("aws-cdk-lib");
const { Provider } = require("aws-cdk-lib/custom-resources");
const { Rule, Schedule } = require("aws-cdk-lib/aws-events");
const { LambdaFunction } = require("aws-cdk-lib/aws-events-targets");
const { RetentionDays } = require("aws-cdk-lib/aws-logs");
const { StringParameter, ParameterTier } = require("aws-cdk-lib/aws-ssm");
const { Function, Runtime, AssetCode } = require("aws-cdk-lib/aws-lambda");
const { Policy, PolicyStatement, Role, ServicePrincipal, ManagedPolicy, Effect } = require("aws-cdk-lib/aws-iam");
const { CfnAutoScalingGroup } = require("aws-cdk-lib/aws-autoscaling");
const { Alias } = require("aws-cdk-lib/aws-kms");
const { SecurityGroup, Vpc, Peer, Port, LookupMachineImage, UserData, LaunchTemplate, SubnetType, InstanceInitiatedShutdownBehavior } = require("aws-cdk-lib/aws-ec2");
const { CfnGroup } = require("aws-cdk-lib/aws-resourcegroups");

class AwsSemaphoreAgentStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    this.argumentStore = props.argumentStore;

    new DynamicSSHKeysUpdater(this, 'sshKeysUpdater', {
      parameterName: this.sshKeysParamName(),
      keys: props.sshKeys
    })

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
    let instanceRole = this.createIamInstanceRole(defaultSSMKey);
    let securityGroup = this.createSecurityGroup();
    let launchTemplate = this.createLaunchTemplate(ssmParameter, instanceRole, securityGroup);
    let autoScalingGroup = this.createAutoScalingGroup(launchTemplate);
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

  sshKeysParamName() {
    return `${this.stackName}-ssh-public-keys`;
  }

  createSSMParameter() {
    const cacheBucketName = this.argumentStore.get("SEMAPHORE_AGENT_CACHE_BUCKET_NAME");
    const envVars = cacheBucketName
      ? [
        "SEMAPHORE_CACHE_BACKEND=s3",
        `SEMAPHORE_CACHE_S3_BUCKET=${cacheBucketName}`,
        "SEMAPHORE_CACHE_USE_EC2_INSTANCE_PROFILE=true",
      ]
      : [];

    return new StringParameter(this, `SemaphoreAgentConfigParameter`, {
      description: 'Parameters required by the semaphore agent',
      parameterName: this.agentConfigParamName(),
      tier: ParameterTier.STANDARD,
      stringValue: JSON.stringify({
        endpoint: this.argumentStore.getSemaphoreEndpoint(),
        agentTokenParameterName: this.argumentStore.get("SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME"),
        sshKeysParameterName: this.sshKeysParamName(),
        disconnectAfterJob: this.argumentStore.get("SEMAPHORE_AGENT_DISCONNECT_AFTER_JOB"),
        disconnectAfterIdleTimeout: this.argumentStore.get("SEMAPHORE_AGENT_DISCONNECT_AFTER_IDLE_TIMEOUT"),
        envVars: envVars,
        usePreSignedURL: this.argumentStore.getAsBool("SEMAPHORE_AGENT_USE_PRE_SIGNED_URL")
      })
    });
  }

  createIamInstanceRole(defaultAWSSSMKey) {
    let tokenKmsKey = this.argumentStore.get("SEMAPHORE_AGENT_TOKEN_KMS_KEY") || defaultAWSSSMKey.keyId
    let policy = new Policy(this, 'instanceProfilePolicy', {
      policyName: `${this.stackName}-instance-profile-policy`,
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            "ec2:DescribeAutoScalingInstances"
          ],
          resources: [`*`],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            "ec2:CreateReplaceRootVolumeTask"
          ],
          resources: [`arn:aws:ec2:*:${this.account}:instance/*`],
          conditions: [
            StringLike: {
              "aws:userid": "*:${ec2:InstanceID}"
            }
          ]
        }),
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
            `arn:aws:ssm:*:*:parameter/${this.sshKeysParamName()}`,
            `arn:aws:ssm:*:*:parameter/${this.argumentStore.get("SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME")}`,
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
            "logs:CreateLogStream",
            "logs:DescribeLogStreams",
            "logs:DescribeLogGroups",
            "logs:PutLogEvents",
            "logs:PutRetentionPolicy"
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
      managedPolicies: this.getInstanceProfileRoleManagedPolicies()
    });

    policy.attachToRole(role);
    return role;
  }

  getInstanceProfileRoleManagedPolicies() {
    let managedPolicies = [
      ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2RoleforSSM')
    ];

    if (!this.argumentStore.isEmpty("SEMAPHORE_AGENT_MANAGED_POLICY_NAMES")) {
      this.argumentStore.getAsList("SEMAPHORE_AGENT_MANAGED_POLICY_NAMES")
        .map((policyName, index) => ManagedPolicy.fromManagedPolicyName(this, `customPolicy${index}`, policyName))
        .forEach(policy => managedPolicies.push(policy));
    }

    return managedPolicies;
  }

  createSecurityGroup() {
    let securityGroupId = this.argumentStore.get("SEMAPHORE_AGENT_SECURITY_GROUP_ID");
    if (securityGroupId) {
      return SecurityGroup.fromLookupById(this, "securityGroup", securityGroupId)
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

    return securityGroup;
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
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["cloudwatch:PutMetricData"],
          resources: ["*"]
        })
      ]
    });

    let managedPolicies = [
      ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
    ]

    if (!this.argumentStore.isEmpty("SEMAPHORE_AGENT_VPC_ID")) {
      managedPolicies.push(
        ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaVPCAccessExecutionRole")
      )
    }

    let role = new Role(this, 'scalerLambdaRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: managedPolicies
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

    let opts = {
      description: `Dynamically scale Semaphore agents based on jobs demand`,
      runtime: Runtime.NODEJS_18_X,
      timeout: Duration.seconds(60),
      code: new AssetCode('lambdas/agent-scaler'),
      handler: 'app.handler',
      reservedConcurrentExecutions: 1,
      maxEventAge: Duration.minutes(1),
      retryAttempts: 0,
      role: lambdaRole,
      logRetention: RetentionDays.ONE_MONTH,
      environment: {
        "SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME": this.argumentStore.get("SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME"),
        "SEMAPHORE_AGENT_STACK_NAME": this.stackName,
        "SEMAPHORE_ENDPOINT": this.argumentStore.getSemaphoreEndpoint(),
        "SEMAPHORE_AGENT_OVERPROVISION_STRATEGY": this.argumentStore.get("SEMAPHORE_AGENT_OVERPROVISION_STRATEGY"),
        "SEMAPHORE_AGENT_OVERPROVISION_FACTOR": this.argumentStore.get("SEMAPHORE_AGENT_OVERPROVISION_FACTOR"),
      }
    }

    if (!this.argumentStore.isEmpty("SEMAPHORE_AGENT_VPC_ID")) {
      opts.vpc = Vpc.fromLookup(this, 'LambdaVPC', {
        vpcId: this.argumentStore.get("SEMAPHORE_AGENT_VPC_ID")
      })

      opts.vpcSubnets = {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS
      }
    }

    let lambdaFunction = new Function(this, 'scalerLambda', opts);

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

  createLaunchTemplate(ssmParameter, instanceRole, securityGroup) {
    const launchTemplateDependencies = new DependencyGroup();
    launchTemplateDependencies.add(instanceRole);
    launchTemplateDependencies.add(ssmParameter);

    const keyName = this.argumentStore.get("SEMAPHORE_AGENT_KEY_NAME")
    let launchTemplate = new LaunchTemplate(this, 'launchTemplate', {
      instanceType: this.argumentStore.get("SEMAPHORE_AGENT_INSTANCE_TYPE"),
      machineImage: this.findMachineImage(),
      role: instanceRole,
      userData: this.getUserData(),
      blockDevices: this.createBlockDevices(),
      securityGroup: securityGroup,
      instanceInitiatedShutdownBehavior: InstanceInitiatedShutdownBehavior.TERMINATE,
      keyName: keyName != "" ? keyName : undefined
    });

    if (this.argumentStore.get("SEMAPHORE_AGENT_OS") == "macos") {
      const dedicatedHostARNs = this.argumentStore
        .getAsList("SEMAPHORE_AGENT_MAC_DEDICATED_HOSTS")
        .map(hostId => `arn:aws:ec2:${this.region}:${this.account}:dedicated-host/${hostId}`);

      const hostResourceGroup = new CfnGroup(this, "hostResourceGroup", {
        name: this.stackName,
        resources: dedicatedHostARNs,
        configuration: [
          {
            type: "AWS::EC2::HostManagement",
            parameters: [
              {
                name: "allowed-host-based-license-configurations",
                values: [this.argumentStore.get("SEMAPHORE_AGENT_LICENSE_CONFIGURATION_ARN")]
              },
              {
                name: "allowed-host-families",
                values: [this.argumentStore.get("SEMAPHORE_AGENT_MAC_FAMILY")]
              },
              {
                name: "auto-allocate-host",
                values: ["true"]
              },
              {
                name: "auto-release-host",
                values: ["true"]
              }
            ],
          },
          {
            type: "AWS::ResourceGroups::Generic",
            parameters: [
              {
                name: "allowed-resource-types",
                values: ["AWS::EC2::Host"]
              },
              {
                name: "deletion-protection",
                values: ["UNLESS_EMPTY"]
              }
            ]
          }
        ]
      })

      // The LaunchTemplate L2 construct does not expose a placement parameter,
      // so we need to access the underlying L1 construct for the launch template.
      launchTemplate.node.defaultChild.launchTemplateData.placement = {
        hostResourceGroupArn: hostResourceGroup.attrArn
      }
      launchTemplate.node.defaultChild.launchTemplateData.licenseSpecifications = [{
        licenseConfigurationArn: this.argumentStore.get("SEMAPHORE_AGENT_LICENSE_CONFIGURATION_ARN")
      }]
    }

    launchTemplate.node.addDependency(launchTemplateDependencies);
    return launchTemplate;
  }

  findMachineImage() {
    if (this.argumentStore.isEmpty("SEMAPHORE_AGENT_AMI")) {
      const os = this.argumentStore.get("SEMAPHORE_AGENT_OS");
      const arch = this.argumentStore.get("SEMAPHORE_AGENT_ARCH");
      return new LookupMachineImage({
        architecture: `${arch}*`,
        name: `semaphore-agent-v${packageInfo.version}-${os}-${arch}-${hash(os)}`,
        owners: [this.account]
      })
    }

    return new LookupMachineImage({
      name: "*",
      filters: {
        "image-id": [this.argumentStore.get("SEMAPHORE_AGENT_AMI")]
      }
    })
  }

  createBlockDevices() {
    if (this.argumentStore.isEmpty("SEMAPHORE_AGENT_VOLUME_NAME")) {
      return undefined
    }

    return [
      {
        deviceName: this.argumentStore.get("SEMAPHORE_AGENT_VOLUME_NAME"),
        volume: {
          ebsDevice: {
            volumeType: this.argumentStore.get("SEMAPHORE_AGENT_VOLUME_TYPE"),
            volumeSize: this.argumentStore.getAsNumber("SEMAPHORE_AGENT_VOLUME_SIZE")
          }
        }
      }
    ]
  }

  createAutoScalingGroup(launchTemplate) {
    const cfnLaunchTemplate = launchTemplate.node.defaultChild
    let autoScalingGroup = new CfnAutoScalingGroup(this, 'autoScalingGroup', {
      launchTemplate: {
        launchTemplateId: cfnLaunchTemplate.ref,
        version: cfnLaunchTemplate.attrLatestVersionNumber
      },
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

    // Available metrics can be found here:
    // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_autoscaling.CfnAutoScalingGroup.MetricsCollectionProperty.html
    const asgMetrics = this.argumentStore.getAsList("SEMAPHORE_AGENT_ASG_METRICS")
    if (asgMetrics.length > 0) {
      autoScalingGroup.metricsCollection = [
        {
          granularity: "1Minute",
          metrics: asgMetrics
        }
      ]
    }

    if (!this.argumentStore.isEmpty("SEMAPHORE_AGENT_AZS")) {
      autoScalingGroup.availabilityZones = this.argumentStore.getAsList("SEMAPHORE_AGENT_AZS");
    } else if (this.argumentStore.isEmpty("SEMAPHORE_AGENT_VPC_ID")) {
      autoScalingGroup.availabilityZones = Stack.of(this).availabilityZones;
    } else {
      const subnets = this.argumentStore.getAsList("SEMAPHORE_AGENT_SUBNETS");
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
      runtime: Runtime.NODEJS_16_X,
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
