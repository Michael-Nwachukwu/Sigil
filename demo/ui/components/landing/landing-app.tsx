"use client";

import { NavBar, useThemeState, type NavLink } from "../shared/primitives";
import { HowItWorks, LandingHero, ThreeProblems } from "./landing-1";
import { DualWalletSection, SDKSection } from "./landing-2";
import { LandingFooter, SkillMdSection } from "./landing-3";

const navLinks: NavLink[] = [
  ["Primitives", "#primitives"],
  ["How it works", "#how"],
  ["Docs", "/docs"],
  ["Resolve", "/passport"],
];

export function LandingApp() {
  const { theme, setTheme } = useThemeState();

  return (
    <>
      <NavBar links={navLinks} theme={theme} setTheme={setTheme} cta={{ href: "/docs", label: "Documentation" }} />
      <main style={{ paddingTop: 56 }}>
        <LandingHero />
        <div id="primitives">
          <ThreeProblems />
        </div>
        <div id="how">
          <HowItWorks />
        </div>
        <DualWalletSection />
        <SDKSection />
        <SkillMdSection />
      </main>
      <LandingFooter />
    </>
  );
}
