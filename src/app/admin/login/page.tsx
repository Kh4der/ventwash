"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push("/admin");
        router.refresh();
        return;
      }
      if (res.status === 401) {
        setError("Wrong password");
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Something went wrong");
      }
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0f151b",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "auto",
        padding: 20,
        zIndex: 50,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: 380,
          background: "#151d25",
          border: "1px solid rgba(255,255,255,.08)",
          borderRadius: 8,
          padding: "36px 32px",
        }}
      >
        <div
          style={{
            fontFamily: "'Archivo',sans-serif",
            fontWeight: 800,
            fontSize: 26,
            letterSpacing: "-0.02em",
            color: "#f3f8fb",
            marginBottom: 6,
          }}
        >
          VENT
          <span
            style={{
              fontFamily: "'Instrument Serif',serif",
              fontStyle: "italic",
              fontWeight: 400,
              color: "#9db8d2",
            }}
          >
            WASH
          </span>
        </div>
        <div
          style={{
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: 11,
            letterSpacing: "0.16em",
            color: "#6b7c8d",
            marginBottom: 28,
          }}
        >
          ADMIN — ANALYTICS
        </div>

        <label
          htmlFor="admin-password"
          style={{
            display: "block",
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: 11,
            letterSpacing: "0.14em",
            color: "#8fa1b3",
            marginBottom: 8,
          }}
        >
          PASSWORD
        </label>
        <input
          id="admin-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="current-password"
          style={{
            width: "100%",
            background: "#0f151b",
            border: "1px solid rgba(255,255,255,.12)",
            borderRadius: 3,
            color: "#f3f8fb",
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: 14,
            padding: "11px 12px",
            outline: "none",
            marginBottom: 16,
          }}
        />

        {error && (
          <div
            style={{
              fontFamily: "'IBM Plex Mono',monospace",
              fontSize: 12,
              color: "#e08a86",
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          style={{
            width: "100%",
            background: busy ? "#2a3642" : "#3E6FA6",
            color: "#f3f8fb",
            border: "none",
            borderRadius: 3,
            padding: "12px 16px",
            fontFamily: "'Archivo',sans-serif",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: "0.08em",
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy ? "CHECKING…" : "SIGN IN"}
        </button>
      </form>
    </div>
  );
}
