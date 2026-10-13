import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Noto_Sans_Devanagari } from "next/font/google";
import localFont from "next/font/local";

import { Providers } from "@/components/providers";

import "./globals.css";

/** Open Runde (SIL OFL 1.1), self-hosted from /public/fonts. */
const runde = localFont({
  src: [
    { path: "../../public/fonts/open-runde-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/open-runde-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../../public/fonts/open-runde-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../../public/fonts/open-runde-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-runde",
  display: "swap",
  fallback: ["ui-rounded", "system-ui", "sans-serif"],
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
  preload: false,
});

const deva = Noto_Sans_Devanagari({
  weight: ["500", "600"],
  subsets: ["devanagari"],
  variable: "--font-deva-src",
  display: "swap",
  preload: false,
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Pratibimb — a digital twin for Type 2 Diabetes",
    template: "%s · Pratibimb",
  },
  description:
    "A hybrid physiological + machine-learning digital twin of a person with Type 2 Diabetes. It forecasts glucose four hours ahead, warns of hyper- and hypoglycaemia before they happen, and lets a clinician test Indian meals and routines on the virtual patient. Synthetic data; not a medical device.",
  applicationName: "Pratibimb",
  authors: [{ name: "Yashvardhan Thanvi" }, { name: "Devesh Jain" }],
  openGraph: {
    type: "website",
    siteName: "Pratibimb",
    title: "Pratibimb — a living reflection of a person with diabetes",
    description: "It sees the spike two hours before it happens. A hybrid physiological + ML digital twin for Type 2 Diabetes.",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f8f8" },
    { media: "(prefers-color-scheme: dark)", color: "#121110" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${runde.variable} ${mono.variable} ${deva.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
