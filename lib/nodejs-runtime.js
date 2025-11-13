const { Runtime, RuntimeFamily } = require('aws-cdk-lib/aws-lambda');

// CDK v2.164 does not expose NODEJS_22_X yet, so create a compatible Runtime when needed.
const nodeJs22Runtime = Runtime.NODEJS_22_X || new Runtime('nodejs22.x', RuntimeFamily.NODEJS, {
  supportsInlineCode: true
});

module.exports = {
  nodeJs22Runtime
};
