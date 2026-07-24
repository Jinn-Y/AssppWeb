import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportClientError } from "../../src/api/diagnostics";

describe("client diagnostics", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("reports only normalized error and public context fields", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ accepted: true }),
    } as Response);

    const error = Object.assign(new Error("Download failed"), {
      name: "DownloadError",
      code: "5002",
      password: "must-not-pass",
    });

    const eventId = await reportClientError({
      operation: "download",
      phase: "apple-download-info",
      error,
      context: {
        appId: 123456,
        bundleId: "com.example.app",
        store: "143465",
      },
    });

    expect(eventId).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [, init] = fetchSpy.mock.calls[0];
    const payload = JSON.parse(String(init?.body));
    expect(payload.operation).toBe("download");
    expect(payload.errorCode).toBe("5002");
    expect(payload.context.bundleId).toBe("com.example.app");
    expect(JSON.stringify(payload)).not.toContain("must-not-pass");
  });

  it("never masks the original error when reporting fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Backend unavailable"),
    );

    await expect(
      reportClientError({
        operation: "authentication",
        phase: "initial-login",
        error: new Error("Authentication failed"),
      }),
    ).resolves.toBeTruthy();
  });
});
