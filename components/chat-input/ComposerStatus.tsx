"use client";

import { memo } from "react";
import type { AttachedImage, Translate } from "./types";

interface Props {
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  attachedImages: AttachedImage[];
  onRemoveImage: (index: number) => void;
  t: Translate;
}

export const ComposerStatus = memo(function ComposerStatus({ retryInfo, attachedImages, onRemoveImage, t }: Props) {
  return (
    <>
      {retryInfo && (
        <div className="pi-retry-banner" style={{
          marginBottom: 8, padding: "5px 10px",
          background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)",
          borderRadius: 6, fontSize: 12, color: "rgba(180,130,0,0.9)",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          {t("chat.retrying", { attempt: retryInfo.attempt, maxAttempts: retryInfo.maxAttempts })}
          {retryInfo.errorMessage && <span style={{ opacity: 0.7, marginLeft: 4 }}> - {retryInfo.errorMessage}</span>}
        </div>
      )}
      {attachedImages.length > 0 && (
        <div className="pi-attachment-preview-strip" style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
          {attachedImages.map((image, index) => (
            <div key={image.previewUrl} style={{ position: "relative", flexShrink: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.previewUrl} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)", display: "block" }} />
              <button
                onClick={() => onRemoveImage(index)}
                aria-label={t("chat.removeImage")}
                title={t("chat.removeImage")}
                style={{
                  position: "absolute", top: -4, right: -4, width: 16, height: 16, borderRadius: "50%",
                  background: "var(--bg-panel)", border: "1px solid var(--border)", display: "flex",
                  alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0, color: "var(--text-muted)",
                }}
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="1" y1="1" x2="7" y2="7" /><line x1="7" y1="1" x2="1" y2="7" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
});
