---
phase: 7
slug: modern-ui-enhancements
status: draft
shadcn_initialized: false
preset: none
created: 2026-10-06
---

# Phase 7 — UI Design Contract

> Visual and interaction contract for modern UI enhancements that elevate the analytical experience while maintaining the platform's trustworthy, data-driven nature. This phase introduces contemporary design patterns, improved data visualization, and enhanced user interactions without compromising clarity or accessibility.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | Tailwind CSS 4.1 with modern extensions; project-owned components enhanced with modern design patterns |
| Preset | Custom design system building on Phase 1-6 foundations |
| Component library | Extended project-owned components with modern variants; shadcn/ui inspiration for modern primitives |
| Icon library | Lucide React (16/20px) with optional Heroku icons for decorative elements; always paired with text for semantic meaning |
| Font | Geist Sans with system-ui fallback; Geist Mono for IDs, timestamps, hashes, and technical references; optional Inter for data-heavy sections |

### Visual Direction

- Refined analytical workbench: maintains light neutral canvas but introduces subtle depth through layering, glassmorphism effects, and micro-interactions
- Data visualization focus: charts and graphs use Recharts with custom themes that match the analytical aesthetic
- Subtle animations: motion for state changes, data updates, and user interactions (respecting prefers-reduced-motion)
- Elevated surfaces: use of background-blur, subtle gradients, and layered shadows for depth
- Data-ink ratio optimization: maximize data visibility, minimize decorative elements that don't add value
- Continued avoidance of sportsbook styling: no celebratory graphics, urgency treatments, or win/loss framing

### Design Tokens

Extended spacing scale for more granular control:

| Token | Value | Usage |
|-------|-------|-------|
| xxs | 2px | Hairline borders, fine dividers |
| xs | 4px | Icon gaps, badge inset, fine controls |
| sm | 8px | Compact controls, metadata rows, form elements |
| md | 12px | Form spacing, dense data tables |
| lg | 16px | Default spacing, card content |
| xl | 24px | Section padding, standard gutters |
| 2xl | 32px | Major layout separation |
| 3xl | 48px | Prominent section breaks |
| 4xl | 64px | Page-scale separation |

Border radius scale:
- none: 0px
- sm: 4px
- md: 6px (default)
- lg: 8px
- xl: 12px
- full: 9999px

### Visual Direction Details

- **Glassmorphism**: Use background-blur-sm with bg-white/80 for overlay panels, modals, and elevated surfaces
- **Layering**: Subtle drop-shadows (shadow-sm to shadow-md) for depth; never use large, dramatic shadows
- **Micro-interactions**: 150-200ms transitions for hover, focus, and state changes; scale transforms for buttons (95-105%)
- **Data visualization**: Custom Recharts theme with muted colors, subtle grids, and emphasis on data clarity over decoration
- **Dark mode**: Prepared foundation with CSS variables; light theme remains primary for analytics readability

### Responsive Layout

| Breakpoint | Contract |
|------------|----------|
| `<640px` | One column; filter controls in expandable section; charts full-width; data tables scroll horizontally |
| `640–1023px` | Two-column layout for dashboard; charts and key metrics side-by-side; filter panel as collapsible sidebar |
| `≥1024px` | Three-column layout: narrow filters (280px), main content (560px), insights/chart panel (360px); all regions scroll independently |

All information remains available at every breakpoint. Horizontal page scrolling prohibited; explicit scroll containers allowed for data tables and timelines.

---


## Spacing Scale

Extended spacing tokens (multiples of 2px for finer control):

| Token | Value | Usage |
|-------|-------|-------|
| xxs | 2px | Hairline divisions, tight icon spacing |
| xs | 4px | Icon-text spacing, form field padding |
| sm | 6px | Form control spacing, compact metadata |
| md | 8px | Default control spacing, table cell padding |
| lg | 12px | Form section spacing, list item padding |
| xl | 16px | Card content padding, standard gutter |
| 2xl | 24px | Section separation, major layout gaps |
| 3xl | 32px | Prominent section breaks |
| 4xl | 40px | Content hierarchy emphasis |
| 5xl | 48px | Page section padding, mobile gutters |
| 6xl | 64px | Desktop section rhythm |

