import { Router, type Request, type Response } from 'express';
import { sanitizeLogMessage } from '../utils/log.js';

const router = Router();

const ALLOWED_LEVELS = new Set(['error', 'warn']);
const SAFE_NAME_RE = /^[a-z][a-z0-9.-]{1,47}$/;
const SAFE_ERROR_NAME_RE = /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/;
const SAFE_EVENT_ID_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const SAFE_BUNDLE_ID_RE = /^[a-zA-Z0-9.-]{1,255}$/;
const SAFE_VERSION_RE = /^[a-zA-Z0-9._+()-]{1,64}$/;

interface ClientDiagnosticBody {
  eventId?: unknown;
  level?: unknown;
  operation?: unknown;
  phase?: unknown;
  errorName?: unknown;
  errorCode?: unknown;
  message?: unknown;
  httpStatus?: unknown;
  context?: unknown;
}

interface SafeContext {
  appId?: string;
  bundleId?: string;
  store?: string;
  version?: string;
}

function safeName(value: unknown): string | undefined {
  if (typeof value !== 'string' || !SAFE_NAME_RE.test(value)) {
    return undefined;
  }
  return value;
}

function safeErrorName(value: unknown): string | undefined {
  if (typeof value !== 'string' || !SAFE_ERROR_NAME_RE.test(value)) {
    return undefined;
  }
  return value;
}

function safeEventId(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_EVENT_ID_RE.test(value)) {
    return 'client-event-unavailable';
  }
  return value;
}

function safeStatus(value: unknown): number | undefined {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 100 ||
    value > 599
  ) {
    return undefined;
  }
  return value;
}

function safeContext(value: unknown): SafeContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Record<string, unknown>;
  const context: SafeContext = {};

  if (
    (typeof input.appId === 'string' || typeof input.appId === 'number') &&
    /^\d{1,20}$/.test(String(input.appId))
  ) {
    context.appId = String(input.appId);
  }
  if (
    typeof input.bundleId === 'string' &&
    SAFE_BUNDLE_ID_RE.test(input.bundleId)
  ) {
    context.bundleId = input.bundleId;
  }
  if (
    (typeof input.store === 'string' || typeof input.store === 'number') &&
    /^\d{6}$/.test(String(input.store))
  ) {
    context.store = String(input.store);
  }
  if (
    typeof input.version === 'string' &&
    SAFE_VERSION_RE.test(input.version)
  ) {
    context.version = input.version;
  }

  return Object.keys(context).length > 0 ? context : undefined;
}

router.post('/client-logs', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as ClientDiagnosticBody;
  const operation = safeName(body.operation);
  const phase = safeName(body.phase);

  if (!operation || !phase) {
    res.status(400).json({ error: 'Invalid diagnostic event' });
    return;
  }

  const eventId = safeEventId(body.eventId);
  const level =
    typeof body.level === 'string' && ALLOWED_LEVELS.has(body.level)
      ? body.level
      : 'error';

  const event = {
    timestamp: new Date().toISOString(),
    source: 'browser',
    eventId,
    level,
    operation,
    phase,
    errorName: safeErrorName(body.errorName),
    errorCode: sanitizeLogMessage(body.errorCode, 64),
    httpStatus: safeStatus(body.httpStatus),
    message: sanitizeLogMessage(body.message),
    context: safeContext(body.context),
  };

  const serialized = JSON.stringify(event);
  if (level === 'warn') {
    console.warn(`[ClientDiagnostic] ${serialized}`);
  } else {
    console.error(`[ClientDiagnostic] ${serialized}`);
  }

  res.status(202).json({ accepted: true, eventId });
});

export default router;
