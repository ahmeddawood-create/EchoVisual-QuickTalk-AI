---
name: design-taste-frontend
description: Autonomous anti-slop frontend engineering instruction file for Qoder IDE agent. Targets landing pages, modern marketing sites, creative portfolios, and frontend overhauls. Ensures direct code output with production layout discipline, proper design tokens, zero AI clichés, and zero em-dashes.
---

# Qoder AI Agent Rulebook: Anti-Slop Frontend Engineering & UI/UX

> Applied to: Landing pages, portfolios, marketing surfaces, and redesigns.
> Purpose: Generate high-tier, non-templated frontend code without default AI artifacts.
> Format: Autonomous, rule-bound execution. Read the request, set dials, output strict production-ready code.

---

## 0. AGENT EXECUTION PROTOCOL (Read Before Generating)

### 0.A Direct Extraction Signals
1. **Target Archetype:** SaaS landing, designer portfolio, dev showcase, agency showcase, or editorial landing.
2. **Aesthetic Keywords:** "minimalist", "Linear-style", "kinetic", "editorial", "dark tech", "luxury/restrained".
3. **Audience Demands:** Enterprise procurement, design-focused consumer, or hiring manager.
4. **Hard Directives:** If the prompt gives explicit colors or components, lock those in immediately.

### 0.B The Mandatory One-Line Declaration
Before outputting any component or layout code, output exactly one line:
`Reading this as: <page kind> for <audience>, with a <vibe> language, leaning toward <design system or aesthetic family>. Dials: VARIANCE: X | MOTION: Y | DENSITY: Z`

---

## 1. THE THREE CONFIGURATION DIALS

Calibrate layout, animation, and spacing using three explicit metrics (1 to 10 scale):

* **`DESIGN_VARIANCE`:** 1 = Symmetric enterprise grid, 10 = Asymmetric masonry/experimental layout.
* **`MOTION_INTENSITY`:** 1 = Zero animations (CSS hover only), 10 = Physics-based springs and scroll hijacks.
* **`VISUAL_DENSITY`:** 1 = Generous gallery spacing (`py-32`), 10 = Tight data layout (`py-8`, monospace numbers).

### Calibration Presets
* **B2B SaaS / Developer Tool:** `VARIANCE: 6` | `MOTION: 4` | `DENSITY: 5`
* **Design Studio / Agency:** `VARIANCE: 9` | `MOTION: 8` | `DENSITY: 3`
* **Modern Portfolio:** `VARIANCE: 8` | `MOTION: 6` | `DENSITY: 3`
* **Premium Consumer / DTC:** `VARIANCE: 7` | `MOTION: 5` | `DENSITY: 3`
* **Editorial / Publication:** `VARIANCE: 6` | `MOTION: 3` | `DENSITY: 2`

---

## 2. STACK ARCHITECTURE & PATTERNS

### 2.A Core Framework & Styling Defaults
* **Framework:** Next.js (App Router, React Server Components by default).
* **Interactive Leaves:** Any component importing Motion, GSAP, or browser hooks (`useScroll`, `useMotionValue`) must have `'use client'` at the absolute top.
* **Styling:** Tailwind CSS v4 utilities.
* **Animations:** `motion/react` (the official modular Motion package). For scroll pins/stacks, GSAP + ScrollTrigger with clean `gsap.context()` teardowns.
* **Typography:** `next/font/google` or self-hosted variable fonts. Always set `font-display: swap`.

### 2.B Component & Icon Systems
* **Icons:** `@phosphor-icons/react` (preferred), `hugeicons-react`, or `@radix-ui/react-icons`.
  * Standardize `strokeWidth` across the whole project (e.g., `1.5`).
  * Never hand-roll decorative SVG icon paths.
  * Do not mix icon sets in the same build.
* **Primitives:** Radix UI primitives or customized `shadcn/ui` tokens. Never ship default raw shadcn styles uncustomized.

### 2.C Continuous Values Rule
* **Never use `useState` for continuous stream events** (pointer movement, scroll offsets, magnetic pulls). Use `useMotionValue` and `useTransform` from `motion/react` to prevent React render-cycle thrashing.

---

## 3. UI/UX DESIGN DIRECTIVES & HARD CONSTRAINTS

### 3.1 Strict Prohibition on Em-Dashes (Rule 0)
* **Zero `—` or `–` characters anywhere.**
* Never use em-dashes or en-dashes in headlines, subheads, bullet lists, button labels, quotes, attributions, or meta text.
* Permitted dash: standard hyphen `-` strictly for compound words or ranges (`2024-2026`).

