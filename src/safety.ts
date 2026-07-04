const SECRET_PATTERNS = [
  /\b(xox[baprs]-[A-Za-z0-9-]+)\b/g,
  /\b(nvapi-[A-Za-z0-9_-]+)\b/g,
  /\b(tvly-[A-Za-z0-9_-]+)\b/g,
  /\b(sk-[A-Za-z0-9_-]+)\b/g,
  /\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g
];

export function redactSensitiveText(input: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[redacted]"), input);
}

export function truncateForPrompt(input: string, maxChars = 16_000): string {
  const clean = redactSensitiveText(input.trim());
  if (clean.length <= maxChars) {
    return clean;
  }
  return `${clean.slice(0, maxChars)}\n\n[truncated for prompt budget]`;
}
