const { ArgumentStore } = require("../lib/argument-store");

describe("get tags", () => {
  test("empty tags", () => {
    const argumentStore = ArgumentStore.fromMap({
      SEMAPHORE_AGENT_STACK_NAME: "test-stack",
      SEMAPHORE_ORGANIZATION: "test",
      SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME: "test-token"
    });
    const tags = argumentStore.getTags();
    expect(tags).toEqual([]);
  });

  test("multiple tags", () => {
    const argumentStore = ArgumentStore.fromMap({
      SEMAPHORE_AGENT_STACK_NAME: "test-stack",
      SEMAPHORE_ORGANIZATION: "test",
      SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME: "test-token",
      SEMAPHORE_AGENT_TAGS: " Name : Something ,Category:SomethingElse"
    });
    const tags = argumentStore.getTags();
    expect(tags).toEqual([
      {
        key: "Name",
        value: "Something",
      },
      {
        key: "Category",
        value: "SomethingElse",
      },
    ]);
  });
})
