#!/usr/bin/env node

const { App } = require('aws-cdk-lib');
const { AwsSemaphoreAgentStack } = require('../lib/aws-semaphore-agent-stack');
const { ArgumentStore } = require('../lib/argument-store');
const { getKeys } = require('../lib/github-keys');

const app = new App();
const argumentStore = buildArgumentStore();

new AwsSemaphoreAgentStack(app, 'AwsSemaphoreAgentStack', {
  stackName: argumentStore.get("SEMAPHORE_AGENT_STACK_NAME"),
  description: "Semaphore agent autoscaling stack",
  argumentStore: argumentStore,
  sshKeys: getKeys(),
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
    console.error("ERROR: could not retrieve all required arguments:", e)
    process.exit(1);
  }
}
