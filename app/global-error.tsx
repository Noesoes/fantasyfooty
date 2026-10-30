"use client"; // Error boundaries must be Client Components

// Last-resort crash screen (if the app shell itself fails). It renders its own
// document, so it's styled inline rather than with the app's theme.

import { useEffect } from "react";
import { logError } from "@/lib/errorlog";

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    logError(error);
  }, [error]);
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0b14",
          color: "#fff",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: 24,
        }}
      >
        <div>
          <title>Prime Time</title>
          <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Something broke</h1>
          <p style={{ color: "#a3aac0", fontSize: 14, margin: "0 0 20px" }}>
            The app hit an error while starting. Your saved settings are fine.
          </p>
          <button
            onClick={() => retry()}
            style={{
              background: "#5eead4",
              color: "#0a0b14",
              border: 0,
              borderRadius: 16,
              padding: "12px 20px",
              fontWeight: 800,
              marginRight: 8,
            }}
          >
            Try again
          </button>
          <button
            onClick={() => location.reload()}
            style={{
              background: "transparent",
              color: "#fff",
              border: "1px solid #3a3f55",
              borderRadius: 16,
              padding: "12px 20px",
              fontWeight: 700,
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