### 3.2 Typography Rules
* **No Default Inter:** Use modern sans families: `Geist`, `Cabinet Grotesk`, `Satoshi`, `Outfit`, or `PP Neue Montreal`.
* **Serif Guardrail:** Do not use serifs unless explicitly asked for luxury heritage or literary publications. `Fraunces` and `Instrument Serif` are prohibited as defaults.
* **Headline Discipline:**
  * Hero H1 max 2 lines on desktop. Default size: `text-4xl md:text-5xl lg:text-6xl tracking-tight`.
  * Hero subtext max 20 words and max 3 lines.
  * Italic descender clearance: add `leading-[1.1]` and `pb-1` when using italicized words containing letters `g, j, p, q, y`.

### 3.3 Color & Palette Restraints
* **One Accent Color:** Choose exactly one primary accent color (e.g., Electric Cobalt, Deep Emerald, Burnt Amber, or Crimson) and keep it uniform throughout every section.
* **No AI Lila/Purple Gradients:** Do not add purple/cyan glows or mesh blobs under hero text.
* **No Warm Paper/Clay Cliché:** For consumer and portfolio builds, avoid the cliché warm-bone background (`#fbf8f1`) and brass accents (`#b08947`). Lean toward clean monochromatic high-contrast bases or cool slate neutrals.

### 3.4 Layout Mechanics & Viewports
* **Viewport Stability:** Never use `h-screen` on mobile entry sections. Always use `min-h-[100dvh]` to eliminate mobile address-bar shifts.
* **Hero Top Padding Cap:** Hero section top padding must not exceed `pt-24` on desktop.
* **Single-Line Desktop Navigation:** Desktop navbar height must remain between `64px` and `80px` and items must fit on one line.
* **Eyebrow Rationing:** Maximum 1 uppercase tracking eyebrow tag per 3 sections.
* **No Three Equal Cards:** Replace generic 3-card horizontal rows with asymmetric bentos, split feature rows, or interactive vertical tabs.
* **Bento Grids:** Bento cells must match the exact count of items. Avoid white-on-white text blocks; include visual assets, tinted panels, or functional interactive controls.

### 3.5 Button & CTA Mechanics
* **CTA Button Wrap Ban:** Button text must never wrap to multiple lines on desktop. Keep primary CTA copy concise (1 to 3 words).
* **Single CTA Intent:** Do not mix synonymous CTAs on the same page (e.g., avoid showing "Get Started", "Sign Up Now", and "Start Free" in different sections). Pick one label and stick with it.
* **Contrast Verification:** Maintain WCAG AA compliance (4.5:1 minimum) on all buttons, forms, and placeholders.

---

## 4. CODE IMPLEMENTATION SKELETONS

### 4.A GSAP Sticky Card Stack (`StickyStack.tsx`)

```tsx
"use client";

import { useRef, useEffect } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useReducedMotion } from "motion/react";

gsap.registerPlugin(ScrollTrigger);

interface StickyStackProps {
  cards: React.ReactNode[];
}

export function StickyStack({ cards }: StickyStackProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (shouldReduceMotion || !containerRef.current) return;

    const ctx = gsap.context(() => {
      const cardElements = gsap.utils.toArray<HTMLElement>(".stack-card");
      
      cardElements.forEach((card, index) => {
        if (index === cardElements.length - 1) return;

        ScrollTrigger.create({
          trigger: card,
          start: "top top",
          endTrigger: cardElements[cardElements.length - 1],
          end: "top top",
          pin: true,
          pinSpacing: false,
        });

        gsap.to(card, {
          scale: 0.94,
          opacity: 0.6,
          ease: "none",
          scrollTrigger: {
            trigger: cardElements[index + 1],
            start: "top bottom",
            end: "top top",
            scrub: true,
          },
        });
      });
    }, containerRef);

    return () => ctx.revert();
  }, [shouldReduceMotion]);

  return (
    <div ref={containerRef} className="relative w-full">
      {cards.map((cardContent, idx) => (
        <div
          key={idx}
          className="stack-card sticky top-0 min-h-[100dvh] flex items-center justify-center p-6"
        >
          <div className="w-full max-w-5xl rounded-2xl bg-zinc-900 border border-zinc-800 p-8 shadow-2xl">
            {cardContent}
          </div>
        </div>
      ))}
    </div>
  );
}