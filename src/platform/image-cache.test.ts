import { expect, it, vi } from "vitest";
import { ImageCache } from "./image-cache";

it("shares pending and settled reads but invalidates changed files and workspace paths", async () => {
  const read = vi.fn(async () => ({ data: "aGVsbG8=", mime: "image/png" }));
  const cache = new ImageCache(read);
  const pending = cache.readImage("one", "image.png", 1);
  expect(cache.readImage("one", "image.png", 1)).toBe(pending);
  await pending;
  await cache.readImage("one", "image.png", 1);
  expect(read).toHaveBeenCalledOnce();
  await cache.readImage("one", "image.png", 2);
  await cache.readImage("two", "image.png", 1);
  await cache.readImage("one", "other.png", 1);
  expect(read).toHaveBeenCalledTimes(4);
});

it("retries failed reads rather than caching errors", async () => {
  const read = vi
    .fn()
    .mockRejectedValueOnce(new Error("temporarily unavailable"))
    .mockResolvedValue({ data: "aA==", mime: "image/png" });
  const cache = new ImageCache(read);
  await expect(cache.readImage("one", "image.png", 1)).rejects.toThrow(
    "temporarily unavailable",
  );
  await expect(cache.readImage("one", "image.png", 1)).resolves.toMatchObject({
    data: "aA==",
  });
  expect(read).toHaveBeenCalledTimes(2);
});

it("evicts least recently used images and doesn't retain an oversized image", async () => {
  const read = vi.fn(async (_workspace: string, path: string) => ({
    data: path === "huge" ? "0123456789" : "abcd",
    mime: "image/png",
  }));
  const cache = new ImageCache(read, 16);
  await cache.readImage("one", "a", 1);
  await cache.readImage("one", "b", 1);
  await cache.readImage("one", "a", 1);
  await cache.readImage("one", "c", 1);
  await cache.readImage("one", "a", 1);
  expect(read).toHaveBeenCalledTimes(3);
  await cache.readImage("one", "b", 1);
  expect(read).toHaveBeenCalledTimes(4);
  await cache.readImage("one", "huge", 1);
  await cache.readImage("one", "huge", 1);
  expect(read).toHaveBeenCalledTimes(6);
});
