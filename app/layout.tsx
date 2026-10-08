import type { Metadata } from "next";
import { Saira, Saira_Condensed } from "next/font/google";
import "./globals.css";

const saira = Saira({
  variable: "--font-saira",
  subsets: ["latin"],
});

// Broadcast-style condensed face for headings, scores and stats.
const sairaCondensed = Saira_Condensed({
  variable: "--font-saira-condensed",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "Prime Time Lineup Advisor",
  description: "Weekly start/sit, drop and waiver-wire recommendations for your Sleeper fantasy football team.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${saira.variable} ${sairaCondensed.variable} h-full antialiased`}
    >
      <head>
        {/* Apply the saved (or system) theme before first paint to avoid a flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
