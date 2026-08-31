---
name: Pako
description: A warm, ink-on-parchment desktop coach for private spoken and written English practice.
colors:
  parchment: "#faf8f5"
  ink: "#27251e"
  soft-paper: "#fdfbfa"
  deep-teal: "#016a71"
  greige: "#efece4"
  warm-fog: "#f3efe8"
  graphite: "#66625b"
  ash: "#7d7c76"
  warm-mist: "#d1d1cd"
  lilac-wash: "#f7f1ff"
  destructive: "#a5363f"
  success: "#3f6b52"
  warning: "#8a5a12"
typography:
  caption:
    fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
    fontSize: "10px"
    lineHeight: 1.25
    letterSpacing: "0.5px"
  body:
    fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: 1.5
  bodyLarge:
    fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    lineHeight: 1.5
  subheading:
    fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    lineHeight: 1.38
  heading:
    fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
    fontSize: "36px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.9px"
  display:
    fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
    fontSize: "56px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-2.8px"
rounded:
  buttons: "6px"
  inputs: "12px"
  cards: "16px"
  chips: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.deep-teal}"
    textColor: "{colors.parchment}"
    typography: "{typography.body}"
    rounded: "{rounded.buttons}"
    padding: "6px 15px"
  button-primary-hover:
    backgroundColor: "{colors.deep-teal}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.buttons}"
  badge-default:
    backgroundColor: "{colors.deep-teal}"
    textColor: "{colors.parchment}"
    rounded: "{rounded.chips}"
    padding: "2px 8px"
  composer-input-group:
    backgroundColor: "{colors.parchment}"
    textColor: "{colors.ink}"
    rounded: "{rounded.inputs}"
---

# Design System: Pako

## Overview

**Creative North Star: "Ink on parchment, one live signal"**

Pako is a private, local-first desktop coach: a warm parchment canvas and near-black ink carry the entire reading and writing surface, and exactly one saturated color — a deep teal — marks every place the learner can act. Before this pass, that teal lived only in the sidebar's active-item highlight; every button, badge, and focus ring elsewhere rendered in plain ink-on-parchment, which read as flat and colorless even though the underlying "paper" identity was intentional. The fix was not a new palette — it was finishing the one this system already committed to: let the single existing brand accent do its job everywhere an action lives, and give muted surfaces enough tonal separation to read as a layer rather than a void.

Structurally, Pako is an Operate-mode desktop shell: a persistent sidebar (Conversation, Sessions, Assessment, History, Progress, Pronunciation, Storage, Settings) built on shadcn/ui's `base-nova` primitives over Tailwind v4, hairline borders instead of shadows, and a chat composer (`InputGroup` + textarea + toolbar) that is the product's center of gravity.

**Key Characteristics:**

- Warm parchment canvas and soft-paper cards; ink text at full strength, graphite and ash for secondary tiers.
- One chromatic commitment — Deep Teal — now consistent across the sidebar's active state, every primary button, badges, links, and focus rings.
- Flat, ruled surfaces: 1px warm-mist borders instead of drop shadows; a full-pill radius for chips/badges, 12px for inputs, 16px for cards.
- Status color (destructive/success/warning) stays desaturated enough to sit inside the ink-on-parchment family rather than competing with the teal signal.

## Colors

A near-monochrome warm neutral field with a single deliberate chromatic accent; status colors are muted so they read as information, not decoration.

### Primary
- **Deep Teal** (`#016a71`): The system's one chromatic commitment. Fills every primary button and default badge, tints focus rings (`~40%` alpha), and marks the sidebar's active nav item — the same value in all four roles so "this is the actionable thing" reads as one consistent signal across the app. Previously confined to the sidebar alone, leaving every other primary action (the composer's send button, "New session," Settings' save actions) rendered in plain ink — indistinguishable from static text. **This was the core fix for the "looks too gray" complaint.**

