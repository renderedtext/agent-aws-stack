#!/usr/bin/env node

const { App, Tags } = require('aws-cdk-lib');
const { AwsSemaphoreAgentStack } = require('../lib/aws-semaphore-agent-stack');
const { ArgumentStore } = require('../lib/argument-store');
const { getKeys, GitHubKeysError } = require('../lib/github-keys');

const app = new App();
const argumentStore = buildArgumentStore();

getKeys()
  .then(sshKeys => {
    const awsSemaphoreAgentStack = new AwsSemaphoreAgentStack(app, 'AwsSemaphoreAgentStack', {
      stackName: argumentStore.get("SEMAPHORE_AGENT_STACK_NAME"),
      description: "Semaphore agent autoscaling stack",
      argumentStore: argumentStore,
      sshKeys: sshKeys,
      tags: {},
      env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
      },
    });

    argumentStore.getTags().forEach(tag => {
      Tags.of(awsSemaphoreAgentStack).add(tag.key, tag.value);
    });
  })
  .catch(e => {
    if (e instanceof GitHubKeysError) {
      console.error("Error fetching GitHub SSH keys", e);
    } else {
      throw e;
    }
  })

function buildArgumentStore() {
  try {
    return ArgumentStore.fromEnv();
  } catch (e) {
    console.error("ERROR: could not retrieve all required arguments:", e)
    process.exit(1);
  }
}
