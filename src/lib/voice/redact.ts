/**
 * Transcript redaction — runs BEFORE any transcript/summary is persisted.
 * Callers sometimes read out payment cards or SSNs even though the agent
 * never asks; storing them would put us in PCI/PII scope.
 */

const PATTERNS: { name: string; re: RegExp }[] = [
  // 13-19 digit card numbers, with optional space/dash separators.
  { name: "card", re: /\b(?:\d[ -]?){13,19}\b/g },
  // SSN: 123-45-6789 or 123 45 6789.
  { name: "ssn", re: /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g },
];

/** Words-as-digits spoken card sequences ("four one one one ...") — collapse runs of 13+ number words. */
const NUMBER_WORDS =
  "(?:zero|one|two|three|four|five|six|seven|eight|nine)";
const SPOKEN_RUN = new RegExp(`\\b(?:${NUMBER_WORDS}[\\s,-]+){12,}${NUMBER_WORDS}\\b`, "gi");

export function redactTranscript(text: string | null | undefined): string | null {
  if (!text) return text ?? null;
  let out = text;
  for (const { name, re } of PATTERNS) {
    out = out.replace(re, (match) => {
      // Don't nuke ordinary phone numbers (10-11 digits) in the card pass.
      const digits = match.replace(/\D/g, "");
      if (name === "card" && (digits.length === 10 || (digits.length === 11 && digits.startsWith("1")))) {
        return match;
      }
      return `[REDACTED-${name.toUpperCase()}]`;
    });
  }
  out = out.replace(SPOKEN_RUN, "[REDACTED-SPOKEN-DIGITS]");
  return out;
}