### Neutral
- **Parchment** (`#faf8f5`): Page canvas. Warm, not stark white — the system's tactile-paper base.
- **Soft Paper** (`#fdfbfa`): Card and popover surfaces, barely lighter than the canvas.
- **Ink** (`#27251e`): Primary text and the sidebar's own primary/foreground pairing. 14.5:1 on parchment — no contrast concern.
- **Graphite** (`#66625b`): Secondary/muted text. Darkened from `#72706b` in this pass — the prior value cleared only 4.67:1 against the canvas and would have failed once `--muted` stopped being identical to `--background`; it now holds 5.7:1 on canvas and 5.3:1 on the new muted surface.
- **Ash** (`#7d7c76`): The quietest text tier (meta/helper copy, currently unused by any shipped component). Darkened from `#92918b`, which cleared only 2.98:1 on the canvas — failing WCAG AA even for large text.
- **Warm Fog** (`#f3efe8`): `--muted` surface. Previously identical to the page background (`#faf8f5`), so muted panels had zero visual separation from the canvas; now a genuine, if deliberately subtle, tonal step down, matching this system's flat/ruled character rather than introducing a shadow.
- **Greige** (`#efece4`): `--secondary` surface. Replaced a plain cool `#ececec` that broke the otherwise warm-tinted neutral family.
- **Warm Mist** (`#d1d1cd`): The standard 1px border/divider.
- **Lilac Wash** (`#f7f1ff`): Menu/dropdown-item hover highlight (shadcn's built-in `accent` role) — a real, load-bearing surface, not decorative color.

### Tertiary
- **Destructive** (`#a5363f`), **Success** (`#3f6b52`), **Warning** (`#8a5a12`): Desaturated enough to sit inside the ink-on-parchment family; reserved for runtime/status meaning, never used decoratively.

### Named Rules

**The One Signal Rule.** Deep Teal is the only chromatic color used for interactive/actionable elements anywhere in the app. If a second saturated color starts appearing on buttons, links, or badges, that's drift — route new "brand" color needs back through this single value rather than adding a second accent.

**The Muted-Isn't-Background Rule.** `--muted` must always read as a visibly distinct step from `--background`, even subtly. Reintroducing an identical value (as shipped before this pass) silently erases surface hierarchy everywhere `bg-muted` is used.

## Typography

**Body Font:** Inter Variable (system sans fallback stack)

**Character:** A single grotesque sans carries the whole system; hierarchy comes from size, weight, and color tier, not font-switching. Display sizes carry aggressive negative tracking (-2.8px at 56px) to keep large numerals/headings feeling compact rather than airy.

### Hierarchy
- **Display** (600, 56px, -2.8px tracking): reserved for rare large numerals/stats.
- **Heading** (600, 36px, -0.9px tracking): page/section titles.
- **Subheading** (400, 20px): sub-section titles.
- **Body-lg / Body** (400, 16px / 14px): primary reading and UI copy.
- **Caption** (400, 10px, +0.5px tracking): metadata, timestamps, chip labels.

## Layout

Full-window sidebar shell (`SidebarProvider`/`SidebarInset`) with a fixed top bar and a scrollable content region per page. The chat composer is a fixed-height bar pinned under the conversation log, not a floating overlay. Comfortable density; base spacing unit 4px.

## Elevation & Depth

Flat by default. Region and surface separation come from the parchment → soft-paper → warm-fog tonal steps and 1px warm-mist borders, not shadows. No component in the current implementation uses `box-shadow` for structural elevation.

**The Flat-by-Default Rule.** Reach for a tonal surface step or a hairline border before reaching for a shadow.

## Shapes

- **Buttons:** 6px radius.
- **Inputs / composer bar:** 12px radius.
- **Cards:** 16px radius.
- **Chips / badges:** full pill (9999px) — a deliberate, confirmed reversal of an earlier "never pill" convention.

## Components

### Buttons
- **Primary** (`variant="default"`): Deep Teal fill, parchment text, 6px radius. `hover:bg-primary/80` lightens toward teal, not gray.
- **Outline / Ghost / Secondary:** transparent or greige fill, ink text — reserved for lower-commitment actions; Deep Teal never appears on more than one button per view unless they're duplicate instances of the same primary action.
- **Destructive:** desaturated red at 10% fill, full-strength red text.

### Chat Composer
- **Character:** The product's center of gravity — a single bordered `InputGroup` bar (textarea on top, a toolbar row below holding the model picker, mic toggle, and send button).
- **Send button:** Deep Teal fill (primary), full-pill icon button.
- **Mic button:** icon-only, click-to-toggle; idle state is a plain ghost icon (no fill), recording state uses the desaturated destructive red with a pulse, matching the system's existing status-color vocabulary rather than introducing a new "recording" hue.
- **Model picker:** dropdown trigger styled as a ghost toolbar button; the active model gets a check mark, not a color change — selection state here is communicated by icon, not hue, since Deep Teal is reserved for primary actions.

### Badges
- **Default:** Deep Teal fill (mirrors primary buttons — a badge with `variant="default"` reads as "this is notable/primary," not merely decorative).
- **Outline:** the neutral default for informational tags (repair priority, "Typed" origin marker) — border-only, ink text, no color.

## Do's and Don'ts

### Do:
- **Do** reserve Deep Teal for actionable elements (primary buttons, links, badges marked `default`, the sidebar's active state, focus rings) — never for decoration or illustration.
- **Do** keep `--muted` and `--secondary` visibly distinct from `--background`, even if subtly, so flat/ruled surfaces still read as layered.
- **Do** use warm-tinted neutrals (graphite, ash, warm mist) throughout; a cool/pure gray anywhere in this system reads as an inconsistency against the parchment family.

### Don't:
- **Don't** introduce a second saturated brand color; status colors (destructive/success/warning) stay desaturated and reserved for runtime meaning.
- **Don't** add shadows for structural elevation — use the parchment → soft-paper → warm-fog tonal steps and hairline borders instead.
- **Don't** let `--muted-foreground` or `--ash-foreground` drift below 4.5:1 / 3:1 contrast respectively against the surfaces they're actually used on — both were previously failing and were corrected in this pass; re-verify contrast whenever either token or its paired surface changes.
