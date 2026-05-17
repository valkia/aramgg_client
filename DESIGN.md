---
name: "LoL Tips Client Design System"
version: "1.0.0"
status: "active"
mode: "dark"
description: "A restrained fantasy-tech desktop UI system for a League of Legends companion client."

colors:
  background:
    base: "#070A0D"
    raised: "#0B1117"
    surface: "#111923"
    surfaceRaised: "#162231"
    surfaceStrong: "#1C2A39"
  text:
    primary: "#F4ECDC"
    secondary: "#A99F8C"
    muted: "#6F7A82"
    inverse: "#070A0D"
  brand:
    primary: "#28D9C8"
    primaryHover: "#6CF1E5"
    accent: "#C8A96A"
    accentHover: "#E2C27A"
  semantic:
    success: "#54D884"
    warning: "#E2C27A"
    danger: "#E5534B"
    dangerSoft: "#FFB0AA"
  border:
    default: "rgba(244, 236, 220, 0.10)"
    accent: "rgba(200, 169, 106, 0.24)"
    focus: "rgba(40, 217, 200, 0.55)"

typography:
  fontFamily:
    base: "Microsoft YaHei, Segoe UI, Arial, sans-serif"
    mono: "SF Mono, Menlo, Monaco, Consolas, monospace"
  scale:
    display:
      fontSize: 30
      lineHeight: 38
      fontWeight: 800
      letterSpacing: 0
    title:
      fontSize: 18
      lineHeight: 26
      fontWeight: 800
      letterSpacing: 0
    body:
      fontSize: 14
      lineHeight: 22
      fontWeight: 500
      letterSpacing: 0
    label:
      fontSize: 12
      lineHeight: 18
      fontWeight: 700
      letterSpacing: 0
    data:
      fontSize: 13
      lineHeight: 20
      fontWeight: 800
      letterSpacing: 0

spacing:
  unit: 4
  scale:
    xs: 4
    sm: 8
    md: 12
    lg: 16
    xl: 20
    xxl: 24
    section: 32

radii:
  xs: 2
  sm: 4
  md: 6
  lg: 8
  xl: 8

elevation:
  none: "none"
  panel: "0 18px 50px rgba(0, 0, 0, 0.42)"
  overlay: "0 25px 80px rgba(0, 0, 0, 0.72)"
  focus: "0 0 0 3px rgba(40, 217, 200, 0.12)"
  glow: "0 0 0 1px rgba(40, 217, 200, 0.16), 0 12px 30px rgba(40, 217, 200, 0.06)"

components:
  panel:
    background: "linear-gradient(145deg, rgba(17, 25, 35, 0.96), rgba(9, 14, 19, 0.98))"
    border: "1px solid rgba(244, 236, 220, 0.10)"
    radius: 8
    shadow: "panel"
    padding: 18
  button:
    primary:
      background: "linear-gradient(135deg, #28D9C8, #169A91)"
      color: "#070A0D"
      border: "1px solid rgba(108, 241, 229, 0.32)"
      radius: 6
      height: 36
    secondary:
      background: "rgba(244, 236, 220, 0.05)"
      color: "#F4ECDC"
      border: "1px solid rgba(244, 236, 220, 0.10)"
      radius: 6
      height: 36
    danger:
      background: "rgba(229, 83, 75, 0.16)"
      color: "#FFB0AA"
      border: "1px solid rgba(229, 83, 75, 0.38)"
      radius: 6
      height: 36
  input:
    background: "rgba(7, 10, 13, 0.55)"
    color: "#F4ECDC"
    placeholder: "#6F7A82"
    border: "1px solid rgba(244, 236, 220, 0.10)"
    focusBorder: "rgba(40, 217, 200, 0.55)"
    radius: 6
    height: 36
  table:
    headerBackground: "rgba(200, 169, 106, 0.08)"
    rowBackground: "rgba(17, 25, 35, 0.56)"
    rowHover: "rgba(40, 217, 200, 0.07)"
    border: "1px solid rgba(244, 236, 220, 0.10)"
  overlay:
    background: "linear-gradient(145deg, rgba(17, 25, 35, 0.92), rgba(7, 10, 13, 0.94))"
    border: "1px solid rgba(200, 169, 106, 0.24)"
    radius: 8
    shadow: "overlay"
    backdropBlur: 14

