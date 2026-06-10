# AXIOM OS — Design System
**Version**: v1.0 · Diaspora Platform · 2950 CE  
**Source**: Transcribed from [axiom-design-system.html](file:///d:/Michael/Dev/diaspora-platform/axiom-design-system.html)

---

## 📖 Glossary of Technical Terms
Here are plain-English explanations of the technical terms used in this design system:
* **HEX Code**: A 6-character code starting with `#` (like `#46F5E0`) that represents a specific color on screens.
* **CSS Variable**: A reusable design setting (like `--color-primary`) that lets developers change a style in one place and have it update everywhere.
* **WCAG (Web Content Accessibility Guidelines)**: A set of international standards for making websites accessible to people with disabilities. Ratings go from Single-A (lowest) to Triple-A (highest).
* **Contrast Ratio**: A measurement of how much a text color stands out against its background color. A ratio of 4.5:1 or higher is generally needed for readability.
* **Hit Area / Touch Target**: The physical area on a screen (measured in pixels) that you can tap or click. Larger hit areas are easier for people with limited mobility to press.
* **ARIA (Accessible Rich Internet Applications)**: Standard code labels added to HTML tags to help screen readers (used by visually impaired users) understand custom buttons, checkboxes, and tabs.
* **Easing Curve (or cubic-bezier)**: A mathematical formula that controls how an animation speeds up or slows down, making movement feel smooth and natural instead of mechanical.
* **Media Query**: A styling rule that detects a user's device settings—such as whether they have small mobile screens, or if they have turned on "Reduce Motion" in their operating system settings.
* **Scanline Overlay**: Repeating horizontal lines on a screen, resembling old computer terminal screens. Used here to give the app a historic "sci-fi archive" aesthetic.

---

## 01 — Design Philosophy & Tone

The interface language of the Stellarhold: Diaspora archive platform communicates cosmic scale through restraint. The system speaks in teal light against near-void backgrounds—a signal from deep, ancient infrastructure.

### Core Principles
1. **Terminal Precision**: All text is uppercase and tracked wide. Borders are sharp with **zero radius** (`border-radius: 0`) throughout. Information is treated as data, not decoration.
2. **Void Depth**: Backgrounds approach absolute dark (`#05070F`). Surfaces emerge in incremental luminance steps, creating depth without color.
3. **Signal Clarity**: The primary teal (`#46F5E0` / `#4cd7f6`) is the only saturated color in the system. It marks interactive elements and live data.
4. **Persistent Memory**: The system implies age through scanline overlays, grain textures, and compressed type. This is an archive, not a consumer product.
5. **Earned Access**: Tier badges, locked states, and access gates are first-class UI patterns. Information density scales with clearance level.
6. **Minimal Motion**: Transitions are fast (150–300ms) and purposeful. Micro-animations reinforce system state, not aesthetics. The scan beam is the only ambient loop.

---

## 02 — Core Tokens at a Glance

| Token | Value / Setting | Description |
|---|---|---|
| **Background Color** | `#05070F` | Deep dark space background |
| **Primary Accent Color** | `#4cd7f6` | Glowing teal interactive signal |
| **Headline Font** | Space Grotesk | Loaded globally |
| **Border Radius** | `0px` | Strict sharp corners on all buttons and boxes |

---

## 03 — Color Palette

Built on Material Design 3 color roles adapted for a deep-space dark theme.

### Primary · Teal Signal
* **Primary**: `#46F5E0` — Core accent for active states.
* **Primary Alt**: `#4cd7f6` — Alternate bright teal.
* **Primary Fixed Dim**: `#17DECA` — Muted teal for lower-contrast signals.
* **Primary Container**: `#005048` — Deep teal background for alerts.
* **On Primary**: `#003731` — Dark text to use on top of primary colors.
* **Inverse Primary**: `#006a60` — High contrast alternative for light backgrounds.

### Secondary · Stellar Blue
* **Secondary**: `#7CCFFF` — Sky blue accent.
* **Secondary Fixed Dim**: `#5DB7E2` — Muted secondary blue.
* **On Secondary Container**: `#C1E8FF` — Light blue text on secondary container backgrounds.
* **Secondary Container**: `#004D6E` — Deep blue background container.
* **On Secondary**: `#00354D` — Dark text to use on top of secondary colors.

### Surface · Void Depth Scale
* **Background / Dim**: `#05070F` — Base page background.
* **Surface**: `#0A0E1A` — Primary layer background.
* **Surface Container**: `#0F172A` — Inner container panels.
* **Container High**: `#151B2B` — Moderately elevated backgrounds.
* **Container Highest**: `#1E2538` — Highest elevation background layer.
* **Card**: `#1b1f2c` — Base panel background.
* **Card Hover**: `#262a37` — Background when hover mouse over card.
* **Nav**: `#0f131f` — Background for menu bars.

### On Surface · Text Hierarchy
* **On Surface**: `#F8FAFC` — Primary high-contrast text.
* **Text Bright**: `#dfe2f3` — Elevated text readability.
* **On Surface Variant**: `#CBD5E1` — Body prose and general descriptions.
* **Outline**: `#94A3B8` — Muted labels and borders (meets contrast requirements).
* **Text Muted**: `#869397` — Secondary labels and captions.
* **Text Subtle**: `#3d494c` — Low priority metadata. **Do not use for standard text.**
* **Outline Variant**: `#1E2538` — Darker borders and dividers.

### Status · Error & Alert
* **Error**: `#FFB4AB` — Warning and hazard text.
* **Error Container**: `#93000a` — Background for severe errors.
* **On Error Container**: `#ffdad6` — Light text on error backgrounds.
* **On Error**: `#690005` — Dark text on error highlights.

### Tier System · Access Levels
Used for user badges, tags, and container accents:
* **Archivist**: `#94a3b8` (bg: `#262a37`) — Muted gray
* **Voyager**: `#7CCFFF` (bg: `#1e3a5f`) — Electric blue
* **Chronicler**: `#d4a843` (bg: `#3d2600`) — Warm gold
* **Canon Contributor**: `#46F5E0` (bg: `#0a2a1a`) — Glowing teal
* **Admin**: `#fca5a5` (bg: `#3d0000`) — Warning red
* **Featured**: `#fbbf24` (bg: `#422a00`) — Gold accent

---

## 04 — Typography Scale

Typography is split into two typefaces: **Space Grotesk** carries all UI chrome (labels, headings, buttons, stats), while **Manrope** carries prose and body copy.

| Style Role | Font Family | Size | Weight | Tracking & Case | Usage |
|---|---|---|---|---|---|
| **Display Large** | Space Grotesk | 57px | Bold (700) | `-0.01em` | Large screen layouts, titles |
| **Display Medium** | Space Grotesk | 45px | Bold (700) | `-0.01em` | Landing page titles |
| **Headline Large** | Space Grotesk | 36px | Bold (700) | `-0.005em` | Section headers |
| **Headline Medium**| Space Grotesk | 28px | Semi-Bold (600)| Normal | Sub-sections |
| **Headline Small** | Space Grotesk | 22px | Semi-Bold (600)| Normal | Small headings |
| **Title Large** | Space Grotesk | 18px | Semi-Bold (600)| Normal | Cards / panel headers |
| **Title Medium** | Space Grotesk | 16px | Semi-Bold (600)| Normal | Secondary headers |
| **Body Large** | Manrope | 16px | Regular (400) | `line-height: 1.75` | Primary prose / storytelling |
| **Body Medium** | Manrope | 14px | Regular (400) | `line-height: 1.65` | General UI descriptions |
| **Body Small** | Manrope | 12px | Regular (400) | `line-height: 1.6` | Footnotes, support copy |
| **Label / UI** | Space Grotesk | 9–11px | Bold (700) | `0.2em` uppercase | UI Chrome, metadata, caps |

---

## 05 — Component Specifications

### Buttons
* **Shape**: sharp corners, zero border-radius (`border-radius: 0`).
* **Typographic standard**: uppercase, tracked wide.
* **Interaction scales**: `transform: scale(0.96)` on tap/press state (`:active`).
* **Variants**:
  * **Primary**: Background `#46F5E0` (or `#4cd7f6`), text `#003731`. Hover increases brightness.
  * **Outline**: Background transparent, border `rgba(76,215,246,0.35)`, text `#4cd7f6`. Hover adds `rgba(76,215,246,0.08)` background.
  * **Ghost**: Background transparent, text `#869397`. Hover turns text to white.
  * **Danger**: Border `rgba(255,180,171,0.3)`, text `#FFB4AB`. Hover adds `rgba(255,180,171,0.08)` background.

### Badges & Tier Tags
* **Tier Badges**: Background color mixed with dark shade, border-top uses the raw tier color (3px thickness).
* **Tag Pills**: Border `1px solid rgba(76,215,246,0.25)`, uppercase labels, hover lights up text and adds background.

### Containers & Cards
* **Standard Card**: Background `#1b1f2c`, border `rgba(255,255,255,0.04)`. Hover transitions background to `#262a37` (300ms easing).
* **Accent Card**: Background `#0F172A`, border `rgba(76,215,246,0.15)`. Top edge displays a 2px horizontal color gradient (`Primary Alt` to `Secondary`).
* **Locked Card**: Background `#1b1f2c` with a gradient fading to solid `#0A0E1A` at the bottom. Footer overlays display a bright notice for access tiers.
* **Stat Block**: Background `#0F172A`, border `1px solid #1E2538`. Large value text (`#4cd7f6`, 32px), label text (`#869397`, 9px, uppercase).

---

## 06 — Ambient Corner Glow Pattern

An ambient visual layout standard used to add depth to cards and headers. Instead of standard drop shadows or thick borders, a subtle, radial gradient glow is positioned in the top-right corner of the parent element.

```
+────────────────────────────────────────────────────────────+
│                                           * * * *          │
│                                       * * * * * * * *      │
│                                     * * * * * * * * * *    │
│  [Card Content]                    * * * * GLOW * * * *    │
│                                     * * * * * * * * * *    │
│                                       * * * * * * * *      │
│                                           * * * *          │
+────────────────────────────────────────────────────────────+
```

### Layout Specifications
* **Implementation method**: An absolute-positioned element with a radial gradient centered in the top-right.
* **Dimensions**: 220px width × 220px height.
* **Position**: `left: calc(100% - 140px); top: -80px;`.
* **Clipping**: Parent container **must** have `overflow: hidden` to hide the outer parts of the glow.
* **Interactive Behavior**: Hovering over the container transitions the background color while keeping the glow layer intact.

### Radial Gradient Color Profiles
* **Surface L2 (cg-fold-15)**: `rgba(138, 111, 187, 0.15)` fading to transparent at 65%. Adds subtle warm indigo background depth.
* **Card L3 (cg-fold-22)**: `rgba(138, 111, 187, 0.22)` fading to transparent. Used for standard container depths.
* **Float L4 (cg-active)**: `rgba(76, 215, 246, 0.25)` fading to transparent. Used to highlight active interactive states.
* **Banner Omega (cg-classified)**: `rgba(190, 94, 94, 0.25)` fading to transparent. Used for warning contexts.
* **Banner Strategic (cg-restricted)**: `rgba(184, 112, 56, 0.22)` fading to transparent. Used for restricted resource panels.
* **Banner Nominal (cg-nominal)**: `rgba(78, 154, 106, 0.20)` fading to transparent. Used for stable/success status highlights.

---

## 07 — Forms & Controls

* **Inputs**: Background `#0F172A`, border `1px solid #1E2538`, text color `#F8FAFC`. Focus shows `#4cd7f6` border and a subtle light glow. Zero border-radius.
* **Select Dropdown**: Custom background arrow icon, right-padded to prevent overlap with option labels.
* **Toggles (Switches)**: Width 36px, height 20px. Track background uses `#1E2538`. Thumbs are 12px square, sliding 16px to the right when active and changing color to `#4cd7f6`.
* **Checkboxes**: 16px × 16px box. Checked state turns background to `#4cd7f6` and displays a custom vector checkmark.

---

## 08 — Feedback & Progress indicators

* **Progress Track**: Background `#1E2538`, height 3px (or 6px for thick bars). Eases width transitions dynamically using `800ms` curves.
* **Indeterminate Loading**: Loading fill bar loops from left to right using a `1.4s` loop keyframe animation.
* **Skeleton Loaders**: Container highlights animate background position horizontally on a `1.6s` loop (`#151B2B` to `#1E2538` and back).
* **Alert Notifications**:
  * **Info**: Border `rgba(76,215,246,0.2)`, background `rgba(76,215,246,0.05)`, text `#F8FAFC`.
  * **Success**: Border `rgba(70,245,224,0.2)`, background `rgba(70,245,224,0.05)`, text `#F8FAFC`.
  * **Warning**: Border `rgba(212,168,67,0.25)`, background `rgba(212,168,67,0.06)`, text `#F8FAFC`.
  * **Error**: Border `rgba(255,180,171,0.25)`, background `rgba(255,180,171,0.05)`, text `#F8FAFC`.

---

## 09 — Motion & Micro-interactions

Motion is restrained, keeping interactions predictable and snappy.

### Timing Tokens
* **150ms (Fast)**: Hover states for buttons, inputs, links, checkboxes.
* **300ms (Medium)**: Card hover glows, slide drawer panels, toggles.
* **500ms (Slow)**: Page transitions, layout adjustments.

### Easing Curves
* **Ease (Default)**: `150ms ease` — Used for standard button states.
* **Spring Curve**: `cubic-bezier(0.34, 1.56, 0.64, 1)` — Used for popups, dropdown entries, and toast notifications.

### Loop Animations
* **Telemetry Pulse Dot**: `2s` loop pulsing a box-shadow glow around a 10px indicator.
* **Spinner Ring**: `800ms` circular rotation loop.
* **Textwriter Scramble**: Reveal animation running character by character at `65ms` intervals, using scrambled runs of special Unicode scripts (Runic, Box Drawing, Math, IPA, Greek, Georgian) before locking the final letter in place.
* **Scan Beam**: Ambient gradient beam sweeping vertically down a container inside a `3s` linear loop.

---

## 10 — Accessibility (WCAG Compliance)

The AXIOM design language ensures that all core interactions meet international accessibility standard guidelines.

### Contrast Registry (Text & Surfaces)
All pairings meet at least WCAG 2.1 AA (4.5:1 ratio) requirements, with primary elements achieving AAA (7.0:1):

| Foregound Color | Background Surface | Contrast Ratio | WCAG Compliance Status |
|---|---|---|---|
| **Primary Alt** (`#4cd7f6`) | Background (`#05070F`) | **14.7:1** | AAA Pass |
| **Primary Alt** (`#4cd7f6`) | Card (`#1b1f2c`) | **6.4:1** | AA Pass (AAA for large text) |
| **On Surface** (`#F8FAFC`) | Background (`#05070F`) | **20.3:1** | AAA Pass |
| **Text Bright** (`#dfe2f3`) | Card (`#1b1f2c`) | **13.0:1** | AAA Pass |
| **Text Muted** (`#869397`) | Background (`#05070F`) | **6.9:1** | AA Pass (AAA for large text) |
| **Text Subtle** (`#3d494c`) | Background (`#05070F`) | **2.4:1** | **FAIL** — *Not permitted for content text* |

### Focus Ring Guidelines
* All focusable interactive elements (links, buttons, switches) must replace the browser's default focus ring with a glowing outline offset.
* Outline rule: `outline: 2px solid var(--color-primary-alt); outline-offset: 2px;`.

### Target Sizes (Touch Targets)
* Tap buttons and tags use padding to enforce a minimum touch target size of **44px × 44px** (WCAG AAA 2.5.5) on mobile views, preventing accidental misclicks.

### Reduced Motion Settings
Looping ambient animations must check the user's OS preference settings. If the user prefers reduced motion, animations must snap instantly.

```css
@media (prefers-reduced-motion: reduce) {
  /* Stop looping background animations */
  .scan-beam, .glow-text, .typewriter-text,
  .pulse-dot, .spin-ring, .skeleton {
    animation: none;
  }
  
  /* Disable interactive transitions */
  *, *::before, *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

### ARIA Patterns Registry
Custom components must implement these interactive labels:

| Component Type | Expected ARIA Properties |
|---|---|
| **Tab Navigation** | `role="tablist"` on container, `role="tab"` + `aria-selected` + `aria-controls` on tab triggers, `role="tabpanel"` on active panel frames. |
| **Icon Buttons** | `aria-label="[clear action name]"` to identify purpose to screen readers. |
| **Switches** | `role="switch"` + `aria-checked="true\|false"`. |
| **Progress Indicator** | `role="progressbar"` + `aria-valuenow` + `aria-valuemin="0"` + `aria-valuemax="100"`. |
| **Alert Container** | `role="alert"` for errors/warnings (immediate voice announcement); `role="status"` for info banners. |
| **Tier Gate Shield** | `aria-disabled="true"` on locked links, plus `aria-label` explaining the required subscription tier. |
| **Skeleton Loader** | `aria-busy="true"` on the loading container, plus `aria-label="Loading..."` text. |
