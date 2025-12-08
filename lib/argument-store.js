const fs = require('fs');

class ArgumentStore {
  static required = [
    "SEMAPHORE_AGENT_STACK_NAME",
    "SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME"
  ]

  static defaults = {
    "SEMAPHORE_ENDPOINT": "",
    "SEMAPHORE_ORGANIZATION": "",
    "SEMAPHORE_AGENT_INSTANCE_TYPE": "t2.micro",
    "SEMAPHORE_AGENT_ASG_MIN_SIZE": "0",
    "SEMAPHORE_AGENT_ASG_MAX_SIZE": "1",
    "SEMAPHORE_AGENT_ASG_DESIRED": "",
    "SEMAPHORE_AGENT_ASG_METRICS": "",
    "SEMAPHORE_AGENT_ASG_MAX_INSTANCE_LIFETIME": "0",
    "SEMAPHORE_AGENT_ASG_INSTANCE_REQUIREMENTS_JSON": "",
    "SEMAPHORE_AGENT_DISCONNECT_AFTER_JOB": "true",
    "SEMAPHORE_AGENT_DISCONNECT_AFTER_IDLE_TIMEOUT": "300",
    "SEMAPHORE_AGENT_OS": "ubuntu-focal",
    "SEMAPHORE_AGENT_ARCH": "x86_64",
    "SEMAPHORE_AGENT_SECURITY_GROUP_ID": "",
    "SEMAPHORE_AGENT_KEY_NAME": "",
    "SEMAPHORE_AGENT_CACHE_BUCKET_NAME": "",
    "SEMAPHORE_AGENT_TOKEN_KMS_KEY": "",
    "SEMAPHORE_AGENT_VPC_ID": "",
    "SEMAPHORE_AGENT_SUBNETS": "",
    "SEMAPHORE_AGENT_USE_DYNAMIC_SCALING": "true",
    "SEMAPHORE_AGENT_AMI": "",
    "SEMAPHORE_AGENT_MANAGED_POLICY_NAMES": "",
    "SEMAPHORE_AGENT_VOLUME_NAME": "",
    "SEMAPHORE_AGENT_VOLUME_TYPE": "gp2",
    "SEMAPHORE_AGENT_VOLUME_SIZE": "64",
    "SEMAPHORE_AGENT_VOLUME_IOPS": "",
    "SEMAPHORE_AGENT_VOLUME_THROUGHPUT": "",
    "SEMAPHORE_AGENT_TAGS": "",
    "SEMAPHORE_AGENT_LICENSE_CONFIGURATION_ARN": "",
    "SEMAPHORE_AGENT_MAC_FAMILY": "mac2",
    "SEMAPHORE_AGENT_MAC_DEDICATED_HOSTS": "",
    "SEMAPHORE_AGENT_AZS": "",
    "SEMAPHORE_AGENT_USE_PRE_SIGNED_URL": "false",
    "SEMAPHORE_AGENT_OVERPROVISION_STRATEGY": "none",
    "SEMAPHORE_AGENT_OVERPROVISION_FACTOR": "0",
    "SEMAPHORE_AGENT_USE_IPV6": "false",
    "SEMAPHORE_AGENT_ALLOW_PUBLIC_SUBNET": "false",
    "SEMAPHORE_AGENT_ON_DEMAND_BASE_CAPACITY": "0",
    "SEMAPHORE_AGENT_ON_DEMAND_PERCENTAGE_ABOVE_BASE": "100",
    "SEMAPHORE_AGENT_SPOT_ALLOCATION_STRATEGY": "",
  }

  static validOverprovisionStrategies = ["none", "number", "percentage"]

  constructor() {
    this.arguments = {};
  }

  static fromEnv() {
    const configFilePath = process.env.SEMAPHORE_AGENT_STACK_CONFIG;
    if (!configFilePath) {
      console.log(`==> No config file specified. Using environment variables ...`);
      return ArgumentStore.fromMap(process.env);
    }

    if (!fs.existsSync(configFilePath)) {
      throw `Config file ${configFilePath} does not exist`
    }

    console.log(`==> Using config file at ${configFilePath} ...`);
    const config = JSON.parse(fs.readFileSync(configFilePath, { encoding: 'utf-8' }))
    return ArgumentStore.fromMap(Object.assign({}, config, process.env));
  }

