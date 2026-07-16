"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import posthog from "posthog-js";
import { track } from "@/lib/analytics";
import { QUOTE_CONSENT_LABEL } from "@/lib/quote-consent";

const MONO = "'IBM Plex Mono',monospace";
const HEAD = "'Archivo',sans-serif";
const SERIF = "'Instrument Serif',serif";

const INK = "#1a2129";
const BLUE = "#3E6FA6";
const ERR = "#b23530";

const labelStyle: React.CSSProperties = {
  display: "block",
  fontFamily: MONO,
  fontSize: 11.5,
  textTransform: "uppercase",
  letterSpacing: ".08em",
  color: "#5b6570",
  marginBottom: 6,
};

const baseInputStyle: React.CSSProperties = {
  width: "100%",
  background: "#fff",
  border: "1px solid rgba(26,33,41,.18)",
  borderRadius: 3,
  padding: "10px 12px",
  font: "inherit",
  fontSize: 15,
  color: INK,
  outline: "none",
  boxSizing: "border-box",
};

function useFocusBorder() {
  const onFocus = (
    e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    e.currentTarget.style.borderColor = BLUE;
  };
  const onBlur = (
    e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    e.currentTarget.style.borderColor = "rgba(26,33,41,.18)";
  };
  return { onFocus, onBlur };
}

type FormState = {
  name: string;
  business: string;
  phone: string;
  email: string;
  hoods: string;
  message: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  business: "",
  phone: "",
  email: "",
  hoods: "1–2",
  message: "",
};

