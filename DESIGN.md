---
name: English Coach
description: A calm, private rehearsal space for local spoken-English practice.
colors:
  canvas-mist: "#f4f7fb"
  shell-frost: "#f8fafe"
  chrome-white: "#fbfcfe"
  stage-white: "#ffffff"
  deep-navy-ink: "#132238"
  masthead-ink: "#0c1d35"
  subtitle-ink: "#30415a"
  muted-slate: "#617087"
  cool-rule: "#d8e0eb"
  frame-blue-gray: "#aec0d8"
  signal-blue: "#1769e0"
  signal-blue-ink: "#1559bc"
  disabled-control: "#e9eef5"
  disabled-ink: "#647187"
  runtime-ready: "#277557"
  runtime-error: "#a5363f"
  runtime-error-ink: "#7f3138"
  runtime-error-surface: "#fff8f8"
typography:
  display:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif'
    fontSize: "clamp(1.12rem, 2.5vw, 1.48rem)"
    fontWeight: 680
    letterSpacing: "-0.025em"
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif'
    fontSize: "clamp(1.05rem, 2.2vw, 1.32rem)"
    fontWeight: 520
    lineHeight: 1.4
    letterSpacing: "-0.018em"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif'
    fontSize: "1.08rem"
    fontWeight: 680
    letterSpacing: "-0.02em"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif'
    fontSize: "0.9rem"
    fontWeight: 560
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif'
    fontSize: "0.82rem"
    fontWeight: 650
  hint:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif'
    fontSize: "0.85rem"
    fontWeight: 470
  micro:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif'
    fontSize: "0.76rem"
rounded:
  status-mark: "2px"
  detail: "8px"
  control: "12px"
  pill: "999px"
  circle: "50%"
spacing:
  control-gap: "0.28rem"
  inline-gap: "0.5rem"
  strip-block: "0.75rem"
  section-gap: "1.15rem"
  control-inline: "1.5rem"
  stage-copy: "2rem"
  shell-inline: "clamp(1.25rem, 3vw, 2.5rem)"
components:
  local-status:
    backgroundColor: "#f7faff"
    textColor: "{colors.signal-blue-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.36rem 0.7rem"
  conversation-stage:
    backgroundColor: "{colors.stage-white}"
    textColor: "{colors.subtitle-ink}"
    typography: "{typography.headline}"
    padding: "{spacing.stage-copy}"
  talk-control-disabled:
    backgroundColor: "{colors.disabled-control}"
    textColor: "{colors.disabled-ink}"
    typography: "{typography.display}"
    rounded: "{rounded.control}"
    padding: "1rem 1.5rem"
  system-strip:
    backgroundColor: "{colors.chrome-white}"
    textColor: "{colors.deep-navy-ink}"
    typography: "{typography.body}"
    padding: "0.75rem clamp(1.25rem, 3vw, 2.5rem)"
  error-detail:
    backgroundColor: "{colors.runtime-error-surface}"
    textColor: "{colors.runtime-error-ink}"
    typography: "{typography.micro}"
    rounded: "{rounded.detail}"
    padding: "0.65rem 0.75rem"
---

# Design System: English Coach

## Overview

**Creative North Star: "Subtitled rehearsal"**

English Coach should feel like a quiet place to rehearse a spoken line: cool, private, attentive, and free of generic chat-product spectacle. The visual system borrows the restraint of a subtitle-safe frame—deep ink, pale fields, precise notation, and generous calm—while keeping the product's local runtime state legible.

Conversation remains visually primary and coaching remains secondary. Native macOS typography, thin rules, and a small signal-blue vocabulary make the interface feel direct rather than branded for its own sake; semantic green and red appear only when runtime health requires them.

**Key Characteristics:**

- Cool white and blue-gray tonal layering.
- Deep navy text with sparing signal-blue notation.
- Subtitle-like centered conversational copy.
- Thin rules and frame marks instead of nested cards.
- Calm, explicit runtime feedback with reduced-motion support.

## Colors

The palette is a restrained cool-neutral field: signal blue identifies local product state, while green and red are reserved for runtime health.

### Primary

- **Signal Blue:** The sole brand accent, used for the local identity dot and system label.
- **Signal Blue Ink:** A slightly deeper companion for small blue text on pale surfaces.

### Tertiary

- **Runtime Ready:** Confirms healthy native state; do not use it decoratively.
- **Runtime Error:** Marks unavailable native state and error indicators.
- **Runtime Error Ink:** Carries readable error copy and disclosure labels.
- **Runtime Error Surface:** Provides the quietest possible warm backdrop for technical detail.

### Neutral

- **Canvas Mist:** The browser and window theme field behind the interface.
- **Shell Frost:** The cool outer application field.
- **Chrome White:** The subtly tinted header and diagnostics surface.
- **Stage White:** The clearest field, reserved for conversation content.
- **Deep Navy Ink:** Default high-contrast text.
- **Masthead Ink:** The darkest title treatment.
- **Subtitle Ink:** Softer primary copy for the conversation stage.
- **Muted Slate:** Secondary diagnostics and metadata.
- **Cool Rule:** The standard one-pixel region divider.
- **Frame Blue-Gray:** The quieter notation color for stage corner and center marks.
- **Disabled Control / Disabled Ink:** A paired neutral state that remains readable without pretending the action is available.

### Named Rules

**The Signal, Not Decoration Rule.** Blue identifies local product structure; green and red report runtime truth. None of the three colors is ambient decoration.

**The Clearest Field Rule.** Conversation content gets the cleanest white surface so it remains visually primary.

## Typography

