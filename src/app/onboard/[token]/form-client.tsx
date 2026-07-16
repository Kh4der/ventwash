"use client";

import { useState } from "react";

/**
 * Onboarding intake form (client). One clean page in three sections —
 * Contact, Kitchen details, Scheduling preferences. Field names match the
 * sanitizeOnboardingData whitelist exactly; fuel types are a checkbox group
 * serialized to a comma-separated string. Submits to /api/onboarding/[token]
 * and swaps to a success panel.
 */

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

const sectionStyle: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: ".14em",
  color: BLUE,
  borderBottom: "1px solid rgba(26,33,41,.1)",
  paddingBottom: 8,
  margin: "28px 0 16px",
};

const hintStyle: React.CSSProperties = {
  fontSize: 12.5,
  lineHeight: 1.5,
  color: "#8a94a0",
  marginTop: 6,
};

function useFocusBorder() {
  const onFocus = (
    e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    e.currentTarget.style.borderColor = BLUE;
  };
  const onBlur = (
    e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    e.currentTarget.style.borderColor = "rgba(26,33,41,.18)";
  };
  return { onFocus, onBlur };
}

type FormState = {
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  business_address: string;
  hood_count: string;
  hood_locations: string;
  cooking_volume: string;
  roof_access: string;
  operating_hours: string;
  coi_required: string;
  service_frequency: string;
  preferred_days: string;
  preferred_time: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  contact_name: "",
  contact_phone: "",
  contact_email: "",
  business_address: "",
  hood_count: "",
  hood_locations: "",
  cooking_volume: "",
  roof_access: "",
  operating_hours: "",
  coi_required: "",
  service_frequency: "",
  preferred_days: "",
  preferred_time: "",
  notes: "",
};

const FUEL_OPTIONS = ["Gas", "Electric", "Solid fuel / wood / charcoal"];

