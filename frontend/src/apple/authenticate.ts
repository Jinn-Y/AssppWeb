import {
  appleRequest,
  appleResponseDiagnostics,
  isRedirectStatus,
  type AppleResponse,
} from "./request";
import { buildPlist, parsePlist } from "./plist";
import { extractAndMergeCookies } from "./cookies";
import { defaultAuthURL, fetchBag, legacyAuthURL } from "./bag";
import i18n from "../i18n";
import type { Account, Cookie } from "../types";

export class AuthenticationError extends Error {
  constructor(
    message: string,
    public readonly codeRequired: boolean = false,
  ) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export async function authenticate(
  email: string,
  password: string,
  code?: string,
  existingCookies?: Cookie[],
  deviceId: string = "",
): Promise<Account> {
  let cookies: Cookie[] = existingCookies ? [...existingCookies] : [];
  let storeFront = "";
  let lastError: Error | null = null;

  const defaultAuthEndpoint = new URL(defaultAuthURL);
  defaultAuthEndpoint.searchParams.set("guid", deviceId);
  let requestHost = defaultAuthEndpoint.hostname;
  let requestPath = `${defaultAuthEndpoint.pathname}${defaultAuthEndpoint.search}`;

  const bag = await fetchBag(deviceId);
  const authEndpoint = new URL(bag.authURL);
  authEndpoint.searchParams.set("guid", deviceId);
  requestHost = authEndpoint.hostname;
  requestPath = `${authEndpoint.pathname}${authEndpoint.search}`;

  let currentAttempt = 0;
  let redirectAttempt = 0;
  let triedLegacyFallback = false;

  while (currentAttempt < 2 && redirectAttempt <= 3) {
    currentAttempt++;

    try {
      const body: Record<string, string> = {
        appleId: email,
        attempt: code ? "2" : "4",
        guid: deviceId,
        password: code ? `${password}${code}` : password,
        rmp: "0",
        why: "signIn",
      };

      const plistBody = buildPlist(body);

      const headers: Record<string, string> = {
        "Content-Type":
          requestHost === "auth.itunes.apple.com"
            ? "application/x-www-form-urlencoded"
            : "application/x-apple-plist",
      };

      const response = await appleRequest({
        method: "POST",
        host: requestHost,
        path: requestPath,
        headers,
        body: plistBody,
        cookies,
      });

      cookies = extractAndMergeCookies(response.rawHeaders, cookies);

      // Read store front
      const storeHeader = response.headers["x-set-apple-store-front"];
      if (storeHeader) {
        const parts = storeHeader.split("-");
        if (parts[0]) {
          storeFront = parts[0];
        }
      }

      // Read pod
      const podHeader = response.headers["pod"];
      const pod = podHeader || undefined;

      if (response.status === 429) {
        throw new AuthenticationError(
          `Apple authentication rate limited (${appleResponseDiagnostics(response)})`,
        );
      }

      if (
        requestHost === "auth.itunes.apple.com" &&
        !triedLegacyFallback &&
        shouldFallbackToLegacy(response)
      ) {
        const legacyEndpoint = new URL(legacyAuthURL);
        legacyEndpoint.searchParams.set("guid", deviceId);
        requestHost = legacyEndpoint.hostname;
        requestPath = `${legacyEndpoint.pathname}${legacyEndpoint.search}`;
        triedLegacyFallback = true;
        redirectAttempt = 0;
        continue;
      }

      // Handle redirect. The native /fast auth host can answer with 301 as
      // well as the usual 302, so follow the full set of redirect statuses.
      if (isRedirectStatus(response.status)) {
        const location = response.headers["location"];
        if (!location) {
          throw new Error(
            `${i18n.t("errors.auth.redirectLocation")} (${appleResponseDiagnostics(response)})`,
          );
        }
        const url = new URL(location);
        requestHost = url.hostname;
        requestPath = url.pathname + url.search;
        currentAttempt--;
        redirectAttempt++;
        continue;
      }

      // Handle non-plist responses (e.g. 403 with empty body)
      if (!response.body.trim()) {
        throw new Error(
          `${i18n.t("errors.auth.emptyBody", {
            status: response.status,
          })} (${appleResponseDiagnostics(response)})`,
        );
      }

      const contentType = response.headers["content-type"]?.toLowerCase() ?? "";
      if (contentType.includes("text/html")) {
        throw new Error(
          `Apple authentication returned a non-plist response (${appleResponseDiagnostics(response)})`,
        );
      }

      const dict = parsePlist(response.body) as Record<string, any>;

      // Check for 2FA requirement
      if (
        dict.failureType === "" &&
        !code &&
        dict.customerMessage === "MZFinance.BadLogin.Configurator_message"
      ) {
        throw new AuthenticationError(
          i18n.t("errors.auth.requiresVerification"),
          true,
        );
      }

      const failureMessage =
        (dict.dialog as Record<string, any>)?.explanation ??
        dict.customerMessage;

      const accountInfo = dict.accountInfo as Record<string, any>;
      if (!accountInfo) {
        throw new Error(
          failureMessage ?? i18n.t("errors.auth.missingAccountInfo"),
        );
      }

      const address = accountInfo.address as Record<string, any>;
      if (!address) {
        throw new Error(failureMessage ?? i18n.t("errors.auth.missingAddress"));
      }

      const account: Account = {
        email,
        password,
        appleId: (accountInfo.appleId as string) ?? "",
        store: storeFront,
        firstName: (address.firstName as string) ?? "",
        lastName: (address.lastName as string) ?? "",
        passwordToken: (dict.passwordToken as string) ?? "",
        directoryServicesIdentifier: String(dict.dsPersonId ?? ""),
        cookies,
        deviceIdentifier: deviceId,
        pod,
      };

      return account;
    } catch (e) {
      if (e instanceof AuthenticationError) throw e;
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }

  throw lastError ?? new Error(i18n.t("errors.auth.unknownReason"));
}

function shouldFallbackToLegacy(response: AppleResponse): boolean {
  if (response.status === 429) return false;
  if (response.status === 404) return true;
  if (isRedirectStatus(response.status) && !response.headers["location"]) {
    return true;
  }
  if (!response.body.trim()) return true;

  const contentType = response.headers["content-type"]?.toLowerCase() ?? "";
  return contentType.includes("text/html");
}