breakpoints:
  mobile: 560
  tablet: 860
  desktop: 1220

accessibility:
  minimumTextContrast: "AA"
  focusVisible: true
  minInteractiveSize: 32
  reducedMotionSupported: true
---

## Overview

LoL Tips Client should feel like a practical esports companion, not a landing page or a decorative game splash screen. The interface is dark, compact, data-forward, and calm under pressure. It uses a fantasy-tech language through black obsidian surfaces, muted navy-gray panels, ivory text, antique gold dividers, electric teal interaction states, and restrained crimson risk states.

The design goal is fast repeated use: users should immediately understand game path configuration, rune controls, champion monitoring, hero statistics, and Hextech augment recommendations. Visual drama should come from surface quality, border discipline, and state color, not from oversized hero art, large gradients, or ornamental effects.

## Colors

Use `#070A0D` as the base page color and `#111923` / `#162231` for panels and raised controls. Use `#F4ECDC` for primary text, `#A99F8C` for secondary text, and `#6F7A82` for low-priority labels.

Use teal `#28D9C8` as the primary action and focus color. Use gold `#C8A96A` for dividers, tier/status emphasis, and premium metadata. Use crimson `#E5534B` only for destructive actions, errors, or high-risk states. Avoid purple-blue gradients, saturated default Tailwind blue, beige/brown dominant themes, and one-hue interfaces.

## Typography

Use `Microsoft YaHei, Segoe UI, Arial, sans-serif` for all UI text. Keep headings compact: 30px for the main page title, 18px for section titles, 14px for body copy, 12px for labels, and 13px for dense data values. Letter spacing must stay at `0`.

Text should be scannable and operational. Do not use hero-scale type inside cards, overlays, tables, tabs, or compact controls. Favor short Chinese labels and clear numeric values over explanatory paragraphs inside the app.

## Layout

Use a max content width of `1220px` for full pages. Main dashboard sections may use a 12-column grid; compact configuration panels can span 6 columns on desktop and full width on tablet/mobile. Use 16px gaps for related panels and 24px page padding.

Avoid cards inside cards. Page sections should be full-width surfaces or direct panels, while repeated items such as augment rows, item builds, and table rows can use framed rows. Floating overlays should be narrow, anchored, and usable during gameplay without covering unnecessary screen area.

## Elevation & Depth

Use elevation sparingly. Most panels use `0 18px 50px rgba(0,0,0,0.42)`. Overlays and popups can use `0 25px 80px rgba(0,0,0,0.72)`. Focus rings use teal with low opacity.

Depth should signal hierarchy: page background, panel, raised panel, overlay. Do not use decorative orbs, bokeh blobs, heavy bloom, or unrelated background illustrations.

## Shapes

Use 6px radius for controls and 8px radius for panels, overlays, tables, and repeated cards. Avoid pill-shaped controls unless the element is a status chip. Keep icon buttons square or near-square with stable dimensions.

Borders are part of the visual language. Prefer thin ivory or gold borders at low opacity. Use teal borders only for focus, hover, active selection, or high-priority recommendations.

## Components

Primary buttons use teal gradient fill, dark text, 6px radius, and a subtle teal glow on hover. Secondary buttons use translucent ivory surfaces with thin borders. Danger buttons use transparent crimson surfaces with crimson text.

Panels use dark gradients, 8px radius, thin borders, and consistent padding. Tables use gold-tinted headers, dark rows, teal hover states, and clear numeric alignment. Inputs use dark recessed backgrounds, ivory text, muted placeholders, and teal focus borders.

Hextech augment cards must show rank, name, win rate, recommendation score, and recommendation label in a compact structure. Gold augments use gold accents, silver augments use cool gray accents, and prismatic augments use teal accents rather than dominant purple.

## Do's and Don'ts

Do keep interfaces dense but organized. Do use teal for interaction and gold for hierarchy. Do keep text legible at small sizes. Do use lucide icons for actions where an icon exists. Do keep overlays compact and readable.

Do not create marketing-style hero sections. Do not use purple-blue gradient cards. Do not use oversized rounded pills. Do not nest cards. Do not scale font size with viewport width. Do not use nonzero or negative letter spacing. Do not let text overflow buttons, tabs, badges, or cards.
