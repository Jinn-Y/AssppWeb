const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const SENSITIVE_QUERY_RE =
  /([?&](?:guid|token|password|passwordToken|dsid|directoryServicesIdentifier|code)=)[^&\s]+/gi;
const LONG_HEX_RE = /\b[a-f0-9]{24,}\b/gi;
const LONG_DATA_RE = /\b[a-zA-Z0-9+/_=-]{64,}\b/g;

export function sanitizeLogMessage(
  value: unknown,
  maxLength = 320,
): string | undefined {
  if (typeof value !== 'string') return undefined;

  const sanitized = value
    .trim()
    .replace(EMAIL_RE, '[redacted-email]')
    .replace(SENSITIVE_QUERY_RE, '$1[redacted]')
    .replace(LONG_HEX_RE, '[redacted-id]')
    .replace(LONG_DATA_RE, '[redacted-data]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, maxLength);

  return sanitized || undefined;
}
