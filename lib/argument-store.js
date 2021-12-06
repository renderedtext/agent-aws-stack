class ArgumentStore {
  static required = [
    "SEMAPHORE_ORGANIZATION",
    "SEMAPHORE_AGENT_TOKEN",
    "SEMAPHORE_AGENT_AMI"
  ]

  static defaults = {
    "SEMAPHORE_AGENT_INSTANCE_TYPE": "t2.micro",
    "SEMAPHORE_AGENT_ASG_MIN_SIZE": "0",
    "SEMAPHORE_AGENT_ASG_MAX_SIZE": "1",
    "SEMAPHORE_AGENT_ASG_DESIRED": "1",
    "SEMAPHORE_AGENT_ASG_WARM_POOL_STATE": "Stopped",
    "SEMAPHORE_AGENT_VERSION": "v2.0.17",
    "SEMAPHORE_AGENT_VM_USER": "ubuntu"
  }

  constructor() {
    this.arguments = {};
  }

  static fromEnv() {
    const argumentStore = new ArgumentStore();

    ArgumentStore.required.forEach(name => {
      if (!process.env[name]) {
        throw "'" + name + "' is required";
      }

      argumentStore.set(name, process.env[name]);
    });

    Object.keys(ArgumentStore.defaults).forEach(name => {
      if (!process.env[name]) {
        argumentStore.set(name, ArgumentStore.defaults[name]);
      } else {
        argumentStore.set(name, process.env[name]);
      }
    });

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
}

module.exports = { ArgumentStore }