export default function QuoteModal() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [consentCalls, setConsentCalls] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const successRef = useRef(false);
  const focusHandlers = useFocusBorder();

  useEffect(() => {
    successRef.current = success;
  }, [success]);

  // Open on the custom event dispatched by the 3D experience CTAs.
  useEffect(() => {
    const onOpen = () => {
      // If a previous submission succeeded, start fresh next time.
      if (successRef.current) {
        setForm(EMPTY_FORM);
        setConsentCalls(false);
      }
      setSuccess(false);
      setError(null);
      setOpen(true);
    };
    window.addEventListener("vw:quote-open", onOpen);
    return () => window.removeEventListener("vw:quote-open", onOpen);
  }, []);

  // Lock page scroll while open; close on ESC.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const set =
    (key: keyof FormState) =>
    (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
    ) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
    };

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (submitting) return;

      const name = form.name.trim();
      const phone = form.phone.trim();
      const email = form.email.trim();

      if (!name) {
        setError("Please tell us your name.");
        return;
      }
      if (!phone && !email) {
        setError("Please include a phone number or an email so we can reach you.");
        return;
      }

      setError(null);
      setSubmitting(true);
      try {
        let distinctId: string | undefined;
        try {
          distinctId = posthog.__loaded ? posthog.get_distinct_id() : undefined;
        } catch {
          distinctId = undefined;
        }

        const res = await fetch("/api/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            business: form.business.trim(),
            phone,
            email,
            hoods: form.hoods,
            message: form.message.trim(),
            consentCalls,
            distinctId,
            url: window.location.href,
          }),
        });

        if (res.ok) {
          track("quote_submitted", { business: form.business.trim(), hoods: form.hoods });
          setSuccess(true);
        } else {
          let msg = "Something went wrong sending your request. Please try again.";
          try {
            const data = await res.json();
            if (data && typeof data.error === "string" && data.error) msg = data.error;
          } catch {
            /* keep default message */
          }
          setError(msg);
        }
      } catch {
        setError("Network error — please check your connection and try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [form, submitting, consentCalls]
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Get a free quote"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(15,21,27,.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        cursor: "auto",
        overflowY: "auto",
      }}
    >
      <div
        ref={cardRef}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 520,
          maxHeight: "calc(100vh - 40px)",
          overflowY: "auto",
          background: "#f3f8fb",
          border: "1px solid rgba(26,33,41,.12)",
          borderRadius: 6,
          padding: 32,
          boxShadow: "0 24px 64px rgba(15,21,27,.35)",
          color: "#414c57",
        }}
      >
        {/* Close (X) */}
        <button
          type="button"
          aria-label="Close"
          onClick={() => setOpen(false)}
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "1px solid rgba(26,33,41,.18)",
            borderRadius: 3,
            color: INK,
            fontFamily: MONO,
            fontSize: 14,
            lineHeight: 1,
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = INK;
            e.currentTarget.style.color = "#fff";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = INK;
          }}
        >
          ✕
        </button>

        {success ? (
          <div style={{ textAlign: "center", padding: "24px 4px" }}>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 12,
                letterSpacing: ".16em",
                color: BLUE,
                marginBottom: 14,
              }}
            >
              REQUEST RECEIVED
            </div>
            <h2
              style={{
                fontFamily: HEAD,
                fontWeight: 800,
                fontSize: 26,
                lineHeight: 1.2,
                color: INK,
                margin: "0 0 12px",
              }}
            >
              Request received — we&rsquo;ll call you back within{" "}
              <span style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, color: BLUE }}>
                one business day
              </span>
              .
            </h2>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 11.5,
                letterSpacing: ".12em",
                color: "#5b6570",
                marginBottom: 24,
              }}
            >
              LICENSED &amp; INSURED · AFTER-HOURS CREWS
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                background: INK,
                color: "#fff",
                border: "none",
                borderRadius: 3,
                padding: "12px 28px",
                fontFamily: MONO,
                fontSize: 12.5,
                letterSpacing: ".1em",
                textTransform: "uppercase",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = BLUE)}
              onMouseLeave={(e) => (e.currentTarget.style.background = INK)}
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 12,
                letterSpacing: ".16em",
                color: BLUE,
                marginBottom: 10,
              }}
            >
              NFPA 96 HOOD &amp; EXHAUST CLEANING
            </div>
            <h2
              style={{
                fontFamily: HEAD,
                fontWeight: 800,
                fontSize: 30,
                lineHeight: 1.15,
                color: INK,
                margin: "0 0 6px",
              }}
            >
              Get your{" "}
              <span style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, color: BLUE }}>
                free quote
              </span>
            </h2>
            <p style={{ fontSize: 14.5, lineHeight: 1.55, margin: "0 0 22px", color: "#414c57" }}>
              Tell us about your kitchen and we&rsquo;ll get back to you within one
              business day with a firm price.
            </p>

            <form onSubmit={handleSubmit} noValidate>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label htmlFor="vw-q-name" style={labelStyle}>
                    Name *
                  </label>
                  <input
                    id="vw-q-name"
                    type="text"
                    value={form.name}
                    onChange={set("name")}
                    autoComplete="name"
                    style={baseInputStyle}
                    {...focusHandlers}
                  />
                </div>
                <div>
                  <label htmlFor="vw-q-business" style={labelStyle}>
                    Business name
                  </label>
                  <input
                    id="vw-q-business"
                    type="text"
                    value={form.business}
                    onChange={set("business")}
                    autoComplete="organization"
                    style={baseInputStyle}
                    {...focusHandlers}
                  />
                </div>
                <div>
                  <label htmlFor="vw-q-phone" style={labelStyle}>
                    Phone *
                  </label>
                  <input
                    id="vw-q-phone"
                    type="tel"
                    value={form.phone}
                    onChange={set("phone")}
                    autoComplete="tel"
                    style={baseInputStyle}
                    {...focusHandlers}
                  />
                </div>
                <div>
                  <label htmlFor="vw-q-email" style={labelStyle}>
                    Email
                  </label>
                  <input
                    id="vw-q-email"
                    type="email"
                    value={form.email}
                    onChange={set("email")}
                    autoComplete="email"
                    style={baseInputStyle}
                    {...focusHandlers}
                  />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label htmlFor="vw-q-hoods" style={labelStyle}>
                    Number of hoods
                  </label>
                  <select
                    id="vw-q-hoods"
                    value={form.hoods}
                    onChange={set("hoods")}
                    style={{ ...baseInputStyle, appearance: "auto", cursor: "pointer" }}
                    {...focusHandlers}
                  >
                    <option value="1–2">1–2</option>
                    <option value="3–5">3–5</option>
                    <option value="6+">6+</option>
                  </select>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label htmlFor="vw-q-message" style={labelStyle}>
                    Message
                  </label>
                  <textarea
                    id="vw-q-message"
                    rows={3}
                    value={form.message}
                    onChange={set("message")}
                    style={{ ...baseInputStyle, resize: "vertical" }}
                    {...focusHandlers}
                  />
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  style={{
                    marginTop: 12,
                    fontFamily: MONO,
                    fontSize: 12,
                    letterSpacing: ".02em",
                    color: ERR,
                  }}
                >
                  {error}
                </div>
              )}

              {/* Optional consent checkbox — unchecked by default (spec D14). */}
              <label
                htmlFor="vw-q-consent"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  marginTop: 16,
                  fontFamily: MONO,
                  fontSize: 11.5,
                  lineHeight: 1.6,
                  letterSpacing: ".02em",
                  color: "#5b6570",
                  cursor: "pointer",
                }}
              >
                <input
                  id="vw-q-consent"
                  type="checkbox"
                  checked={consentCalls}
                  onChange={(e) => setConsentCalls(e.target.checked)}
                  style={{ marginTop: 3, flexShrink: 0, accentColor: BLUE, cursor: "pointer" }}
                />
                <span>{QUOTE_CONSENT_LABEL}</span>
              </label>

              <button
                type="submit"
                disabled={submitting}
                style={{
                  marginTop: 20,
                  width: "100%",
                  background: submitting ? "#3a434d" : INK,
                  color: "#fff",
                  border: "none",
                  borderRadius: 3,
                  padding: "13px 24px",
                  fontFamily: MONO,
                  fontSize: 13,
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  cursor: submitting ? "wait" : "pointer",
                  transition: "background .15s ease",
                }}
                onMouseEnter={(e) => {
                  if (!submitting) e.currentTarget.style.background = BLUE;
                }}
                onMouseLeave={(e) => {
                  if (!submitting) e.currentTarget.style.background = INK;
                }}
              >
                {submitting ? "Sending…" : "Request my free quote"}
              </button>

              <div
                style={{
                  marginTop: 12,
                  textAlign: "center",
                  fontFamily: MONO,
                  fontSize: 10.5,
                  letterSpacing: ".1em",
                  color: "#8a94a0",
                }}
              >
                NO SPAM · NO OBLIGATION · CERTIFIED CREWS
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
