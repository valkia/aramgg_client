---
name: Arcane Catalyst
colors:
  surface: '#08151e'
  surface-dim: '#08151e'
  surface-bright: '#2f3a45'
  surface-container-lowest: '#040f18'
  surface-container-low: '#111d26'
  surface-container: '#15212a'
  surface-container-high: '#1f2b35'
  surface-container-highest: '#2a3640'
  on-surface: '#d7e4f1'
  on-surface-variant: '#bacac6'
  inverse-surface: '#d7e4f1'
  inverse-on-surface: '#26323c'
  outline: '#859491'
  outline-variant: '#3c4a47'
  surface-tint: '#3bdccd'
  primary: '#47e4d5'
  on-primary: '#003732'
  primary-container: '#0ac8b9'
  on-primary-container: '#004e48'
  inverse-primary: '#006a62'
  secondary: '#e2c384'
  on-secondary: '#402d00'
  secondary-container: '#5c4613'
  on-secondary-container: '#d3b478'
  tertiary: '#9cd5ff'
  on-tertiary: '#00344d'
  tertiary-container: '#7abae7'
  on-tertiary-container: '#004a6c'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#61f9e9'
  primary-fixed-dim: '#3bdccd'
  on-primary-fixed: '#00201d'
  on-primary-fixed-variant: '#005049'
  secondary-fixed: '#ffdfa0'
  secondary-fixed-dim: '#e2c384'
  on-secondary-fixed: '#261a00'
  on-secondary-fixed-variant: '#594311'
  tertiary-fixed: '#c9e6ff'
  tertiary-fixed-dim: '#8ecefb'
  on-tertiary-fixed: '#001e2f'
  on-tertiary-fixed-variant: '#004c6e'
  background: '#08151e'
  on-background: '#d7e4f1'
  surface-variant: '#2a3640'
typography:
  headline-xl:
    fontFamily: Sora
    fontSize: 48px
    fontWeight: '800'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Sora
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Sora
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '700'
    lineHeight: '1.4'
    letterSpacing: 0.1em
  headline-lg-mobile:
    fontFamily: Sora
    fontSize: 28px
    fontWeight: '700'
    lineHeight: '1.2'
spacing:
  unit: 4px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 48px
  panel-padding: 20px
---

## Brand & Style
The design system bridges the gap between high-fantasy craftsmanship and futuristic industrialism. It evokes a sense of "techno-magic"—where precise engineering meets volatile arcane energy. The UI is designed to feel like an artifact of immense power: heavy, metallic, and pulsing with internal light.

**Design Style: Hextech Fusion**
This style blends **Glassmorphism** with **Tactile/Skeuomorphic** accents. UI elements are not merely flat digital containers; they are physical plates of enchanted metal and reinforced glass. 
- **Magical Utility:** Functional data visualizations (charts, maps) are rendered with shimmering ethereal glows.
- **Craftsmanship:** Use ornate gold filigree on primary container corners to suggest artisanal construction.
- **Industrial Precision:** Secondary elements use sharp "tech-lines" and structural grids to maintain a sense of military-grade hardware.

## Colors
The palette is rooted in the "Void" of deep navy and charcoal, providing a high-contrast foundation for luminescent magical effects. 

- **Primary (Hextech Blue):** Reserved for active magical states, primary buttons, and critical data flows. This color should always have a bloom or outer glow effect.
- **Secondary (Gold/Brass):** Used for structural framing, decorative trim, and "premium" UI interactions. It represents the physical housing of the magic.
- **Tertiary (Deep Sea Blue):** Used for inactive states, secondary progress bar fills, and depth-layering.
- **Neutral:** A range of near-black teals used for backgrounds to ensure the blue and gold accents feel vibrant.

## Typography
The typography system uses a hierarchical mix of geometric strength and technical precision.

- **Headlines (Sora):** Replaces Beaufort with a contemporary geometric sans that captures the same wide, authoritative stance. Used for titles and major impact areas.
- **Body (Hanken Grotesk):** Provides a sharp, modern readability that complements the complex UI background.
- **Data/UI Labels (JetBrains Mono):** Monospaced fonts are used for tactical data, small labels, and "readouts" to reinforce the high-tech, engineered nature of the interface.

*Note: All "Label-Caps" should be treated with a slight 1px text-shadow of the primary blue color when used in an active state.*

## Layout & Spacing
The layout follows a **Fixed Grid** approach for primary dashboards to maintain the "cockpit" feel of a magical console. Content is encased in rigid containers.

- **Grid:** 12-column desktop grid with 24px gutters.
- **Containment:** Use nested panels. A primary container might have a 2px gold border, while internal sub-sections use subtle blue "tech-line" dividers.
- **Adaptive Strategy:** On mobile, ornate filigree is stripped back to 1px corner accents only, and margins are reduced to maximize screen real estate for content.

## Elevation & Depth
Depth is created through **Glassmorphism** and **Tonal Layering** rather than traditional drop shadows.

- **Background Blurs:** Surfaces use a 12px-20px backdrop blur to "defocus" the magical energy pulsing behind them.
- **Inner Glows:** Instead of outer shadows, use inner 1px borders (bezel effect) in Gold or Blue to define the edges of panels.
- **Magical Bloom:** High-priority elements (active buttons, notifications) use a soft outer glow (`blur: 15px`) in `#0AC8B9` at 30% opacity to suggest they are "powered on."

## Shapes
The design system utilizes **Sharp (0px)** corners for the primary structure to emphasize a sense of industrial rigidity and precision.

- **Chamfered Edges:** Instead of rounding, use 45-degree clipped corners (chamfers) on larger panels and buttons to create an "armored" appearance.
- **Circular Elements:** Hextech energy is often contained in circles. Use perfect circles for progress indicators, avatar frames, and magical "cores."

## Components
- **Buttons:** Metallic slabs with a subtle vertical gradient (Gold to Dark Brass). On hover, the text and 1px border ignite with a bright Blue glow.
- **Input Fields:** Semi-transparent dark blue backgrounds with a constant 1px Gold bottom-border. When focused, the border expands to wrap the entire field in a Blue glow.
- **Progress Bars:** Dual-layered. The background track is Deep Sea Blue. The fill is a linear gradient from Hextech Blue to a lighter cyan, with a "shimmer" animation moving across the fill.
- **Cards/Panels:** Deep Navy glass with 40% opacity. Top-left and bottom-right corners feature ornate Gold filigree "brackets."
- **Chips/Badges:** Small, angular containers with monospaced text. Status indicated by a 4px "power light" dot (Red for alerts, Blue for active).
- **Tactile Indicators:** Use "tech-lines"—thin, non-functional horizontal or vertical lines that terminate in 45-degree angles—to fill negative space in headers.