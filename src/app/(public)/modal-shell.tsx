"use client";

import { useCallback, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * Overlay for the front-page article gate: closes on ×, Escape, or clicking
 * the backdrop — router.back() returns to the list so the reader keeps
 * browsing exactly where they were.
 */
export function ModalShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const close = useCallback(() => router.back(), [router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [close]);

  return (
    <div
      className="pc-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="pc-modal" role="dialog" aria-modal="true">
        <button className="pc-modal-close" aria-label="Fechar" onClick={close}>
          ×
        </button>
        {children}
      </div>
    </div>
  );
}
