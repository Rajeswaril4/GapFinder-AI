"use client";

import { useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Button } from "@/components/ui";

export function LoginEmailModal() {
  const { user, lastLoginEmail, sendTestLoginEmail } = useApp();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);

  if (!user) return null;

  const emailData = lastLoginEmail || {
    to: user.email,
    subject: "✨ GapFinder AI: New Login to your Account",
    time: new Date().toUTCString(),
    device: typeof window !== "undefined" && /mac/i.test(navigator.userAgent) ? "Desktop (macOS)" : "Web Browser",
    provider: "simulated",
    html: `
      <div style="font-family: sans-serif; padding: 20px; color: #161a2b;">
        <h2 style="color: #4f46e5; margin-top: 0;">◎ GapFinder AI</h2>
        <p>Hi <b>${user.name}</b>,</p>
        <p>You have successfully logged in to your GapFinder AI student account.</p>
        <div style="background: #f1f5f9; padding: 12px; border-radius: 8px; margin: 16px 0; font-size: 13.5px;">
          <div><b>Account:</b> ${user.email}</div>
          <div><b>Time:</b> ${new Date().toUTCString()}</div>
          <div><b>Status:</b> Active Session</div>
        </div>
        <p style="font-size: 13px; color: #64748b;">If this was you, you can safely ignore this message.</p>
      </div>
    `,
  };

  const handleSendTest = async () => {
    setSending(true);
    try {
      await sendTestLoginEmail();
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div
        className="card"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 18px",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius)",
          marginBottom: "16px",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <div className="row" style={{ gap: "10px" }}>
          <span style={{ fontSize: "20px" }}>📧</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: "14px" }}>
              Automated Login Email Notification
            </div>
            <div className="muted" style={{ fontSize: "12.5px" }}>
              Sent to: <b>{user.email}</b> {emailData.provider === "resend" ? "(Delivered via Resend)" : "(Local / Development Mode)"}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: "8px" }}>
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            View Email Message
          </Button>
          <Button size="sm" onClick={handleSendTest} loading={sending}>
            Send Test Alert
          </Button>
        </div>
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.65)",
            display: "grid",
            placeItems: "center",
            padding: "20px",
            zIndex: 9999,
            backdropFilter: "blur(3px)",
          }}
          onClick={() => setOpen(false)}
        >
          <div
            className="card"
            style={{
              maxWidth: "600px",
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              padding: "24px",
              background: "var(--panel)",
              border: "1px solid var(--line)",
              boxShadow: "0 20px 40px rgba(0,0,0,0.3)",
              borderRadius: "16px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row between" style={{ marginBottom: "16px" }}>
              <div>
                <h2 style={{ fontSize: "18px", margin: 0 }}>Login Notification Email</h2>
                <div className="muted" style={{ fontSize: "13px" }}>
                  Triggered automatically on student sign-in
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                ✕ Close
              </Button>
            </div>

            <div
              style={{
                background: "var(--untested-soft)",
                borderRadius: "10px",
                padding: "12px 14px",
                fontSize: "13px",
                marginBottom: "16px",
                display: "grid",
                gap: "6px",
              }}
            >
              <div><b>To:</b> {emailData.to}</div>
              <div><b>Subject:</b> {emailData.subject}</div>
              <div><b>Time:</b> {emailData.time}</div>
              <div><b>Client:</b> {emailData.device}</div>
              <div>
                <b>Delivery Status:</b>{" "}
                <span
                  className={`badge ${emailData.provider === "resend" ? "strong" : "brand"}`}
                  style={{ marginLeft: 6 }}
                >
                  {emailData.provider === "resend" ? "Delivered via Resend" : "Simulated / Logged Locally"}
                </span>
              </div>
            </div>

            <div style={{ marginBottom: "8px", fontWeight: 600, fontSize: "13px" }} className="muted">
              EMAIL MESSAGE PREVIEW:
            </div>

            <div
              style={{
                border: "1px solid var(--line)",
                borderRadius: "12px",
                overflow: "hidden",
                background: "#ffffff",
                color: "#161a2b",
              }}
            >
              <div
                dangerouslySetInnerHTML={{ __html: emailData.html }}
                style={{ padding: "8px" }}
              />
            </div>

            <div className="row between" style={{ marginTop: "20px" }}>
              <div className="muted" style={{ fontSize: "12px" }}>
                Add <code>RESEND_API_KEY</code> in <code>.env</code> to deliver to your real Gmail inbox.
              </div>
              <div className="row" style={{ gap: "8px" }}>
                <Button size="sm" onClick={handleSendTest} loading={sending}>
                  Send Test Alert
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
                  Done
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
