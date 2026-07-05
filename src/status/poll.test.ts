import { pollOperationStatus } from "./poll.js";

describe("operation status polling", () => {
  it("polls until a terminal status", async () => {
    const statuses = [
      { phase: "submitted" as const, updatedAt: 1 },
      { phase: "accepted" as const, updatedAt: 2 },
      { phase: "finalized" as const, updatedAt: 3 },
    ];

    await expect(
      pollOperationStatus({
        observe: async () => statuses.shift()!,
        intervalMs: 1,
        sleep: async () => {},
      })
    ).resolves.toEqual({ phase: "finalized", updatedAt: 3 });
  });

  it("returns timed_out with last metadata", async () => {
    let now = 0;
    await expect(
      pollOperationStatus({
        observe: async () => ({ phase: "submitted", updatedAt: now, metadata: { hash: "tx" } }),
        now: () => now,
        sleep: async (ms) => {
          now += ms;
        },
        intervalMs: 10,
        timeoutMs: 5,
      })
    ).resolves.toMatchObject({
      phase: "timed_out",
      metadata: { hash: "tx" },
    });
  });

  it("removes abort listeners after default sleeps complete", async () => {
    const controller = new AbortController();
    const originalAdd = controller.signal.addEventListener.bind(controller.signal) as (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions
    ) => void;
    const originalRemove = controller.signal.removeEventListener.bind(controller.signal) as (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions
    ) => void;
    let abortAdds = 0;
    let abortRemoves = 0;

    const addListener = (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions
    ): void => {
      if (type === "abort") abortAdds += 1;
      return originalAdd(type, listener, options);
    };
    const removeListener = (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions
    ): void => {
      if (type === "abort") abortRemoves += 1;
      return originalRemove(type, listener, options);
    };

    vi.spyOn(controller.signal, "addEventListener").mockImplementation(
      addListener as typeof controller.signal.addEventListener
    );
    vi.spyOn(controller.signal, "removeEventListener").mockImplementation(
      removeListener as typeof controller.signal.removeEventListener
    );

    const statuses = [
      { phase: "submitted" as const, updatedAt: 1 },
      { phase: "finalized" as const, updatedAt: 2 },
    ];

    await expect(
      pollOperationStatus({
        observe: async () => statuses.shift()!,
        intervalMs: 1,
        timeoutMs: 100,
        signal: controller.signal,
      })
    ).resolves.toEqual({ phase: "finalized", updatedAt: 2 });

    expect(abortAdds).toBe(1);
    expect(abortRemoves).toBe(1);
  });
});