Interactive components maintain 48×48px minimum target size.

---


## Typography

Typographic scale with additional sizes for data visualization:

| Role | Size | Weight | Line Height | Usage |
|------|------|--------|-------------|-------|
| Caption | 12px | 400 | 1.3 | Form hints, data point labels |
| Label / metadata | 14px | 400 or 600 | 1.4 | Form labels, table headers, chart axis |
| Body / controls | 16px | 400 or 600 | 1.5 | Primary text, buttons, inputs |
| Subheading | 18px | 500 | 1.4 | Section subheads, chart titles |
| Section heading | 20px | 600 | 1.3 | Main section headers |
| Page display | 24px | 600 | 1.2 | Page titles, major metrics |
| Hero display | 28px | 600 | 1.2 | Landing page headlines |
| Data numeric | 16px | 600 | 1.2 | Key statistics, chart values (mono) |

- Numbers in charts use tabular numerals for alignment
- Data labels use sentence case; UI controls use title case for buttons
- Long numbers (probabilities, ratios) use consistent decimal places

---


## Color

Enhanced color system building on Phase 1 foundation with semantic visualization palette:

### Neutral Base (unchanged from Phase 1 for consistency)
| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#F8FAFC` slate-50 | Page background |
| Secondary (30%) | `#FFFFFF` | Cards, panels, surfaces |
| Muted | `#F1F5F9` slate-100 | Subtle backgrounds, hover states |
| Border | `#E2E8F0` slate-200 | Dividers, subtle separators |

### Primary Accent (Phase 1 preserved)
| Role | Value | Usage |
|------|-------|-------|
| Accent | `#1D4ED8` blue-700 | Primary CTA, active state, links |
| Accent hover | `#1E40AF` blue-800 | Interactive states |
| Accent muted | `#DBEAFE` blue-50 | Subtle accent backgrounds |

### Semantic States (enhanced)
| State | Foreground | Background | Usage |
|-------|------------|------------|-------|
| AVAILABLE | `#166534` | `#DCFCE7` | Success, positive data |
| LIMITED | `#92400E` | `#FEF3C7` | Warning, partial data |
| STALE | `#9A3412` | `#FFEDD5` | Aging data, use with caution |
| UNSUPPORTED | `#475569` | `#E2E8F0` | Missing capability |
| UNRESOLVED | `#7E22CE` | `#F3E8FF` | Under review, blocked |
| PENDING | `#6B7280` | `#F9FAFB` | Loading, indeterminate |

### Data Visualization Palette
| Role | Value | Usage |
|------|-------|-------|
| Primary series | `#1D4ED8` blue-700 | Main data lines, primary metrics |
| Secondary series | `#059669` emerald-600 | Comparisons, secondary metrics |
| Tertiary series | `#7C3AED` violet-600 | Additional data series |
| Quaternary series | `#DC2626` red-600 | Alerts, negative indicators (careful use) |
| Grid lines | `#E2E8F0` slate-200 | Chart backgrounds, subtle |
| Axis text | `#64748B` slate-500 | Chart labels, readable |
| Tooltip bg | `#FFFFFF` / 95% | Chart tooltips with blur |
| Tooltip border | `#CBD5E1` slate-300 | Chart tooltip definition |

### Interactive States
- Hover: Increase luminance by 5% for backgrounds, decrease by 5% for text
- Focus: 2px ring `#1D4ED8` + 2px offset
- Pressed: Decrease luminance by 10% for backgrounds
- Disabled: Opacity 50%, cursor not-allowed, no interactive states

All text/background combinations meet WCAG 2.2 AA (4.5:1 normal, 3:1 large text).

---


## Information Architecture and Components

### Public Shell Enhancements

- Header: Product name with optional logo mark; navigation items with subtle hover indicators; user profile avatar (when implemented) with presence indicator
- Main content: Unique H1 with optional subtitle/context line; breadcrumbs with chevron separators on nested pages
- Footer: Enhanced with micro-copy, social links (when relevant), and version/build information in reduced visual weight
- Theme toggle: Preparation for dark/light mode toggle (subtle moon/sun icon) respecting system preference

### Enhanced Fixture Dashboard

