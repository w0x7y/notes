import { expect, it, vi } from "vitest";
import { startWorkspaceWatch } from "./workspace-watch";
import type { WorkspaceChange } from "../platform/workspace-events";

it("forwards notifications and catches up once the listener attaches", async () => {
  const invalidate = vi.fn(),
    report = vi.fn(),
    unsubscribe = vi.fn(),
    disposeInvalidations = vi.fn();
  let receive: (change: WorkspaceChange) => void = () => {};
  let onError: (error: unknown) => void = () => {};
  const stop = startWorkspaceWatch({
    invalidate,
    disposeInvalidations,
    report,
    subscribe: async (listener, failed) => {
      receive = listener;
      onError = failed;
      return unsubscribe;
    },
  });
  await Promise.resolve();
  expect(invalidate.mock.calls).toEqual([[]]);
  const event = { workspaceIds: ["one"], warnings: ["watch warning"] };
  receive(event);
  expect(invalidate).toHaveBeenLastCalledWith(event);
  onError("listener failed");
  expect(report).toHaveBeenCalledWith("listener failed");
  stop();
  stop();
  receive(event);
  onError("late listener failure");
  expect(invalidate).toHaveBeenCalledTimes(2);
  expect(report).toHaveBeenCalledOnce();
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(disposeInvalidations).toHaveBeenCalledOnce();
});

it("unsubscribes if delayed attachment finishes after disposal", async () => {
  const unsubscribe = vi.fn(),
    invalidate = vi.fn();
  let release: (stop: () => void) => void = () => {};
  const subscription = new Promise<() => void>((resolve) => {
    release = resolve;
  });
  const stop = startWorkspaceWatch({
    invalidate,
    disposeInvalidations: vi.fn(),
    report: vi.fn(),
    subscribe: () => subscription,
  });
  stop();
  release(unsubscribe);
  await Promise.resolve();
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(invalidate).not.toHaveBeenCalled();
});

it("reports attachment failure only while the listener is active", async () => {
  const report = vi.fn();
  let reject: (error: unknown) => void = () => {};
  const subscription = new Promise<() => void>((_resolve, fail) => {
    reject = fail;
  });
  const stop = startWorkspaceWatch({
    invalidate: vi.fn(),
    disposeInvalidations: vi.fn(),
    report,
    subscribe: () => subscription,
  });
  stop();
  reject("late attachment failure");
  await Promise.resolve();
  await Promise.resolve();
  expect(report).not.toHaveBeenCalled();
  startWorkspaceWatch({
    invalidate: vi.fn(),
    disposeInvalidations: vi.fn(),
    report,
    subscribe: async () => {
      throw new Error("attachment failed");
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(report).toHaveBeenCalledWith(
    expect.objectContaining({ message: "attachment failed" }),
  );
});
