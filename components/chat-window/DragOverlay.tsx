import { memo } from "react";

export const DragOverlay = memo(function DragOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-50 flex animate-[drop-zone-in_0.15s_ease_both] items-center justify-center bg-[rgba(37,99,235,0.06)] backdrop-blur-[1px]">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {[0, 0.8, 1.6].map((delay) => (
          <div key={delay} className="absolute h-[720px] w-[720px] rounded-full border-[1.5px] border-solid border-[rgba(37,99,235,0.5)] animate-[drop-ripple_2.4s_ease-out_infinite_backwards]" style={{ transformOrigin: "center", animationDelay: `${delay}s` }} />
        ))}
      </div>
      <svg width="280" height="280" viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_6px_18px_rgba(37,99,235,0.18)]">
        <rect x="28" y="44" width="84" height="60" rx="8" fill="rgba(37,99,235,0.08)" stroke="rgba(37,99,235,0.50)" strokeWidth="1.8" />
        <path d="M36 100 L54 72 L68 88 L80 74 L104 100Z" fill="rgba(37,99,235,0.16)" stroke="rgba(37,99,235,0.40)" strokeWidth="1.4" strokeLinejoin="round" />
        <circle cx="96" cy="58" r="8" fill="rgba(37,99,235,0.22)" stroke="rgba(37,99,235,0.55)" strokeWidth="1.6" />
        <g stroke="rgba(37,99,235,0.45)" strokeWidth="1.4" strokeLinecap="round">
          <line x1="96" y1="46" x2="96" y2="43" /><line x1="96" y1="70" x2="96" y2="73" />
          <line x1="84" y1="58" x2="81" y2="58" /><line x1="108" y1="58" x2="111" y2="58" />
          <line x1="87.5" y1="49.5" x2="85.4" y2="47.4" /><line x1="104.5" y1="66.5" x2="106.6" y2="68.6" />
          <line x1="104.5" y1="49.5" x2="106.6" y2="47.4" /><line x1="87.5" y1="66.5" x2="85.4" y2="68.6" />
        </g>
      </svg>
    </div>
  );
});
