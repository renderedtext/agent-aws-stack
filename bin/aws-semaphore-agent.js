#!/usr/bin/env node

const cdk = require('@aws-cdk/core');
const { AwsSemaphoreAgentStack } = require('../lib/aws-semaphore-agent-stack');
const { ArgumentStore } = require('../lib/argument-store');

const app = new cdk.App();

new AwsSemaphoreAgentStack(app, 'AwsSemaphoreAgentStack', {
  argumentStore: buildArgumentStore(),
  description: "Semaphore agent autoscaling stack",
  stackName: "aws-semaphore-agent-stack",
  tags: {},
  env: {
    account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
  },
});

function buildArgumentStore() {
  try {
    return ArgumentStore.fromEnv();
  } catch (e) {
    console.error("ERROR: could not retrieve all required arguments from environment:", e)
    process.exit(1);
  }
}