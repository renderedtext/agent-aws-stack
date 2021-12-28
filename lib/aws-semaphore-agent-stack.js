const cdk = require('@aws-cdk/core');
const iam = require("@aws-cdk/aws-iam");
const lambda = require("@aws-cdk/aws-lambda");
const events = require("@aws-cdk/aws-events");
const eventTargets = require("@aws-cdk/aws-events-targets");
const autoscaling = require("@aws-cdk/aws-autoscaling");
const ssm = require("@aws-cdk/aws-ssm");
const kms = require("@aws-cdk/aws-kms");
const ec2 = require("@aws-cdk/aws-ec2");

const stackPrefix = "semaphore-agent";
const autoscalingGroupName = `${stackPrefix}-asg`;
const ssmAgentConfigParameterName = `${stackPrefix}-config`;

class AwsSemaphoreAgentStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    this.argumentStore = props.argumentStore;

    const defaultAWSSSMKey = kms.Key.fromLookup(this, 'AWSSSMKey', { aliasName: 'alias/aws/ssm' });

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

    /**
     * The lambda and EventBridge rule is created before the scaling group
     * because it needs to be present before the auto scaling group exists.
     * Otherwise, the initial instances will not have the agent started.
     */
    let lambdaRole = this.createRoleForLambda(ssmParameter);
    let lambda = this.createLambdaFunction(lambdaRole);
    this.createEventBridgeRule(lambda);

    let iamInstanceProfile = this.createIamInstanceProfile(defaultAWSSSMKey);
    let securityGroups = this.createSecurityGroups();
    let launchConfiguration = this.createLaunchConfiguration(iamInstanceProfile, securityGroups);
    let autoScalingGroup = this.createAutoScalingGroup(launchConfiguration);

    this.createWarmPool(autoScalingGroup);

    let scalerLambdaRole = this.createScalerLambdaRole(defaultAWSSSMKey, autoScalingGroup);
    let scalerLambda = this.createScalerLambda(scalerLambdaRole);
    this.createEventRuleForScaler(scalerLambda);
  }

  createSSMParameter() {
    return new ssm.StringParameter(this, `SemaphoreAgentConfigParameter`, {
      description: 'Parameters required by the semaphore agent',
      parameterName: ssmAgentConfigParameterName,
      tier: ssm.ParameterTier.STANDARD,
      stringValue: JSON.stringify({
        agentVersion: this.argumentStore.get("SEMAPHORE_AGENT_VERSION"),
        organization: this.argumentStore.get("SEMAPHORE_ORGANIZATION"),
        agentTokenParameterName: this.argumentStore.get("SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME"),
        vmUser: this.argumentStore.get("SEMAPHORE_AGENT_VM_USER"),
        disconnectAfterJob: this.argumentStore.get("SEMAPHORE_AGENT_DISCONNECT_AFTER_JOB"),
        disconnectAfterIdleTimeout: this.argumentStore.get("SEMAPHORE_AGENT_DISCONNECT_AFTER_IDLE_TIMEOUT")
      })
    });
  }

  createIamInstanceProfile(defaultAWSSSMKey) {
    let account = cdk.Stack.of(this).account;
    let ec2Role = new iam.Role(this, 'ec2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      roleName: `${stackPrefix}-ec2-role`
    });

    ec2Role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2RoleforSSM'));
    ec2Role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["autoscaling:TerminateInstanceInAutoScalingGroup"],
      resources: [`arn:aws:autoscaling:*:${account}:autoScalingGroup:*:autoScalingGroupName/${autoscalingGroupName}`]
    }));

    const agentTokenParameterName = this.argumentStore.get("SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME");
    ec2Role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["ssm:GetParameter"],
      resources: [
        `arn:aws:ssm:*:*:parameter/${ssmAgentConfigParameterName}`,
        `arn:aws:ssm:*:*:parameter/${agentTokenParameterName}`
      ]
    }))

    ec2Role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["kms:Decrypt"],
      resources: [
        `arn:aws:kms:*:*:key/${defaultAWSSSMKey.keyId}`
      ]
    }))

    const instanceProfileDeps = new cdk.ConcreteDependable();
    instanceProfileDeps.add(ec2Role);

    let iamInstanceProfile = new iam.CfnInstanceProfile(this, 'iamInstanceProfile', {
      instanceProfileName: `${stackPrefix}-iam-instance-profile`,
      roles: [ec2Role.roleName],
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

    const securityGroup = new ec2.SecurityGroup(this, 'securityGroup', {
      vpc: ec2.Vpc.fromLookup(this, 'DefaultVPC', {isDefault: true}),
      description: "Allow ssh access to agents",
      allowAllOutbound: true
    });

    // if key name is set, we allow ssh inbound access
    if (!this.argumentStore.isEmpty("SEMAPHORE_AGENT_KEY_NAME")) {
      securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'allow ssh access from anywhere');
    }

    return [securityGroup.securityGroupId];
  }

  createRoleForLambda(ssmParameter) {
    const lambdaRoleDependencies = new cdk.ConcreteDependable();
    lambdaRoleDependencies.add(ssmParameter);

    let account = cdk.Stack.of(this).account;
    let lambdaRole = new iam.Role(this, 'starterLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      roleName: `${stackPrefix}-starter-lambda-role`
    });

    lambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));

    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["autoscaling:CompleteLifecycleAction"],
      resources: [`arn:aws:autoscaling:*:${account}:autoScalingGroup:*:autoScalingGroupName/${autoscalingGroupName}`]
    }));

    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["ssm:SendCommand"],
      resources: [
        "arn:aws:ssm:*:*:document/AWS-RunShellScript",
        "arn:aws:ec2:*:*:instance/*"
      ]
    }));

    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ssm:DescribeInstanceInformation",
        "ssm:ListCommands"
      ],
      resources: ["*"]
    }));

    lambdaRole.node.addDependency(lambdaRoleDependencies);
    return lambdaRole;
  }

  createLambdaFunction(lambdaRole) {
    const lambdaDependencies = new cdk.ConcreteDependable();
    lambdaDependencies.add(lambdaRole);

    let lambdaFunction = new lambda.Function(this, 'StartAgentLambdaFunction', {
      functionName: `${stackPrefix}-start-lambda`,
      description: `Lambda function to start the Semaphore agent on instances of ${autoscalingGroupName} that went into rotation.`,
      runtime: lambda.Runtime.NODEJS_14_X,
      timeout: cdk.Duration.seconds(120),
      code: new lambda.AssetCode('lambdas/agent-starter'),
      handler: 'app.handler',
      role: lambdaRole,
      environment: {
        "AGENT_CONFIG_PARAMETER_NAME": ssmAgentConfigParameterName
      }
    });

    lambdaFunction.node.addDependency(lambdaDependencies);
    return lambdaFunction;
  }

  createScalerLambdaRole(defaultAWSSSMKey, autoScalingGroup) {
    const roleDependencies = new cdk.ConcreteDependable();
    roleDependencies.add(autoScalingGroup);

    let account = cdk.Stack.of(this).account;
    let role = new iam.Role(this, 'scalerLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      roleName: `${stackPrefix}-scaler-lambda-role`
    });

    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));

    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["autoscaling:DescribeAutoScalingGroups"],
      resources: ["*"]
    }));

    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["autoscaling:SetDesiredCapacity"],
      resources: [`arn:aws:autoscaling:*:${account}:autoScalingGroup:*:autoScalingGroupName/${autoscalingGroupName}`]
    }));

    const agentTokenParameterName = this.argumentStore.get("SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME");
    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["ssm:GetParameter"],
      resources: [
        `arn:aws:ssm:*:*:parameter/${agentTokenParameterName}`
      ]
    }))

    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["kms:Decrypt"],
      resources: [
        `arn:aws:kms:*:*:key/${defaultAWSSSMKey.keyId}`
      ]
    }))

    role.node.addDependency(roleDependencies);
    return role;
  }

  createScalerLambda(lambdaRole) {
    const lambdaDependencies = new cdk.ConcreteDependable();
    lambdaDependencies.add(lambdaRole);

    let lambdaFunction = new lambda.Function(this, 'ScaleAgentsLambdaFunction', {
      functionName: `${stackPrefix}-scaler-lambda`,
      description: `Lambda function to dynamically scale Semaphore agents for ${autoscalingGroupName} based on jobs demand.`,
      runtime: lambda.Runtime.NODEJS_14_X,
      timeout: cdk.Duration.seconds(60),
      code: new lambda.AssetCode('lambdas/agent-scaler'),
      handler: 'app.handler',
      role: lambdaRole,
      environment: {
        "SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME": this.argumentStore.get("SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME"),
        "SEMAPHORE_AGENT_ASG_NAME": autoscalingGroupName
      }
    });

    lambdaFunction.node.addDependency(lambdaDependencies);
    return lambdaFunction;
  }

  createEventRuleForScaler(lambda) {
    const ruleDependencies = new cdk.ConcreteDependable();
    ruleDependencies.add(lambda);

    const rule = new events.Rule(this, 'ScaleAgentsRule', {
      ruleName: `${stackPrefix}-asg-scaler-rule`,
      description: `Rule to dynamically invoke lambda function to scale ${autoscalingGroupName}`,
      schedule: events.Schedule.expression('rate(1 minute)'),
      targets: [new eventTargets.LambdaFunction(lambda)]
    });

    rule.node.addDependency(ruleDependencies);
    return rule;
  }

  createEventBridgeRule(lambda) {
    const ruleDependencies = new cdk.ConcreteDependable();
    ruleDependencies.add(lambda);

    let rule = new events.Rule(this, 'asgLifecycleEventsRule', {
      ruleName: `${stackPrefix}-asg-events-rule`,
      description: `Rule to route autoscaling events for ${autoscalingGroupName} to a lambda function`,
      eventPattern: {
        source: [ "aws.autoscaling" ],
        detailType: [ "EC2 Instance-launch Lifecycle Action" ]
      },
      targets: [new eventTargets.LambdaFunction(lambda)]
     });

    rule.node.addDependency(ruleDependencies);
  }

  createLaunchConfiguration(iamInstanceProfile, securityGroups) {
    const launchConfigDependencies = new cdk.ConcreteDependable();
    launchConfigDependencies.add(iamInstanceProfile);

    let launchConfig = new autoscaling.CfnLaunchConfiguration(this, 'launchConfiguration', {
      launchConfigurationName: `${stackPrefix}-launch-configuration`,
      imageId: this.argumentStore.get("SEMAPHORE_AGENT_AMI"),
      instanceType: this.argumentStore.get("SEMAPHORE_AGENT_INSTANCE_TYPE"),
      iamInstanceProfile: iamInstanceProfile.attrArn,
      securityGroups: securityGroups
    });

    const keyName = this.argumentStore.get("SEMAPHORE_AGENT_KEY_NAME")
    if (keyName) {
      launchConfig.keyName = keyName;
    }

    launchConfig.node.addDependency(launchConfigDependencies);
    return launchConfig;
  }

  createAutoScalingGroup(launchConfiguration) {
    const availabilityZones = cdk.Stack.of(this).availabilityZones;

    const autoScalingGroupDependencies = new cdk.ConcreteDependable();
    autoScalingGroupDependencies.add(launchConfiguration);

    let autoScalingGroup = new autoscaling.CfnAutoScalingGroup(this, 'autoScalingGroup', {
      autoScalingGroupName: `${autoscalingGroupName}`,
      launchConfigurationName: launchConfiguration.launchConfigurationName,
      desiredCapacity: this.argumentStore.get("SEMAPHORE_AGENT_ASG_DESIRED"),
      minSize: this.argumentStore.get("SEMAPHORE_AGENT_ASG_MIN_SIZE"),
      maxSize: this.argumentStore.get("SEMAPHORE_AGENT_ASG_MAX_SIZE"),
      availabilityZones: availabilityZones,
      cooldown: "60",
      lifecycleHookSpecificationList: [
        {
          lifecycleHookName: `${autoscalingGroupName}-lifecycle-hook`,
          lifecycleTransition: autoscaling.LifecycleTransition.INSTANCE_LAUNCHING,
          defaultResult: autoscaling.DefaultResult.ABANDON,
          heartbeatTimeout: 60
        }
      ],
      tags: [
        {
          key: "application",
          value: "semaphore-agent",
          propagateAtLaunch: true
        }
      ]
    });

    autoScalingGroup.node.addDependency(autoScalingGroupDependencies);
    return autoScalingGroup;
  }

  createWarmPool(autoScalingGroup) {
    const warmPoolDependencies = new cdk.ConcreteDependable();
    warmPoolDependencies.add(autoScalingGroup);

    let warmPool = new autoscaling.CfnWarmPool(this, 'warmPool', {
      autoScalingGroupName: autoScalingGroup.autoScalingGroupName,
      poolState: this.argumentStore.get("SEMAPHORE_AGENT_ASG_WARM_POOL_STATE")
    });

    warmPool.node.addDependency(warmPoolDependencies);
  }
}

module.exports = { AwsSemaphoreAgentStack }
