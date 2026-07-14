import type { Metadata } from "next";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/branding";
import { DARK_THEME_IDS, DEFAULT_THEME, LEGACY_THEME_MAP, THEME_IDS } from "@/lib/themes";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
};

const THEME_BOOTSTRAP = `(function(){var d=document.documentElement;var allowed=${JSON.stringify(Object.fromEntries(THEME_IDS.map((id) => [id, 1])))};var dark=${JSON.stringify(Object.fromEntries(DARK_THEME_IDS.map((id) => [id, 1])))};var legacy=${JSON.stringify(LEGACY_THEME_MAP)};var fallback=${JSON.stringify(DEFAULT_THEME)};var stored=fallback;try{stored=localStorage.getItem("pi-theme")||fallback}catch(e){}var t=legacy[stored]||stored;if(!allowed[t])t=fallback;if(t!==stored){try{localStorage.setItem("pi-theme",t)}catch(e){}}d.dataset.theme=t;if(dark[t])d.classList.add("dark");else d.classList.remove("dark");var ui="fluid";try{var storedUi=localStorage.getItem("pi-ui-mode");if(storedUi==="classic"||storedUi==="fluid")ui=storedUi}catch(e){}d.dataset.ui=ui})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: THEME_BOOTSTRAP,
          }}
        />
      </head>
      <body style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
        {children}
      </body>
    </html>
  );
}
