/**
 * The verbatim E-SIGN-style consent checkbox language rendered in the quote
 * form (spec D14). This exact string is BOTH the label the customer sees in
 * QuoteModal.tsx AND the disclosure_text stored in consent_events when the
 * checkbox is ticked — the two must never drift, which is why it lives in
 * this shared module. Changing this string is a legal decision (counsel
 * review is a Phase 5 launch gate); previously captured consent_events keep
 * the text that was shown at their capture time.
 */
export const QUOTE_CONSENT_LABEL =
  "I agree that VentWash may call and text me at the number provided, including with automated/AI calls and texts, about my quote and services. Consent is not a condition of purchase. Reply STOP to opt out.";
