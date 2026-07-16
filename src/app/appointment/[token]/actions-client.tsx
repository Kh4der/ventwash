"use client";

import { useState } from "react";

/**
 * Interactive confirm / cancel / reschedule controls for the customer
 * appointment page. Client components never touch the kernel directly —
 * every action is a POST to /api/appointments/[token], and the result is
 * re-rendered locally from the response.
 */

const MONO = "'IBM Plex Mono',monospace";
const HEAD = "'Archivo',sans-serif";
const INK = "#1a2129";
const BLUE = "#3E6FA6";
const ERR = "#b23530";

type Slot = { startsAt: string; label: string };

type Props = {
  token: string;
  status: string;
  startsAt: string;
  slots: Slot[];
};

const inkButton: React.CSSProperties = {
  background: INK,
  color: "#fff",
  border: "none",
  borderRadius: 3,
  padding: "12px 22px",
  fontFamily: MONO,
  fontSize: 12.5,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  cursor: "pointer",
  transition: "background .15s ease",
};

const outlineButton: React.CSSProperties = {
  background: "transparent",
  color: INK,
  border: "1px solid rgba(26,33,41,.25)",
  borderRadius: 3,
  padding: "12px 22px",
  fontFamily: MONO,
  fontSize: 12.5,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  cursor: "pointer",
  transition: "background .15s ease, color .15s ease",
};

const sectionLabel: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: ".14em",
  color: "#5b6570",
  marginBottom: 10,
};

const TERMINAL = ["completed", "cancelled", "no_show"];

export default function AppointmentActions({ token, status: initialStatus, slots }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState<"confirm" | "cancel" | "reschedule" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picked, setPicked] = useState("");

  const terminal = TERMINAL.includes(status);
  const canConfirm = status === "tentative" || status === "rescheduled";

  async function act(
    kind: "confirm" | "cancel" | "reschedule",
    body: Record<string, string>,
    successNotice: string,
  ) {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/appointments/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let data: { appointment?: { status?: string }; error?: string } | null = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (res.ok && data && data.appointment) {
        setStatus(String(data.appointment.status ?? status));
        setNotice(successNotice);
      } else {
        setError(
          data && typeof data.error === "string" && data.error
            ? data.error
            : "Something went wrong — please try again.",
        );
      }
    } catch {
      setError("Network error — please check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const pickedSlot = slots.find((s) => s.startsAt === picked);

  return (
    <div style={{ marginTop: 24, borderTop: "1px solid rgba(26,33,41,.1)", paddingTop: 20 }}>
      {notice && (
        <div
          style={{
            fontFamily: HEAD,
            fontWeight: 700,
            fontSize: 15,
            color: "#2e6b3f",
            marginBottom: 14,
          }}
        >
          {notice}
        </div>
      )}
      {error && (
        <div
          role="alert"
          style={{
            fontFamily: MONO,
            fontSize: 12,
            letterSpacing: ".02em",
            color: ERR,
            marginBottom: 14,
          }}
        >
          {error}
        </div>
      )}

      {terminal ? (
        !notice && (
          <p style={{ fontSize: 14.5, lineHeight: 1.55, margin: 0, color: "#5b6570" }}>
            This appointment can no longer be changed from this page. Need
            something? Reply to your confirmation email or give us a call.
          </p>
        )
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {canConfirm && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => act("confirm", { action: "confirm" }, "Thanks — your appointment is confirmed.")}
                style={{ ...inkButton, cursor: busy ? "wait" : "pointer" }}
                onMouseEnter={(e) => {
                  if (!busy) e.currentTarget.style.background = BLUE;
                }}
                onMouseLeave={(e) => {
                  if (!busy) e.currentTarget.style.background = INK;
                }}
              >
                {busy === "confirm" ? "Confirming…" : "Confirm"}
              </button>
            )}
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                if (window.confirm("Cancel this appointment? This can't be undone from this page.")) {
                  act("cancel", { action: "cancel" }, "Your appointment has been cancelled.");
                }
              }}
              style={{ ...outlineButton, cursor: busy ? "wait" : "pointer" }}
              onMouseEnter={(e) => {
                if (!busy) {
                  e.currentTarget.style.background = INK;
                  e.currentTarget.style.color = "#fff";
                }
              }}
              onMouseLeave={(e) => {
                if (!busy) {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = INK;
                }
              }}
            >
              {busy === "cancel" ? "Cancelling…" : "Cancel"}
            </button>
          </div>

          {slots.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div style={sectionLabel}>Need a different time?</div>
              <div style={{ display: "grid", gap: 8 }}>
                {slots.map((s) => (
                  <label
                    key={s.startsAt}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      border:
                        picked === s.startsAt
                          ? `1px solid ${BLUE}`
                          : "1px solid rgba(26,33,41,.18)",
                      borderRadius: 3,
                      padding: "10px 12px",
                      fontSize: 14.5,
                      color: INK,
                      cursor: "pointer",
                      background: picked === s.startsAt ? "rgba(62,111,166,.06)" : "#fff",
                    }}
                  >
                    <input
                      type="radio"
                      name="vw-reschedule-slot"
                      value={s.startsAt}
                      checked={picked === s.startsAt}
                      onChange={() => setPicked(s.startsAt)}
                      style={{ accentColor: BLUE }}
                    />
                    {s.label}
                  </label>
                ))}
              </div>
              <button
                type="button"
                disabled={busy !== null || !picked}
                onClick={() =>
                  act(
                    "reschedule",
                    { action: "reschedule", startsAt: picked },
                    pickedSlot
                      ? `Rescheduled to ${pickedSlot.label} — we'll send an updated confirmation.`
                      : "Rescheduled — we'll send an updated confirmation.",
                  )
                }
                style={{
                  ...inkButton,
                  marginTop: 12,
                  opacity: picked ? 1 : 0.45,
                  cursor: busy ? "wait" : picked ? "pointer" : "not-allowed",
                }}
                onMouseEnter={(e) => {
                  if (!busy && picked) e.currentTarget.style.background = BLUE;
                }}
                onMouseLeave={(e) => {
                  if (!busy) e.currentTarget.style.background = INK;
                }}
              >
                {busy === "reschedule" ? "Rescheduling…" : "Reschedule"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
