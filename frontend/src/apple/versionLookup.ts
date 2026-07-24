import {
  appleRequest,
  appleResponseDiagnostics,
  isRedirectStatus,
} from "./request";
import { buildPlist, parsePlist } from "./plist";
import { extractAndMergeCookies } from "./cookies";
import { fetchBag } from "./bag";
import {
  RETRYABLE_FAILURE_TYPE,
  redownloadEndpoint,
  volumeStoreEndpoint,
} from "./config";
import type { Account, Software, VersionMetadata } from "../types";

export async function getVersionMetadata(
  account: Account,
  app: Software,
  versionId: string,
): Promise<{
  metadata: VersionMetadata;
  updatedCookies: typeof account.cookies;
}> {
  const deviceId = account.deviceIdentifier;

  let endpoint = volumeStoreEndpoint(account.pod, deviceId);
  let requestHost = endpoint.host;
  let requestPath = endpoint.path;
  let triedRedownload = false;
  let cookies = [...account.cookies];
  let redirectAttempt = 0;

  while (redirectAttempt <= 3) {
    const payload: Record<string, any> = {
      creditDisplay: "",
      guid: deviceId,
      salableAdamId: app.id,
      [endpoint.externalVersionIdKey]: versionId,
    };

    const plistBody = buildPlist(payload);

    const headers: Record<string, string> = {
      "Content-Type": "application/x-apple-plist",
      "iCloud-DSID": account.directoryServicesIdentifier,
      "X-Dsid": account.directoryServicesIdentifier,
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

    if (isRedirectStatus(response.status)) {
      const location = response.headers["location"];
      if (!location) {
        throw new Error(
          `Failed to retrieve redirect location (${appleResponseDiagnostics(response)})`,
        );
      }
      const url = new URL(location);
      requestHost = url.hostname;
      requestPath = url.pathname + url.search;
      redirectAttempt++;
      continue;
    }

    const dict = parsePlist(response.body) as Record<string, any>;

    // volumeStore intermittently returns 5002; retry once via the redownload
    // dispatch endpoint, which serves the same payload.
    if (
      String(dict.failureType ?? "") === RETRYABLE_FAILURE_TYPE &&
      !triedRedownload
    ) {
      triedRedownload = true;
      const bag = await fetchBag(deviceId);
      endpoint = redownloadEndpoint(deviceId, bag.redownloadURL);
      requestHost = endpoint.host;
      requestPath = endpoint.path;
      redirectAttempt = 0;
      continue;
    }

    const songList = dict.songList as Record<string, any>[] | undefined;
    if (!songList || songList.length === 0) {
      throw new Error("No items in response");
    }

    const item = songList[0];
    const itemMetadata = item.metadata as Record<string, any>;
    if (!itemMetadata) {
      throw new Error("Missing metadata");
    }

    const bundleShortVersionString =
      itemMetadata.bundleShortVersionString as string;
    if (!bundleShortVersionString) {
      throw new Error("Missing bundleShortVersionString");
    }

    const rawReleaseDate = itemMetadata.releaseDate;
    if (!rawReleaseDate) {
      throw new Error("Missing releaseDate");
    }
    const releaseDate =
      rawReleaseDate instanceof Date
        ? rawReleaseDate.toISOString()
        : String(rawReleaseDate);

    return {
      metadata: {
        displayVersion: bundleShortVersionString,
        releaseDate,
      },
      updatedCookies: cookies,
    };
  }

  throw new Error("Too many redirects");
}
