import type { Metadata } from "next";
import { Barlow_Condensed, Passion_One, Yellowtail } from "next/font/google";
import "./globals.css";

// Stand-ins for the fonts the series is known for. If Pricedown is installed on
// this machine, globals.css picks it up ahead of Passion One for the display face.
const display = Passion_One({ variable: "--font-passion", weight: ["400", "700", "900"], subsets: ["latin"] });
const ui = Barlow_Condensed({ variable: "--font-barlow", weight: ["400", "500", "600", "700"], subsets: ["latin"] });
const script = Yellowtail({ variable: "--font-yellowtail", weight: "400", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "GTA VI Launch Monitor",
  description: "Who is streaming Grand Theft Auto VI right now on Twitch, Kick and YouTube.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${script.variable}`}>
      <body>{children}</body>
    </html>
  );
}