**Display Font:** Native system sans (`-apple-system`, with SF Pro Text, Helvetica Neue, Arial, and sans-serif fallbacks)  
**Body Font:** The same native system stack  
**Label/Mono Font:** Labels inherit the system stack; technical code inherits the platform monospace default

**Character:** Compact native typography keeps the desktop shell familiar and low-friction. Slightly negative tracking gives large labels and centered dialogue copy the composure of subtitles without turning the interface editorial.

### Hierarchy

- **Display:** Semibold, fluid, tightly tracked type for the main talk-control label.
- **Headline:** Medium-weight, fluid, balanced type for the centered conversation-stage message.
- **Title:** Compact semibold type for the product masthead.
- **Body:** Firm, small text for the current runtime message.
- **Label:** Compact semibold text for chips and diagnostics labels; the diagnostics heading may rise to a stronger weight.
- **Hint:** Lighter secondary text for an action's explanatory line.
- **Micro:** Small metadata and error-supporting copy; keep it subordinate but readable.

### Named Rules

**The Native Voice Rule.** Use the platform sans stack throughout; hierarchy comes from scale, weight, and placement rather than decorative font switching.

**The Subtitle Restraint Rule.** Reserve centered, balanced, slightly tightened copy for the conversational voice—not for every piece of interface chrome.

## Layout

Use a full-window grid with flexible content regions and compact fixed chrome. Spacing is fluid at the window edges and measured inside controls; major regions are separated by one-pixel rules rather than card stacks. The current shell's exact region sequence and proportions are surface-specific and remain documented in `.impeccable/surfaces/src-app-tsx.md`.

At compact width or height, reduce chrome height, control padding, and frame-mark size while preserving information order. The shipped compact thresholds are `700px` width or `520px` height; at `560px` width, header and error-detail placement tighten again. Support windows down to `320px` wide without horizontal scrolling.

**The Stable Topology Rule.** Responsive changes compress and wrap; they do not reorder the learner's task or hide runtime truth.

## Elevation & Depth

The system is flat by default. White and blue-gray surface shifts, thin rules, and sparse markers establish hierarchy; decorative elevation is absent. A low ambient shadow appears only beneath the broad disabled control, while the technical-error detail uses a slightly warmer ambient shadow to separate temporary disclosure content from the strip below it.

### Shadow Vocabulary

- **Disabled Control Ambient** (`0 8px 22px rgb(35 57 84 / 7%)`): A modest lift for the large control surface, even while inactive.
- **Error Detail Ambient** (`0 8px 22px rgb(67 27 31 / 10%)`): A localized warm shadow for open technical details.

### Named Rules

**The Flat-by-Default Rule.** Region boundaries come from tone and one-pixel rules. Shadows belong only to a control or temporary disclosure that must separate from its immediate surface.

## Shapes

Geometry is mostly square and ruled. The primary control uses a modestly rounded rectangle; small disclosure surfaces use a tighter curve, status chips use a full pill, and status indicators use circles except for the squared error mark. Conversation framing is made from open one-pixel corner and center marks rather than a closed container border.

**The Open Frame Rule.** Use sparse corner or center notation when a quiet area needs definition; avoid enclosing important content in another card by default.

## Components

### Local Status Chip

- **Character:** Compact, reassuring local-identity notation rather than a promotional badge.
- **Shape:** Full pill with a small circular signal-blue dot.
- **Color:** Signal Blue Ink on a nearly white blue surface with a cool blue-gray border.
- **Behavior:** Informational and noninteractive; never style it like a clickable button.

### Conversation Stage

- **Character:** The calmest, clearest content field in the product.
- **Surface:** Stage White with centered Subtitle Ink copy.
- **Framing:** Six sparse Frame Blue-Gray corner and center marks; no closed border or shadow.
- **Type:** Balanced headline copy with a readable maximum measure.

### Talk Control

- **Character:** Broad, tactile, and unmistakable even when unavailable.
- **Shape:** Gently rounded control using the system's control radius.
- **Disabled:** Disabled Control surface, Disabled Ink label, cool border, and full opacity; pair the primary label with a lighter hint.
- **Depth:** Use only the Disabled Control Ambient shadow documented above.

### System Diagnostics

- **Character:** A compact runtime ledger that explains native state without competing with conversation.
- **Structure:** Signal-blue section label, a one-pixel divider, state mark, concise message, and optional trailing metadata or recovery detail.
- **Checking:** Outlined circular indicator with a single rotating gap; stop animation under reduced-motion preferences.
- **Ready:** Filled circular Runtime Ready indicator.
- **Error:** Filled squared Runtime Error indicator with direct recovery guidance and an optional technical-details disclosure.

### Error Detail

- **Character:** Specific and inspectable, but visually subordinate to recovery guidance.
- **Shape:** Tightly rounded disclosure panel with a pale warm surface and warm border.
- **Behavior:** Position near its summary, constrain its width to the window, and allow wrapping for technical content.

## Do's and Don'ts

### Do:

- **Do** keep conversation on the clearest surface and runtime coaching or diagnostics in subordinate chrome.
- **Do** use thin cool-gray rules, restrained blue notation, and native system typography to establish hierarchy.
- **Do** preserve visible checking, ready, and error states, including a nonanimated reduced-motion fallback.
- **Do** compress spacing and wrap secondary diagnostics in compact windows without changing task order.

### Don't:

- **Don't** introduce generic chat bubbles, AI gradients, glowing assistant effects, or ornamental brand imagery.
- **Don't** use semantic green or red outside runtime health and recovery states.
- **Don't** turn each region into a floating rounded card; tonal fields and rules are the default structure.
- **Don't** promote the current surface's row composition into a system-wide template; keep surface composition in its surface brief.