  static fromMap(params) {
    const argumentStore = new ArgumentStore();

    // Assert that required arguments are set
    ArgumentStore.required.forEach(name => {
      if (!params[name]) {
        throw "'" + name + "' is required";
      }

      argumentStore.set(name, params[name]);
    });

    // Populate defaults, if not set
    Object.keys(ArgumentStore.defaults).forEach(name => {
      if (!params[name]) {
        argumentStore.set(name, ArgumentStore.defaults[name]);
      } else {
        argumentStore.set(name, params[name]);
      }
    });

    if (argumentStore.get("SEMAPHORE_AGENT_STACK_NAME").length > 128) {
      throw "SEMAPHORE_AGENT_STACK_NAME can be up to 128 characters long."
    }

    // If SEMAPHORE_ENDPOINT is specified, we use that value without modifying it.
    // If SEMAPHORE_ORGANIZATION is specified, we assume the organization is located at 'semaphoreci.com'.
    if (argumentStore.isEmpty("SEMAPHORE_ENDPOINT") && argumentStore.isEmpty("SEMAPHORE_ORGANIZATION")) {
      throw "Either SEMAPHORE_ENDPOINT or SEMAPHORE_ORGANIZATION need be set."
    }

    // Subnets need to be specified if VPC id is
    if (!argumentStore.isEmpty("SEMAPHORE_AGENT_VPC_ID") && argumentStore.isEmpty("SEMAPHORE_AGENT_SUBNETS")) {
      throw "SEMAPHORE_AGENT_SUBNETS is required, if SEMAPHORE_AGENT_VPC_ID is set."
    }

    argumentStore.validateOverprovisionStrategy();
    return argumentStore;
  }

  validateOverprovisionStrategy() {
    const strategy = this.get("SEMAPHORE_AGENT_OVERPROVISION_STRATEGY")
    const factor = this.get("SEMAPHORE_AGENT_OVERPROVISION_FACTOR")
    switch (strategy) {
      case "none":
        return
      case "number":
      case "percentage":
        const n = parseInt(factor)
        if (isNaN(n)) {
          throw "SEMAPHORE_AGENT_OVERPROVISION_FACTOR is invalid"
        }

        if (n < 1) {
          throw "SEMAPHORE_AGENT_OVERPROVISION_FACTOR must be greater than zero"
        }

        return
      default:
        throw "SEMAPHORE_AGENT_OVERPROVISION_STRATEGY is invalid"
    }
  }

  getAll() {
    return this.arguments;
  }

  get(name) {
    return this.arguments[name];
  }

  getAsBool(name) {
    return this.get(name) == "true"
  }

  getAsNumber(name) {
    return parseInt(this.get(name))
  }

  getAsList(name) {
    return this.get(name)
      .split(",")
      .map(item => item.trim())
      .filter(item => item != "");
  }

  set(name, value) {
    this.arguments[name] = value;
  }

  isEmpty(name) {
    return this.arguments[name] == "";
  }

  getSemaphoreEndpoint() {
    if (this.isEmpty("SEMAPHORE_ENDPOINT")) {
      return `${this.get("SEMAPHORE_ORGANIZATION")}.semaphoreci.com`;
    }

    return this.get("SEMAPHORE_ENDPOINT");
  }

  getTags() {
    var tags = [];
    // example tag value = 'Name:Something,Category:SomethingElse'
    if (!this.isEmpty("SEMAPHORE_AGENT_TAGS")) {
      tags = this.get("SEMAPHORE_AGENT_TAGS").split(",").map(tagPair => {
        const [key, value] = tagPair.trim().split(":");
        return {
          key: key.trim(),
          value: value.trim(),
        };
      });
    }
    return tags;
  }

  // We only allow SSH ingress if a EC2 key has been specified.
  // Access to Windows instances happen through AWS Systems Manager,
  // so no need to allow SSH ingress for those as well.
  shouldAllowSSHIngress() {
    return !this.isEmpty("SEMAPHORE_AGENT_KEY_NAME") && !this.isWindowsStack()
  }

  isWindowsStack() {
    return this.get("SEMAPHORE_AGENT_OS") == "windows"
  }
}

module.exports = { ArgumentStore }
