const cdk = require('@aws-cdk/core');
const iam = require("@aws-cdk/aws-iam");
const lambda = require("@aws-cdk/aws-lambda");
const events = require("@aws-cdk/aws-events");
const eventTargets = require("@aws-cdk/aws-events-targets");
const autoscaling = require("@aws-cdk/aws-autoscaling");

const stackPrefix = "semaphore-agent";
const autoscalingGroupName = `${stackPrefix}-asg`;

class AwsSemaphoreAgentStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    /**
     * The lambda and EventBridge rule is created before the scaling group
     * because it needs to be present before the auto scaling group exists.
     * Otherwise, the initial instances will not have the agent started.
     */
    let lambdaRole = this.createRoleForLambda();
    let lambda = this.createLambdaFunction(lambdaRole);
    this.createEventBridgeRule(lambda);

    let iamInstanceProfile = this.createIamInstanceProfile();
    let launchConfiguration = this.createLaunchConfiguration(iamInstanceProfile);
    let autoScalingGroup = this.createAutoScalingGroup(launchConfiguration);
    this.createWarmPool(autoScalingGroup);
  }

  createIamInstanceProfile() {
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

  createRoleForLambda() {
    let account = cdk.Stack.of(this).account;
    let lambdaRole = new iam.Role(this, 'lambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      roleName: `${stackPrefix}-lambda-role`
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
      code: new lambda.AssetCode('lambda'),
      handler: 'app.handler',
      role: lambdaRole
    });

    lambdaFunction.node.addDependency(lambdaDependencies);
    return lambdaFunction;
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

  createLaunchConfiguration(iamInstanceProfile) {
    const launchConfigDependencies = new cdk.ConcreteDependable();
    launchConfigDependencies.add(iamInstanceProfile);

    const imageIdParameter = new cdk.CfnParameter(this, "imageId", {
      type: "String",
      description: "The AMI id to use to launch auto scaling instances."
    });

    const instanceTypeParameter = new cdk.CfnParameter(this, "instanceType", {
      type: "String",
      description: "The instance type to use to launch auto scaling instances."
    });

    const semaphoreAgentVersionParameter = new cdk.CfnParameter(this, "semaphoreAgentVersion", {
      type: "String",
      description: "The agent version to use.",
      default: "v2.0.16"
    });

    const semaphoreOrganizationParameter = new cdk.CfnParameter(this, "semaphoreOrganization", {
      type: "String",
      description: "The semaphore organization to use for the agent."
    });

    const semaphoreTokenParameter = new cdk.CfnParameter(this, "semaphoreToken", {
      type: "String",
      description: "The semaphore registration token to use for the agent.",
      noEcho: true,
    });

    const machineUserParameter = new cdk.CfnParameter(this, "machineUser", {
      type: "String",
      description: "The user to run the agent on the machine.",
      default: "ubuntu",
    });

    let launchConfig = new autoscaling.CfnLaunchConfiguration(this, 'launchConfiguration', {
      launchConfigurationName: `${stackPrefix}-launch-configuration`,
      imageId: imageIdParameter.valueAsString,
      instanceType: instanceTypeParameter.valueAsString,
      iamInstanceProfile: iamInstanceProfile.attrArn,
      userData: `
        export AGENT_VERSION=${semaphoreAgentVersionParameter.valueAsString}
        export SEMAPHORE_ORGANIZATION=${semaphoreOrganizationParameter.valueAsString}
        export SEMAPHORE_REGISTRATION_TOKEN=${semaphoreTokenParameter.valueAsString}
        export SEMAPHORE_AGENT_INSTALLATION_USER=${machineUserParameter.valueAsString}
        /tmp/install-agent.sh
      `,
      // keyName: '',
      // securityGroups: []
    });

    launchConfig.node.addDependency(launchConfigDependencies);
    return launchConfig;
  }

  createAutoScalingGroup(launchConfiguration) {
    const availabilityZones = cdk.Stack.of(this).availabilityZones;

    const minSizeParameter = new cdk.CfnParameter(this, "minSize", {
      type: "String",
      description: "The minSize for the semaphore-agent auto scaling group."
    });

    const maxSizeParameter = new cdk.CfnParameter(this, "maxSize", {
      type: "String",
      description: "The maxSize for the semaphore-agent auto scaling group."
    });

    const desiredCapacityParameter = new cdk.CfnParameter(this, "desiredCapacity", {
      type: "String",
      description: "The desired capacity for the semaphore-agent auto scaling group."
    });

    const autoScalingGroupDependencies = new cdk.ConcreteDependable();
    autoScalingGroupDependencies.add(launchConfiguration);

    let autoScalingGroup = new autoscaling.CfnAutoScalingGroup(this, 'autoScalingGroup', {
      autoScalingGroupName: `${autoscalingGroupName}`,
      launchConfigurationName: launchConfiguration.launchConfigurationName,
      desiredCapacity: desiredCapacityParameter.valueAsString,
      minSize: minSizeParameter.valueAsString,
      maxSize: maxSizeParameter.valueAsString,
      availabilityZones: availabilityZones,
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
      autoScalingGroupName: autoScalingGroup.autoScalingGroupName
    });

    warmPool.node.addDependency(warmPoolDependencies);
  }
}

module.exports = { AwsSemaphoreAgentStack }
