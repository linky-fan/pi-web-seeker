import type { Metadata } from "next";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/branding";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
};

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
            __html: `(function(){var d=document.documentElement;var allowed={mist:1,ink:1,sage:1,rose:1,midnight:1,papermod:1,ananke:1,terminal:1,solarized:1,dracula:1,nord:1,gruvbox:1,tokyo:1,catppuccin:1};var dark={ink:1,midnight:1,terminal:1,dracula:1,nord:1,gruvbox:1,tokyo:1,catppuccin:1};var t="mist";try{t=localStorage.getItem("pi-theme")||t}catch(e){}if(t==="light")t="mist";if(t==="dark")t="ink";if(!allowed[t])t="mist";d.dataset.theme=t;if(dark[t])d.classList.add("dark");else d.classList.remove("dark");var ui="fluid";try{var storedUi=localStorage.getItem("pi-ui-mode");if(storedUi==="classic"||storedUi==="fluid")ui=storedUi}catch(e){}d.dataset.ui=ui})();`,
          }}
        />
      </head>
      <body style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
        {children}
      </body>
    </html>
  );
}
