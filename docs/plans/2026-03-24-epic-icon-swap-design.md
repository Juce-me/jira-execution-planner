# Epic Icon Swap Design

**Goal:** Replace the current epic-level checkmark icon with the provided purple SVG in the dashboard epic header UI.

**Scope:** This change is limited to the existing epic icon render points in the React dashboard source. No layout, spacing, interaction, or data behavior changes are included.

**Approach:** Keep the current `.epic-icon` wrapper and replace the inline SVG markup in both places where the epic header icon is rendered:
- the main epic block header
- the mapping preview epic card

**Testing:** Add a source guard test that verifies the new 16x16 epic SVG markup is present in the dashboard source and the legacy 24x24 checkmark icon is gone from those render points.
