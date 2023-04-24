const { Construct } = require("constructs");
const { DependencyGroup } = require("constructs");
const { Duration } = require("aws-cdk-lib");
const { Rule, Schedule } = require("aws-cdk-lib/aws-events");
const { LambdaFunction } = require("aws-cdk-lib/aws-events-targets");
const { RetentionDays } = require("aws-cdk-lib/aws-logs");
const { StringParameter, ParameterTier } = require("aws-cdk-lib/aws-ssm");
const { Function, Runtime, AssetCode } = require("aws-cdk-lib/aws-lambda");
const { Policy, PolicyStatement, Role, ServicePrincipal, ManagedPolicy, Effect } = require("aws-cdk-lib/aws-iam");

class DynamicSSHKeysUpdater extends Construct {
  constructor(scope, id, props) {
    super(scope, id, props);
    const parameter = this.createParameter(props);
    this.createUpdater(props.parameterName);
  }

  createParameter(props) {
    return new StringParameter(this, 'Parameter', {
      description: 'GitHub SSH public keys.',
      parameterName: props.parameterName,
      tier: ParameterTier.STANDARD,
      stringValue: JSON.stringify(props.keys)
    });
  }

  createUpdater(parameterName) {
    const role = this.createUpdaterRole(parameterName);
    const lambda = this.createUpdaterLambda(role, parameterName);
    this.createEventRuleForUpdater(lambda);
  }

  createUpdaterRole(parameterName) {
    let policy = new Policy(this, 'RolePolicy', {
      policyName: `${this.node.id}-policy`,
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["ssm:GetParameter", "ssm:PutParameter"],
          resources: [
            `arn:aws:ssm:*:*:parameter/${parameterName}`
          ]
        })
      ]
    });

    let role = new Role(this, 'Role', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ]
    });

    policy.attachToRole(role);
    return role;
  }

  createUpdaterLambda(role, parameterName) {
    const lambdaDependencies = new DependencyGroup();
    lambdaDependencies.add(role);

    let lambdaFunction = new Function(this, 'Lambda', {
      description: `Check if GitHub SSH public keys have changed.`,
      runtime: Runtime.NODEJS_14_X,
      timeout: Duration.seconds(10),
      code: new AssetCode('lambdas/ssh-keys-updater'),
      handler: 'app.handler',
      role: role,
      logRetention: RetentionDays.ONE_MONTH,
      environment: {
        "SSM_PARAMETER": parameterName
      }
    });

    lambdaFunction.node.addDependency(lambdaDependencies);
    return lambdaFunction;
  }

  createEventRuleForUpdater(lambda) {
    const ruleDependencies = new DependencyGroup();
    ruleDependencies.add(lambda);

    const rule = new Rule(this, 'EventRule', {
      description: `Rule to dynamically invoke lambda function to check GitHub public SSH keys.`,
      schedule: Schedule.expression('rate(8 hours)'),
      targets: [new LambdaFunction(lambda)]
    });

    rule.node.addDependency(ruleDependencies);
    return rule;
  }
}

module.exports = { DynamicSSHKeysUpdater }
