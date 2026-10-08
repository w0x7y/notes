import type { ImageFile } from "../domain/contracts";

type CachedImage = { promise: Promise<ImageFile>; bytes: number };

/** Share image reads without retaining unbounded base64 data. */
export class ImageCache {
  private images = new Map<string, CachedImage>();
  private bytes = 0;

  constructor(
    private readonly read: (
      workspaceId: string,
      path: string,
    ) => Promise<ImageFile>,
    private readonly maxBytes = 32 * 1024 * 1024,
  ) {}

  readImage(
    workspaceId: string,
    path: string,
    modified: number,
  ): Promise<ImageFile> {
    const key = JSON.stringify([workspaceId, path, modified]);
    const cached = this.images.get(key);
    if (cached) {
      this.images.delete(key);
      this.images.set(key, cached);
      return cached.promise;
    }
    const entry: CachedImage = {
      bytes: 0,
      promise: this.read(workspaceId, path)
        .then((image) => {
          entry.bytes = image.data.length * 2;
          this.bytes += entry.bytes;
          // Evict only settled entries: pending callers still share their read.
          for (const [candidate, value] of this.images) {
            if (this.bytes <= this.maxBytes) break;
            if (value.bytes) {
              this.images.delete(candidate);
              this.bytes -= value.bytes;
            }
          }
          return image;
        })
        .catch((error: unknown) => {
          this.images.delete(key);
          throw error;
        }),
    };
    this.images.set(key, entry);
    return entry.promise;
  }
}
