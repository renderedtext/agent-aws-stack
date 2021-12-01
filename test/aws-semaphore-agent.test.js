const { expect, matchTemplate, MatchStyle } = require('@aws-cdk/assert');
const cdk = require('@aws-cdk/core');
const AwsSemaphoreAgent = require('../lib/aws-semaphore-agent-stack');

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new AwsSemaphoreAgent.AwsSemaphoreAgentStack(app, 'MyTestStack');
    // THEN
    expect(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});
