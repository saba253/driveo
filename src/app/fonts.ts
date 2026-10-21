import { Manrope, Noto_Sans_Georgian } from "next/font/google";

/** Latin text, numerals and the brand wordmark. */
export const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

/** Georgian UI text. Only the Georgian subset is loaded; Latin comes from Manrope. */
export const notoGeorgian = Noto_Sans_Georgian({
  subsets: ["georgian"],
  variable: "--font-noto-georgian",
  display: "swap",
});
