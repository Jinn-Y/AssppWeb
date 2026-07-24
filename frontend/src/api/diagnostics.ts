import { authHeaders } from "./client";

type DiagnosticLevel = "error" | "warn";

interface DiagnosticContext {
  appId?: string | number;
  bundleId?: string;
  store?: string | number;
  version?: string;
}

interface ReportClientErrorInput {
  operation: string;
  phase: string;
  error: unknown;
  level?: DiagnosticLevel;
  context?: DiagnosticContext;
}

interface ErrorWithDetails extends Error {
  code?: string | number;
  status?: number;
}

function createEventId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeError(error: unknown): {
  errorName: string;
  errorCode?: string;
  httpStatus?: number;
  message: string;
} {
  if (!(error instanceof Error)) {
    return {
      errorName: "UnknownError",
      message: "Unknown client error",
    };
  }

  const detailed = error as ErrorWithDetails;
  return {
    errorName: error.name || "Error",
    errorCode:
      detailed.code === undefined ? undefined : String(detailed.code),
    httpStatus:
      typeof detailed.status === "number" ? detailed.status : undefined,
    message: error.message,
  };
}

export async function reportClientError({
  operation,
  phase,
  error,
  level = "error",
  context,
}: ReportClientErrorInput): Promise<string> {
  const eventId = createEventId();
  const normalized = normalizeError(error);
  const payload = {
    eventId,
    level,
    operation,
    phase,
    ...normalized,
    context,
  };

  console.error(`[ClientDiagnostic:${eventId}]`, payload);

  try {
    await fetch("/api/client-logs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Diagnostics must never replace or mask the original operation error.
  }

  return eventId;
}
