import { libcurl, initLibcurl } from "./libcurl-init";
import { buildCookieHeader } from "./cookies";
import { userAgent } from "./config";
import type { Cookie } from "../types";

export interface AppleRequestOptions {
  host: string;
  path: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  cookies?: Cookie[];
}

export interface AppleResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  rawHeaders: [string, string][];
  body: string;
}

export function isRedirectStatus(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

export function appleResponseDiagnostics(response: AppleResponse): string {
  const contentType = response.headers["content-type"] || "unknown";
  const location = response.headers["location"] ? "present" : "missing";
  const details = [
    `HTTP ${response.status}`,
    `content-type=${contentType}`,
    `location=${location}`,
  ];

  if (!looksLikePlist(response.body)) {
    const snippet = response.body
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    if (snippet) {
      details.push(`response=${snippet}`);
    }
  }

  return details.join(", ");
}

function looksLikePlist(body: string): boolean {
  const trimmed = body.trim().toLowerCase();
  return (
    trimmed.startsWith("bplist") ||
    trimmed.includes("<plist") ||
    trimmed.includes("<dict") ||
    trimmed.includes("<key")
  );
}

export async function appleRequest(
  opts: AppleRequestOptions,
): Promise<AppleResponse> {
  await initLibcurl();

  const url = `https://${opts.host}${opts.path}`;
  const headers: Record<string, string> = {
    "User-Agent": userAgent,
    ...opts.headers,
  };

  if (opts.cookies?.length) {
    const cookieHeader = buildCookieHeader(opts.cookies, url);
    if (cookieHeader) {
      headers["Cookie"] = cookieHeader;
    }
  }

  const resp = await libcurl.fetch(url, {
    method: opts.method,
    headers,
    body: opts.body,
    redirect: "manual",
    _libcurl_http_version: 1.1,
  });

  const responseHeaders: Record<string, string> = {};
  for (const [key, value] of resp.raw_headers) {
    responseHeaders[key.toLowerCase()] = value;
  }

  const body = await resp.text();

  return {
    status: resp.status,
    statusText: resp.statusText,
    headers: responseHeaders,
    rawHeaders: resp.raw_headers,
    body,
  };
}
