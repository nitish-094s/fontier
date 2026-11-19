import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral';

/**
 * Monochrome accents: black on the light theme (18.9:1 on white), warm white on the dark theme (17.3:1).
 * The mint / orange glows stay as background atmosphere only. Greys are neutral, without the old green tint.
 * Headings use Outfit as a free stand-in for F37 Ginger; swap HEADING_FONT once licensed files exist.
 */
export const HEADING_FONT = 'Outfit Variable';

export const kernTheme = defineTheme({
  name: 'kern',
  extends: neutralTheme,
  typography: {
    scale: { base: 14, ratio: 1.2 },
    body: { family: 'Geist Variable', fallbacks: "'Segoe UI', system-ui, sans-serif" },
    heading: { family: HEADING_FONT, fallbacks: "'Geist Variable', 'Segoe UI', sans-serif" },
  },
  radius: { base: 6, multiplier: 1.6 },
  components: {
    // Menus match the corner of the field that opens them (Sort, Language…), not the larger card corner.
    popover: { base: { borderRadius: 'var(--radius-element)' } },
  },
  tokens: {
    '--color-accent': ['#111111', '#F3F0EB'],
    '--color-accent-muted': ['rgba(17,17,17,0.07)', 'rgba(243,240,235,0.10)'],
    '--color-text-accent': ['#111111', '#F3F0EB'],
    '--color-icon-accent': ['#111111', '#F3F0EB'],
    '--color-on-accent': ['#FFFFFF', '#0B0B0C'],
    '--color-background-body': ['#FFFFFF', '#0B0B0C'],
    '--color-background-surface': ['#F6F6F5', '#131315'],
    '--color-background-card': ['#FFFFFF', '#161618'],
    '--color-background-popover': ['#FFFFFF', '#1B1B1E'],
    '--color-background-muted': ['#F0F0EF', '#1D1D20'],
    '--color-border': ['#E6E6E4', 'rgba(255,255,255,0.08)'],
    '--color-border-emphasized': ['#CFCFCC', 'rgba(255,255,255,0.16)'],
    '--color-text-primary': ['#111111', '#F3F0EB'],
    '--color-text-secondary': ['#62625F', '#A19D97'],
    '--color-icon-primary': ['#111111', '#F3F0EB'],
    '--color-icon-secondary': ['#62625F', '#A19D97'],
  },
});
