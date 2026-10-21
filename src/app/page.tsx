import { Faq } from "@/components/sections/Faq";
import { FinalCta } from "@/components/sections/FinalCta";
import { Hero } from "@/components/sections/Hero";
import { Process } from "@/components/sections/Process";
import { Service } from "@/components/sections/Service";
import { Trust } from "@/components/sections/Trust";

export default function Home() {
  return (
    <main id="main" tabIndex={-1} className="outline-none">
      <Hero />
      <Service />
      <Process />
      <Trust />
      <Faq />
      <FinalCta />
    </main>
  );
}
