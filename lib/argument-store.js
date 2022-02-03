class ArgumentStore {
  static required = [
    "SEMAPHORE_ORGANIZATION",
    "SEMAPHORE_AGENT_STACK_NAME",
    "SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME"
  ]

  static defaults = {
    "SEMAPHORE_AGENT_INSTANCE_TYPE": "t2.micro",
    "SEMAPHORE_AGENT_ASG_MIN_SIZE": "0",
    "SEMAPHORE_AGENT_ASG_MAX_SIZE": "1",
    "SEMAPHORE_AGENT_ASG_DESIRED": "1",
    "SEMAPHORE_AGENT_DISCONNECT_AFTER_JOB": "true",
    "SEMAPHORE_AGENT_DISCONNECT_AFTER_IDLE_TIMEOUT": "300",
    "SEMAPHORE_AGENT_SECURITY_GROUP_ID": "",
    "SEMAPHORE_AGENT_KEY_NAME": "",
    "SEMAPHORE_AGENT_CACHE_BUCKET_NAME": "",
    "SEMAPHORE_AGENT_TOKEN_KMS_KEY": "",
    "SEMAPHORE_AGENT_VPC_ID": "",
    "SEMAPHORE_AGENT_SUBNETS": "",
    "SEMAPHORE_AGENT_USE_DYNAMIC_SCALING": "true",
    "SEMAPHORE_AGENT_AMI": ""
  }

  constructor() {
    this.arguments = {};
  }

  static fromEnv() {
    return ArgumentStore.fromMap(process.env);
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

    // Assert related arguments are properly available
    if (!argumentStore.isEmpty("SEMAPHORE_AGENT_VPC_ID") && argumentStore.isEmpty("SEMAPHORE_AGENT_SUBNETS")) {
      throw "SEMAPHORE_AGENT_SUBNETS is required, if SEMAPHORE_AGENT_VPC_ID is set."
    }

    return argumentStore;
  }

  getAll() {
    return this.arguments;
  }

  get(name) {
    return this.arguments[name];
  }

  set(name, value) {
    this.arguments[name] = value;
  }

  isEmpty(name) {
    return this.arguments[name] == "";
  }
}

module.exports = { ArgumentStore }