- H1: "Upcoming fixtures" with contextual subtitle showing filtered count and date range
- Filter region: Collapsible panel on mobile; always-visible on desktop with smart defaults
- **Enhanced data presentation**:
  - Primary fixture cards: Elevated with subtle shadow, hover lift (translateY(-2px)), and click feedback
  - Data-state badges: Animated on state change; tooltips with detailed provenance on hover
  - **Micro-charts**: Sparklines showing form (last 5 matches) embedded in fixture cards when space permits
  - Odds comparison: When available, show best odds from multiple providers as subtle chips
  - Group headers: Show aggregate statistics (avg probability, value bets found) as subtle metrics
- **Empty state**: Illustration or data visualization placeholder (e.g., calendar heatmap of upcoming fixtures)
- **Loading state**: Skeleton cards with animated pulse; skeleton charts with shimmer effect
- **Error state**: Retry options with exponential backoff suggestion; option to view cached data with staleness warning

### Enhanced Fixture Detail

- Header: Team names with official colors as subtle accents (1px border or background tint); crest logos when available and licensed
- **Data visualization section**:
  - Probability distribution: Donut chart showing home/draw/away probabilities
  - Form guides: Horizontal bar charts for home/away form (last 6 matches)
  - Head-to-head: Mini timeline of recent encounters
  - Market comparison: Odds evolution sparkline when historical data available
- **Provenance panel**: Timeline visualization of data updates with source reliability indicators
- **Value betting section**: When manual odds entered, show EV calculation with confidence interval
- **Explainability**: "Why this prediction?" section showing key factors with impact weights
- **Data quality**: Prominent but non-intrusive data-state indicator with click-to-expand details

### Advanced Data Visualization Components

- **Metric cards**: Elevated panels showing KPIs with sparklines (7-day trend) and goal progress indicators
- **Distribution charts**: Histograms and box plots for statistical understanding (responsible gambling context)
- **Calibration charts**: Reliability diagrams showing predicted vs actual outcomes
- **ROI/yield charts**: Time-series performance charts with drawdown periods highlighted
- **Comparison tables**: Sortable, searchable tables with column highlighting and selective visibility
- **Timeline components**: Horizontal and vertical timelines for match sequences, data provenance, and betting history

### Interactive Patterns

- **Hover cards**: On data points in charts, show detailed tooltip with actionable insights
- **Drill-down**: Clickable chart elements that filter main view or navigate to detailed pages
- **Brush and zoom**: On time-series charts, allow selection of date ranges to filter data
- **Annotation**: Ability to add notes to charts for personal analysis (client-side only)
- **Export**: Chart and table data export as CSV/PNG with attribution
- **Collapsible sections**: Advanced panels that remember user state across sessions

### Responsible Gambling Enhancements

- **Risk indicators**: Subtle but visible reminders of probabilistic nature in prediction contexts
- **Uncertainty visualization**: Confidence intervals, prediction intervals, and variance displays
- **Educational tooltips**: On hover of technical terms, show brief explanations with links to methodology
- **Session awareness**: Gentle reminders about time spent and frequency of use (opt-in)
- **Objective language**: Continued avoidance of persuasive or guaranteeing language; focus on transparency

---


## Interaction States

| Surface | Loading | Empty | Error | Partial / degraded |
|---------|---------|-------|-------|---------------------|
| Dashboard | Elevated skeleton cards with pulsing shimmer; skeleton charts with gradient animation; filters fully operable | Custom illustration or placeholder visualization (e.g., "No fixtures in selected window" with mini calendar) | Inline actionable alert with retry options; "View cached data" staleness indicator; correlation ID for debugging | Valid data with state indicators; degraded features clearly labeled; missing visualizations show placeholders with explanation |
| Fixture detail | Header skeleton with animated gradient; metadata skeleton; chart skeletons with loading states | Not applicable for addressed fixture | Page-level alert with recovery options; "Return to dashboard" prominent; technical details in collapsible section | Known data visualized; missing projections shown as dashed lines or empty chart areas with explanation |
| Visualization containers | Skeleton charts with smooth loading animation; metric cards with pulse placeholders | Chart-specific empty states (e.g., "No data for selected period") with guidance on adjusting filters | Chart error boundary with retry; preserves user interactions; fallback to table view when chart fails | Partial data shown with missing periods highlighted; interpolation clearly marked; confidence bands widened appropriately |
| Forms | Field-level skeleton inputs; submit button with loading state | Standard empty form with helpful placeholders | Inline field errors with specific guidance; preserves valid inputs; retry button for transient errors | Valid fields interactive; invalid fields clearly marked with help text; disabled submit only when all required missing |
| Dialogs & overlays | Content skeleton with title preserved; actions disabled until loaded | Standard empty state for content type | Actionable error with primary retry; secondary option to cancel or view help | Functional core with degraded enhancements clearly indicated; no data loss in operational state |

