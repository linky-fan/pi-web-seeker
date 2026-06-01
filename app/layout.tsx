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
            __html: `(function(){try{var allowed={mist:1,ink:1,sage:1,rose:1,midnight:1};var t=localStorage.getItem("pi-theme");if(t==="light")t="mist";if(t==="dark")t="ink";if(!allowed[t])t="mist";document.documentElement.dataset.theme=t;if(t==="ink"||t==="midnight")document.documentElement.classList.add("dark")}catch(e){}})();`,
          }}
        />
      </head>
      <body style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
        {children}
      </body>
    </html>
  );
}
