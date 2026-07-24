import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import clientLogRoutes from "../src/routes/clientLogs.js";
import { sanitizeLogMessage } from "../src/utils/log.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", clientLogRoutes);
  return app;
}

describe("Client diagnostic logs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs a structured, redacted diagnostic event", async () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = createApp();

    const res = await request(app)
      .post("/api/client-logs")
      .send({
        eventId: "test-event-123",
        level: "error",
        operation: "download",
        phase: "apple-download-info",
        errorName: "DownloadError",
        errorCode: "5002",
        httpStatus: 500,
        message:
          "Failed for user@example.com at https://example.com/a?guid=aabbccddeeff&token=secret",
        context: {
          appId: 123456,
          bundleId: "com.example.app",
          store: "143465",
          version: "1.2.3",
          email: "must-not-pass@example.com",
        },
        password: "must-not-pass",
      });

    expect(res.status).toBe(202);
    expect(res.body.eventId).toBe("test-event-123");
    expect(logSpy).toHaveBeenCalledTimes(1);

    const logged = String(logSpy.mock.calls[0][0]);
    expect(logged).toContain("[ClientDiagnostic]");
    expect(logged).toContain('"operation":"download"');
    expect(logged).toContain('"errorName":"DownloadError"');
    expect(logged).toContain("[redacted-email]");
    expect(logged).toContain("guid=[redacted]");
    expect(logged).not.toContain("user@example.com");
    expect(logged).not.toContain("must-not-pass");
    expect(logged).not.toContain("aabbccddeeff");
  });

  it("rejects events without safe operation and phase names", async () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = createApp();

    const res = await request(app)
      .post("/api/client-logs")
      .send({ operation: "../password", phase: "x" });

    expect(res.status).toBe(400);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("bounds and redacts diagnostic text", () => {
    const value = sanitizeLogMessage(
      `user@example.com ${"a".repeat(80)}`,
      40,
    );
    expect(value).not.toContain("user@example.com");
    expect(value!.length).toBeLessThanOrEqual(40);
  });
});