- All skeletons respect preferred dimensions and aspect ratios
- Transitions use spring physics for natural feel (where supported) or ease-out curves
- Micro-interactions use 100-200ms duration with attention to easing curves
- Error boundaries provide context-specific recovery options without data loss
- Empty states provide clear path to populated state through user action
- Partial states clearly demarcate available vs unavailable data with reasoning

---


## Copywriting Contract

| Element | Copy |
|---------|------|
| Dashboard primary CTA | Refine filters |
| Dashboard empty heading | No matches found |
| Dashboard empty body | Try adjusting your date range or competition filters to see upcoming fixtures. |
| Dashboard error | Unable to load fresh data. Showing cached results from {time}. [Refresh] [View details] |
| Visualization loading | Loading chart data... |
| Visualization empty | No data available for the selected criteria. Adjust filters or time range to see visualizations. |
| Visualization error | Unable to render visualization. [Retry] [Show data table] |
| Metric card error | Data temporarily unavailable [Retry] |
| Apply filters CTA | Apply filters |
| Reset filters CTA | Reset to defaults |
| Save view CTA | Save current view |
| Export data CTA | Export as CSV |
| Export chart CTA | Download chart |
| Persistent analytical reminder | All probabilities are estimates based on available data. Outcomes remain uncertain. |
| Methodology link | Learn how we calculate these estimates → |
| Uncertainty indicator | Range shows 90% confidence interval based on data quality and sample size |
| Value bet indicator | Positive expected value does not guarantee profit; represents mathematical advantage only |
| Time spent reminder | You've been viewing analytics for {time}. Consider taking a break for perspective. |

Copy principles:
- Use "estimate", "probability", "range", "indicator", "suggests" throughout
- Never use "guarantee", "certain", "sure", "lock", "profit", "winning", or similar deterministic language
- Error messages include specific recovery actions and preserve user context where possible
- Technical terms link to glossary or methodology explanations
- All numerical presentations include appropriate precision and uncertainty indicators
- Call-to-action buttons use clear, action-oriented language without pressure or urgency

---


## Accessibility and Keyboard Contract

- Enhanced focus visible: 2px ring `#1D4ED8` + 2px offset with 2px outline-offset for clarity
- Motion considerations: All animations respect `prefers-reduced-motion`; non-essential motion disabled
- Audio equivalents: Important visualizations have optional textual summaries (visually hidden)
- Touch targets: Minimum 44×44px for touch; 48×48px preferred for mouse precision
- Screen reader optimization: Charts include ARIA labels and data tables as alternatives
- Color blindness: Palettes tested for deuteranopia/protanopia; critical information never color-only
- Keyboard navigation: Logical order follows visual grouping; skip links to major regions
- Zoom resilience: Layouts fluid to 400% zoom; charts remain readable and interactive
- Reduced motion: Transitions become instant fades; micro-interactions use opacity changes only
- Focus management: Dialogs trap focus; return focus to triggering element; scroll position maintained
- Landmark usage: Enhanced use of region, complementary, and supplementary landmarks for complex pages
- Live regions: Polite for updates; assertive only for critical errors requiring immediate attention

---


## UI Considerations

