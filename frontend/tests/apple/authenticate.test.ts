import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPlist } from "../../src/apple/plist";
import { authenticate } from "../../src/apple/authenticate";
import { appleRequest } from "../../src/apple/request";
import { fetchBag } from "../../src/apple/bag";

vi.mock("../../src/apple/request", () => ({
  appleRequest: vi.fn(),
  isRedirectStatus: (status: number) =>
    [301, 302, 303, 307, 308].includes(status),
  appleResponseDiagnostics: (response: { status: number }) =>
    `HTTP ${response.status}`,
}));

vi.mock("../../src/apple/bag", () => ({
  fetchBag: vi.fn(),
  defaultAuthURL:
    "https://auth.itunes.apple.com/auth/v1/native/fast/",
  legacyAuthURL:
    "https://buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/authenticate",
}));

describe("apple/authenticate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets guid query exactly once from bag endpoint", async () => {
    vi.mocked(fetchBag).mockResolvedValue({
      authURL:
        "https://buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/authenticate?foo=1&guid=old-value",
      redownloadURL:
        "https://downloaddispatch.itunes.apple.com/r/redownload",
    });
    vi.mocked(appleRequest).mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: {},
      rawHeaders: [],
      body: buildPlist({
        accountInfo: {
          appleId: "test@example.com",
          address: {
            firstName: "Test",
            lastName: "User",
          },
        },
        passwordToken: "token",
        dsPersonId: "123",
      }),
    });

    await authenticate(
      "test@example.com",
      "password",
      undefined,
      undefined,
      "aabbccddeeff",
    );

    const requestCall = vi.mocked(appleRequest).mock.calls[0][0];
    const endpoint = new URL(`https://${requestCall.host}${requestCall.path}`);

    expect(endpoint.searchParams.get("guid")).toBe("aabbccddeeff");
    expect(endpoint.searchParams.getAll("guid")).toHaveLength(1);
    expect(endpoint.searchParams.get("foo")).toBe("1");
  });

  it("falls back to the legacy endpoint when native redirects without Location", async () => {
    vi.mocked(fetchBag).mockResolvedValue({
      authURL: "https://auth.itunes.apple.com/auth/v1/native/fast/",
      redownloadURL:
        "https://downloaddispatch.itunes.apple.com/r/redownload",
    });
    vi.mocked(appleRequest)
      .mockResolvedValueOnce({
        status: 301,
        statusText: "Moved Permanently",
        headers: {
          "content-type": "text/html",
        },
        rawHeaders: [],
        body: "<html><body>Moved Permanently</body></html>",
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: "OK",
        headers: {},
        rawHeaders: [],
        body: buildPlist({
          accountInfo: {
            appleId: "test@example.com",
            address: {
              firstName: "Test",
              lastName: "User",
            },
          },
          passwordToken: "token",
          dsPersonId: "123",
        }),
      });

    await authenticate(
      "test@example.com",
      "password",
      undefined,
      undefined,
      "aabbccddeeff",
    );

    const nativeRequest = vi.mocked(appleRequest).mock.calls[0][0];
    const legacyRequest = vi.mocked(appleRequest).mock.calls[1][0];
    expect(nativeRequest.host).toBe("auth.itunes.apple.com");
    expect(nativeRequest.headers?.["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(legacyRequest.host).toBe("buy.itunes.apple.com");
    expect(legacyRequest.headers?.["Content-Type"]).toBe(
      "application/x-apple-plist",
    );
  });

  it("does not fall back to legacy when Apple rate limits native auth", async () => {
    vi.mocked(fetchBag).mockResolvedValue({
      authURL: "https://auth.itunes.apple.com/auth/v1/native/fast/",
      redownloadURL:
        "https://downloaddispatch.itunes.apple.com/r/redownload",
    });
    vi.mocked(appleRequest).mockResolvedValue({
      status: 429,
      statusText: "Too Many Requests",
      headers: {
        "content-type": "text/html",
      },
      rawHeaders: [],
      body: "<html><body>Too Many Requests</body></html>",
    });

    await expect(
      authenticate(
        "test@example.com",
        "password",
        undefined,
        undefined,
        "aabbccddeeff",
      ),
    ).rejects.toThrow("HTTP 429");

    expect(appleRequest).toHaveBeenCalledTimes(1);
    for (const [requestOptions] of vi.mocked(appleRequest).mock.calls) {
      expect(requestOptions.host).toBe("auth.itunes.apple.com");
    }
  });
});