export default function OnboardingFormClient({ token }: { token: string }) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fuels, setFuels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const focusHandlers = useFocusBorder();

  const set =
    (key: keyof FormState) =>
    (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
    ) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
    };

  const toggleFuel = (fuel: string) => {
    setFuels((prev) =>
      prev.includes(fuel) ? prev.filter((f) => f !== fuel) : [...prev, fuel],
    );
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    if (!form.contact_name.trim()) {
      setError("Please tell us who to reach on site.");
      return;
    }
    if (!form.contact_phone.trim()) {
      setError("Please include a phone number for scheduling.");
      return;
    }
    if (!form.business_address.trim()) {
      setError("Please include the service address.");
      return;
    }
    if (!form.hood_count) {
      setError("Please select how many hoods you have.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const data: Record<string, string> = { ...form };
      if (fuels.length) data.fuel_types = fuels.join(", ");

      const res = await fetch(`/api/onboarding/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
      });

      if (res.ok) {
        setSuccess(true);
      } else {
        let msg = "Something went wrong sending your details. Please try again.";
        try {
          const payload = await res.json();
          if (payload && typeof payload.error === "string" && payload.error) msg = payload.error;
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
  }

  if (success) {
    return (
      <div
        style={{
          background: "#fff",
          border: "1px solid rgba(26,33,41,.1)",
          borderRadius: 8,
          padding: "40px 28px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: MONO,
            fontSize: 12,
            letterSpacing: ".16em",
            color: BLUE,
            marginBottom: 14,
          }}
        >
          DETAILS RECEIVED
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
          You&rsquo;re{" "}
          <span style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, color: BLUE }}>
            all set
          </span>
          .
        </h2>
        <p style={{ fontSize: 15, lineHeight: 1.6, margin: 0, color: "#414c57" }}>
          Check your email — we&rsquo;ll confirm your inspection time shortly.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      style={{
        background: "#fff",
        border: "1px solid rgba(26,33,41,.1)",
        borderRadius: 8,
        padding: "8px 28px 28px",
      }}
    >
      {/* ── Contact ── */}
      <div style={sectionStyle}>Contact</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <label htmlFor="vw-ob-contact-name" style={labelStyle}>
            Contact name *
          </label>
          <input
            id="vw-ob-contact-name"
            type="text"
            value={form.contact_name}
            onChange={set("contact_name")}
            autoComplete="name"
            style={baseInputStyle}
            {...focusHandlers}
          />
        </div>
        <div>
          <label htmlFor="vw-ob-contact-phone" style={labelStyle}>
            Phone *
          </label>
          <input
            id="vw-ob-contact-phone"
            type="tel"
            value={form.contact_phone}
            onChange={set("contact_phone")}
            autoComplete="tel"
            style={baseInputStyle}
            {...focusHandlers}
          />
        </div>
        <div>
          <label htmlFor="vw-ob-contact-email" style={labelStyle}>
            Email
          </label>
          <input
            id="vw-ob-contact-email"
            type="email"
            value={form.contact_email}
            onChange={set("contact_email")}
            autoComplete="email"
            style={baseInputStyle}
            {...focusHandlers}
          />
        </div>
        <div>
          <label htmlFor="vw-ob-address" style={labelStyle}>
            Business address *
          </label>
          <input
            id="vw-ob-address"
            type="text"
            value={form.business_address}
            onChange={set("business_address")}
            autoComplete="street-address"
            style={baseInputStyle}
            {...focusHandlers}
          />
        </div>
      </div>

      {/* ── Kitchen details ── */}
      <div style={sectionStyle}>Kitchen details</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <label htmlFor="vw-ob-hood-count" style={labelStyle}>
            Number of hoods *
          </label>
          <select
            id="vw-ob-hood-count"
            value={form.hood_count}
            onChange={set("hood_count")}
            style={{ ...baseInputStyle, appearance: "auto", cursor: "pointer" }}
            {...focusHandlers}
          >
            <option value="">Select…</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5">5</option>
            <option value="6+">6+</option>
          </select>
        </div>
        <div>
          <label htmlFor="vw-ob-cooking-volume" style={labelStyle}>
            Cooking volume
          </label>
          <select
            id="vw-ob-cooking-volume"
            value={form.cooking_volume}
            onChange={set("cooking_volume")}
            style={{ ...baseInputStyle, appearance: "auto", cursor: "pointer" }}
            {...focusHandlers}
          >
            <option value="">Select…</option>
            <option value="Light">Light</option>
            <option value="Moderate">Moderate</option>
            <option value="Heavy / 24-7">Heavy / 24-7</option>
          </select>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="vw-ob-hood-locations" style={labelStyle}>
            Hood locations
          </label>
          <textarea
            id="vw-ob-hood-locations"
            rows={2}
            value={form.hood_locations}
            onChange={set("hood_locations")}
            placeholder="e.g. main line, prep kitchen, basement bakery"
            style={{ ...baseInputStyle, resize: "vertical" }}
            {...focusHandlers}
          />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <span style={labelStyle}>Fuel types</span>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {FUEL_OPTIONS.map((fuel) => (
              <label
                key={fuel}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 14.5,
                  color: INK,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={fuels.includes(fuel)}
                  onChange={() => toggleFuel(fuel)}
                  style={{ accentColor: BLUE }}
                />
                {fuel}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="vw-ob-roof-access" style={labelStyle}>
            Roof access
          </label>
          <select
            id="vw-ob-roof-access"
            value={form.roof_access}
            onChange={set("roof_access")}
            style={{ ...baseInputStyle, appearance: "auto", cursor: "pointer" }}
            {...focusHandlers}
          >
            <option value="">Select…</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
            <option value="Unsure">Unsure</option>
          </select>
        </div>
        <div>
          <label htmlFor="vw-ob-operating-hours" style={labelStyle}>
            Operating hours
          </label>
          <input
            id="vw-ob-operating-hours"
            type="text"
            value={form.operating_hours}
            onChange={set("operating_hours")}
            placeholder="e.g. 11am–11pm daily"
            style={baseInputStyle}
            {...focusHandlers}
          />
        </div>
        <div>
          <label htmlFor="vw-ob-coi" style={labelStyle}>
            COI required?
          </label>
          <select
            id="vw-ob-coi"
            value={form.coi_required}
            onChange={set("coi_required")}
            style={{ ...baseInputStyle, appearance: "auto", cursor: "pointer" }}
            {...focusHandlers}
          >
            <option value="">Select…</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
            <option value="Unsure">Unsure</option>
          </select>
          <div style={hintStyle}>Certificate of insurance for your landlord or property manager.</div>
        </div>
        <div>
          <label htmlFor="vw-ob-frequency" style={labelStyle}>
            Service frequency
          </label>
          <select
            id="vw-ob-frequency"
            value={form.service_frequency}
            onChange={set("service_frequency")}
            style={{ ...baseInputStyle, appearance: "auto", cursor: "pointer" }}
            {...focusHandlers}
          >
            <option value="">Select…</option>
            <option value="Monthly">Monthly</option>
            <option value="Quarterly">Quarterly</option>
            <option value="Semi-annual">Semi-annual</option>
            <option value="Annual">Annual</option>
            <option value="Not sure">Not sure</option>
          </select>
          <div style={hintStyle}>
            NFPA 96 baseline: quarterly for most kitchens, monthly for solid-fuel cooking.
          </div>
        </div>
      </div>

      {/* ── Scheduling preferences ── */}
      <div style={sectionStyle}>Scheduling preferences</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <label htmlFor="vw-ob-preferred-days" style={labelStyle}>
            Preferred days
          </label>
          <input
            id="vw-ob-preferred-days"
            type="text"
            value={form.preferred_days}
            onChange={set("preferred_days")}
            placeholder="e.g. Mon–Wed"
            style={baseInputStyle}
            {...focusHandlers}
          />
        </div>
        <div>
          <label htmlFor="vw-ob-preferred-time" style={labelStyle}>
            Preferred time
          </label>
          <input
            id="vw-ob-preferred-time"
            type="text"
            value={form.preferred_time}
            onChange={set("preferred_time")}
            placeholder="e.g. after close, before 10am"
            style={baseInputStyle}
            {...focusHandlers}
          />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="vw-ob-notes" style={labelStyle}>
            Anything else
          </label>
          <textarea
            id="vw-ob-notes"
            rows={3}
            value={form.notes}
            onChange={set("notes")}
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
        {submitting ? "Sending…" : "Submit kitchen details"}
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
        USED ONLY TO PLAN YOUR SERVICE · NEVER SOLD
      </div>
    </form>
  );
}