Applicable state considerations resolved: 30 covered, 5 backstop, 0 unresolved.

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | visualization containers | ✅ covered | Custom empty states with guidance on how to populate data (adjust filters, add manual odds, etc.) |
| loading | skeleton charts | ✅ covered | Animated gradient placeholders that respect chart dimensions and aspect ratios |
| error | chart rendering | ✅ covered | Error boundaries with retry controls and fallback to data table view |
| populated | metric cards with sparklines | ✅ covered | Sparklines show 7-day trend; missing data points clearly indicated; hover shows exact values |
| partial | time-series visualizations | ✅ covered | Missing periods shown as dashed lines or transparent fills with tooltip explanation |
| overflow | data tables with many columns | ✅ covered | Horizontal scroll with frozen header; column visibility controls; responsive column stacking |
| zero-one-many | chart data points | ✅ covered | Zero uses empty state; single point shows as prominent marker with tooltip; many use sampling/clustering for performance |
| long-text | tooltip content | ✅ covered | Tooltips wrap intelligently; max-width prevents overflow; content is concise and scannable |
| animation | micro-interactions | ✅ covered | All transitions respect prefers-reduced-motion; non-essential animation disabled |
| color | data visualization | ✅ backed | Palettes tested for color blindness; critical data uses shape/position in addition to color |
| interaction | drag-and-drop | 🧪 backstop | Not implemented in this phase; future consideration for custom dashboard layouts |
| performance | large dataset rendering | ✅ covered | Virtualization for lists/tables; chart data sampling above 1000 points; websocket updates for real-time |
| accessibility | screen reader charts | ✅ covered | ARIA-labeled charts with hidden data tables; dynamic updates announced appropriately |
| responsivity | container queries | ✅ covered | Components adapt to container width; cards rearrange in grids based on available space |
| theming | dark mode preparation | ✅ covered | CSS variables foundation; media queries ready; no active dark mode implementation in this phase |
| persistence | user preferences | ✅ covered | Filter preferences saved in URL; UI state (collapsed panels) saved in sessionStorage; no persistent accounts |
| internationalization | layout mirroring | ✅ covered | Left/right-aware spacing; flexible containers; no fixed-width assumptions in critical paths |
| security | iframe sandboxing | ✅ covered | Any embedded visualizations use sandboxed iframes with minimal required permissions |
| ethics | dark patterns | ✅ covered | No manipulative design; all interactions transparent; easy exits; no artificial scarcity or urgency |

---


## Testable Acceptance Contract

- Dashboard E2E verifies elevated card interactions, filter panel collapse/expand, sparkline visibility, and export functionality
- Chart rendering test verifies all chart types render correctly with sample data, handle empty states, and show appropriate errors
- Interaction test verifies hover tooltips, drill-down navigation, brush/zoom selection, and annotation features (client-side)
- Accessibility test covers keyboard navigation of complex interactions, screen reader chart alternatives, color blindness simulation, and reduced motion behavior
- Performance test verifies smooth rendering with 50+ fixtures, chart interactions at 60fps, and lazy loading of off-screen visualizations
- Responsivity test validates layouts at 320px, 768px, 1024px, 1440px, and 1920px with fluid container behavior
- Visual regression test checks for consistent rendering of elevated surfaces, micro-interactions, and data visualization themes
- Error boundary test verifies graceful degradation of visualizations with preservation of user interactions and data
- Copy scan validates absence of prohibited certainty language and presence of analytical reminders and educational content
- Animation test confirms all transitions respect prefers-reduced-motion and have appropriate duration/easing

---


## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn/ui inspiration | Modern primitives (button, card, tooltip, dialog) | Adapted implementations; no direct copying; follows project-owned component philosophy |
| third-party charts | Recharts with custom theme | Approved library; constrained to data visualization only; no UI framework mixing |
| animation library | Framer Motion Lite (custom build) | Micro-interactions only; no page transitions; bundle size conscious |

---


## Source Decisions Applied

| Source | Applied contract |
|--------|------------------|
| `REQUIREMENTS.md` | NFR-03 (Usability), NFR-07 (Performance), NFR-09 (Accessibility), SUP-02 (Responsible gambling) |
| `ARCHITECTURE.md` | Components should be cohesive and follow established visual language |
| `STACK.md` | Tailwind 4.1, Recharts 3.8.x, Lucide React |
| `06-RELEASE-EXPERIENCE-AND-OPERATIONS` | Feedback on clarity and usability of existing interfaces |
| `PLAN.md` (phase 7) | Focus on modernizing UI while enhancing analytical capabilities |

---

