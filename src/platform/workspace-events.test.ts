import { afterEach, expect, it, vi } from "vitest";
import { listenWorkspaceChanges } from "./workspace-events";
import { listen } from "@tauri-apps/api/event";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
afterEach(() => vi.resetAllMocks());

it("validates events at the IPC boundary and forwards valid changes", async () => {
  const onChange = vi.fn(),
    onError = vi.fn(),
    stop = vi.fn();
  let callback: (event: { payload: unknown }) => void = () => {};
  vi.mocked(listen).mockImplementation(async (_event, listener) => {
    callback = (event) =>
      listener({
        id: 1,
        event: "notes:workspace-changed",
        payload: event.payload,
      } as never);
    return stop;
  });
  expect(await listenWorkspaceChanges(onChange, onError)).toBe(stop);
  expect(listen).toHaveBeenCalledWith(
    "notes:workspace-changed",
    expect.any(Function),
  );
  callback({ payload: { workspaceIds: ["one"], warnings: ["Read failed"] } });
  expect(onChange).toHaveBeenCalledWith({
    workspaceIds: ["one"],
    warnings: ["Read failed"],
  });
  callback({ payload: { workspaceIds: [17] } });
  callback({ payload: { workspaceIds: "one" } });
  expect(onChange).toHaveBeenCalledOnce();
  expect(onError).toHaveBeenCalledTimes(2);
});

it("rejects subscription errors so callers can retain focus refresh", async () => {
  vi.mocked(listen).mockRejectedValueOnce(
    new Error("event bridge unavailable"),
  );
  await expect(listenWorkspaceChanges(vi.fn(), vi.fn())).rejects.toThrow(
    "event bridge unavailable",
  );
});
