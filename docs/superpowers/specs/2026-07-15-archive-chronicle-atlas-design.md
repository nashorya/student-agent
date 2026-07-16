# Archive Chronicle Atlas UI Design

- Date: 2026-07-15
- Status: approved for implementation
- Scope: redesign the generated project archive dashboard
- Parent design: `2026-07-14-project-development-archive-design.md`

## 1. Goal

Replace the current flat archive dashboard with a high-quality, self-contained static experience that explains project development as a chronological system.

The page combines:

- a vertically readable development timeline;
- a horizontal minimap for rapid date navigation;
- Raycast-style keyboard search and filtering;
- dated ADR and bug markers attached to the development history;
- deep-linked detail views inside the same HTML file;
- meaningful non-linear motion without scroll-jacking.

Markdown remains canonical. The HTML remains deterministic, derived, safe to regenerate, offline-capable, and read-only.

## 2. Approved Visual Direction

The approved direction is **Chronicle Atlas**, combining the selected A and C concepts:

- Linear and Framer supply the near-black canvas, precise surface ladder, hairline borders, tight display typography, and scarce lavender accent.
- Raycast supplies the command-palette interaction model, dense utility chrome, keyboard-first navigation, compact metadata, and semantic status accents.
- UI-UX-PRO-MAX supplies accessibility, responsive, interaction, and motion constraints.
- The final layout uses the approved **vertical spine + horizontal minimap** structure.

The design does not copy a single brand. It uses the referenced systems as guardrails for a project-specific interface.

## 3. Design Principles

1. **Time is the primary information architecture.** INDEX events, ADRs, and bugs are understood first by their position in project history.
2. **The main path stays linear.** Users scroll vertically through time; the minimap and command palette provide non-linear jumps.
3. **Motion explains relationships.** Path progress, staggered node reveal, and shared-element transitions express where an item came from and where it goes.
4. **The archive stays useful without motion.** `prefers-reduced-motion` removes spatial animation while preserving every state and interaction.
5. **Dense does not mean crowded.** Surface hierarchy, typography, and consistent spacing separate navigation, events, metadata, and long-form detail.
6. **No network dependency.** Fonts, icons, styles, scripts, and content must work from a local `file://` URL.

## 4. Information Architecture

The generated document contains two navigable states in one HTML file.

### 4.1 Chronicle view

```text
Global header
  |- project identity
  |- command search trigger
  `- theme control

Archive hero
  |- archive description
  `- event / ADR / bug counts

Horizontal minimap
  |- project date range
  |- semantic event markers
  `- current reading position

Vertical chronicle
  |- dated development event
  |- related ADR chips
  |- related bug chips
  `- status and verification metadata

Source integrity footer
```

### 4.2 Detail view

Hash routes open a full detail state while keeping the document self-contained:

```text
dashboard.html#timeline/INDEX-16
dashboard.html#adr/ADR-005
dashboard.html#bug/BUG-007
```

Each detail state includes:

- route and entity identity;
- title and human-readable summary;
- structured status, implementation state, and date facts;
- safely rendered Markdown body;
- related timeline, ADR, bug, and evidence links;
- source path and SHA-256 state;
- a visible back action.

Browser Back restores the previous timeline scroll position, search query, and active filters.

## 5. Chronicle Data Model

Add a presentation model between `ArchiveProject` and HTML rendering.

```ts
type ChronicleItemKind = 'timeline' | 'adr' | 'bug' | 'verification';

interface ArchiveChronicleItem {
  key: string;
  kind: ChronicleItemKind;
  entityId: string;
  dateLabel: string;
  sortDate?: string;
  title: string;
  summary: string;
  route: string;
  statuses: string[];
  relatedEntityIds: string[];
  sourcePath?: string;
}

interface ArchiveChronicleModel {
  items: ArchiveChronicleItem[];
  datedItems: ArchiveChronicleItem[];
  undatedItems: ArchiveChronicleItem[];
  startDate?: string;
  endDate?: string;
  entityRoutes: Record<string, string>;
}
```

The presentation model does not become a new persistence layer.

## 6. Date and Relationship Rules

Timeline placement must be deterministic and must never invent dates.

### 6.1 INDEX entries

- Use the INDEX row date label as displayed.
- Derive `sortDate` from the first valid ISO-style date token in the label.
- Preserve ranges such as `2026-06-04 ~ 06` as the visible label.

### 6.2 ADR entries

- Use `ArchiveAdr.date` when present.
- If an INDEX entry contains the ADR ID, attach the ADR as a chip to that event.
- Do not create a duplicate standalone ADR node when the referenced INDEX event already represents the same milestone.
- If no INDEX reference exists, create a standalone ADR node at the ADR date.

### 6.3 Bug entries

`ArchiveBug` currently has no direct date field. Use the following precedence:

1. earliest INDEX entry whose title or summary contains the BUG ID;
2. earliest valid `ArchiveHistoryEntry.at` value;
3. the `Undated` section.

An absent date is displayed honestly as `Undated`; the renderer must not infer a date from file order, status, or Git metadata.

### 6.4 Cross-links

- Detect exact case-insensitive entity tokens such as `ADR-005` and `BUG-007`.
- Avoid substring matches inside larger tokens.
- Every detected relationship becomes both a visible chip and a keyboard-focusable link.

## 7. Visual System

### 7.1 Color tokens

```css
--canvas: #010102;
--surface-1: #0f1011;
--surface-2: #17181c;
--surface-3: #202126;
--hairline: #23252a;
--hairline-strong: #34363e;
--ink: #f7f8f8;
--ink-muted: #d0d6e0;
--ink-subtle: #8a8f98;
--ink-tertiary: #62666d;
--accent: #5e6ad2;
--accent-hover: #828fff;
--adr: #59d499;
--bug: #ff6161;
--warning: #ffc533;
--focus: #aeb5ff;
```

Lavender is the single chrome accent. Green, red, and yellow are reserved for semantic entity and status meaning and always appear with text or shape labels.

### 7.2 Typography

- Display and body: local system stack with `Inter`-compatible metrics.
- Code, IDs, dates, routes, and hashes: `ui-monospace`, `SFMono-Regular`, `Menlo`, monospace.
- Display type uses negative tracking; body type uses normal or minimally negative tracking.
- Body text remains at least 16px in long-form detail content with line-height between 1.5 and 1.7.
- No remote font import is permitted.

### 7.3 Surfaces and shape

- Depth comes primarily from the surface ladder and hairline borders.
- Default cards use 10–12px radius; detail containers may use 16px.
- Avoid large soft shadows. A focused or transitioning element may use a restrained accent glow.
- Buttons and controls have at least a 44px interactive target even when the visible chrome is compact.

## 8. Component Design

### 8.1 Header and hero

- Compact project identity and archive label.
- `Command/Ctrl + K` search trigger.
- Theme control defaults to the dark Chronicle Atlas theme; a high-contrast light fallback may be added only if it does not delay the core redesign.
- Summary counts use tabular figures.

### 8.2 Horizontal minimap

- Implement as semantic navigation with real buttons or anchors, not a canvas-only graphic.
- Distribute markers by normalized date position between the earliest and latest dated item.
- Marker color and shape distinguish timeline, ADR, bug, and verification items.
- The active reading range updates without moving layout.
- On mobile, the minimap remains horizontally compact and may aggregate dense clusters.

### 8.3 Vertical timeline

- Render as a semantic ordered list.
- Each item contains date, node, title, summary, statuses, and related entity chips.
- Items use a single reading column rather than alternating left/right on narrow screens.
- Filtered items collapse without leaving empty timeline gaps.
- `Undated` items appear after dated history in a clearly labeled group.

### 8.4 Command palette

- Use an accessible native `<dialog>` or equivalent semantic dialog.
- Search INDEX, ADR, bug, status, summary, and source path.
- Arrow keys move the active option; Enter opens; Escape closes and restores focus.
- Results show entity type, date, title, status, and route.
- Search is deterministic and entirely client-side.

### 8.5 Detail state

- Pre-render detail articles during generation; the browser must not parse Markdown dynamically.
- Use hash routing and progressive enhancement.
- JavaScript enhances focus management, history state, and shared-element motion.
- Without JavaScript, hash anchors still reach readable detail content.

### 8.6 Safe Markdown body

Use the existing `marked` lexer only as a tokenizer. Convert an explicit allowlist of tokens into escaped HTML:

- headings;
- paragraphs;
- ordered and unordered lists;
- blockquotes;
- fenced code and inline code;
- emphasis and strong text;
- links with safe `http:`, `https:`, relative, and hash targets.

Raw HTML tokens are rendered as escaped text. Unsafe URL schemes are rendered as plain text. Project-controlled text must never be assigned through client-side `innerHTML`.

## 9. Motion System

Motion uses CSS transforms, opacity, SVG stroke progress, and the Web Animations API. It must not animate layout properties such as width, height, top, or left during interaction.

### 9.1 Chronicle reveal

- Timeline nodes enter with 36–48ms stagger within the visible viewport.
- Entry duration: 220–320ms.
- Use an ease-out or spring-like cubic-bezier curve.
- Items remain immediately interactive during animation.

### 9.2 Minimap progress

- Update the progress line and active marker through a `requestAnimationFrame`-throttled scroll read.
- The animation reflects current document position; it does not control scrolling.

### 9.3 Shared-element transition

- Clone only the selected event title and semantic chips into a fixed transition layer.
- Move and crossfade the clone into the detail heading over at most 380ms.
- Replace the clone with the real detail content after the transition.
- Browser Back performs the reverse transition when the source card remains available.

### 9.4 Reduced motion

When `prefers-reduced-motion: reduce` is active:

- disable translation, scale, path drawing, stagger, and shared-element animation;
- keep direct crossfades no longer than 100ms or switch instantly;
- preserve focus movement, hash routing, selection state, and scroll restoration.

## 10. Responsive Behavior

### Desktop: 1024px and wider

- Sticky minimap below the header.
- Timeline and detail state may use a split composition during transitions, but the settled hash route occupies the main reading width.
- Content width is capped near 1280px.

### Tablet: 768–1023px

- Timeline remains a single primary column.
- Minimap clusters dense markers.
- Detail content uses the full available width.

### Mobile: below 768px

- One-column timeline with the date, node, and card aligned compactly.
- No horizontal page scrolling.
- Command palette becomes a full-height sheet.
- Minimap remains a small navigation strip and does not require precision dragging.
- All interactive targets remain at least 44px.

## 11. Accessibility

- Preserve the skip link and semantic heading hierarchy.
- Timeline uses `<ol>` and each item has a descriptive accessible name.
- Entity type and status are conveyed by text and shape, never color alone.
- All hash routes set focus to the detail heading.
- Closing detail or navigating Back restores focus to the originating event.
- Command palette follows dialog focus trapping and Escape behavior.
- Visible focus uses the lavender focus token with at least a 2px outline.
- Contrast targets WCAG AA: 4.5:1 for normal text and 3:1 for large text and graphical indicators.
- A source-integrity text list remains available as an accessibility and audit fallback.

## 12. Failure and Empty States

- Invalid or unknown hash: return to the chronicle and announce `Archive entry not found` in a polite live region.
- No dated items: render the `Undated` group as the primary list and hide date-progress UI.
- No related ADRs or bugs: omit the chip region rather than rendering an empty container.
- Search has no results: show the query and a clear action to reset filters.
- JavaScript failure: chronological content and anchor-linked detail articles remain readable.
- Source validation warnings remain visible but non-blocking, consistent with current archive adoption behavior.

## 13. Implementation Boundaries

Recommended source boundaries:

```text
src/archive/chronicle-model.ts
  Build deterministic timeline relationships and routes.

src/archive/safe-markdown.ts
  Render the supported Markdown token allowlist safely.

src/archive/chronicle-runtime.ts
  Export the self-contained client runtime string for routing, search, minimap, focus, and motion.

src/archive/html-renderer.ts
  Compose the static document and visual components.
```

No new package dependency is required.

## 14. Testing Strategy

### Model tests

- INDEX dates sort deterministically while preserving visible range labels.
- ADRs attach to referencing INDEX items without duplicate standalone nodes.
- Bugs attach to the earliest exact BUG-ID reference.
- Missing bug dates enter `Undated`.
- Entity cross-links reject partial-token matches.

### Markdown safety tests

- Supported Markdown renders expected semantic HTML.
- Raw HTML and scripts remain escaped.
- `javascript:` and other unsafe link schemes never become anchors.
- Project-controlled content never appears in executable script context.

### Renderer tests

- Chronicle, minimap, command palette, details, routes, and source integrity render.
- Identical normalized input produces byte-identical HTML.
- No client-side `innerHTML` assignment exists.
- Mobile CSS prevents horizontal overflow.
- Reduced-motion CSS and runtime branches are present.

### Browser tests

- Desktop and 390px mobile have `scrollWidth === clientWidth`.
- `#adr/ADR-005` and `#bug/BUG-007` open correct detail states.
- Browser Back restores scroll, query, filters, and focus.
- Keyboard-only command palette navigation works.
- Reduced-motion mode disables spatial animation.
- Search and type/status filters update both timeline and minimap.

## 15. Acceptance Criteria

1. The default view presents project history as a vertical chronological timeline.
2. The minimap permits rapid non-linear jumps without horizontal page scrolling or scroll-jacking.
3. ADR and bug relationships appear at deterministic development dates.
4. Unknown bug dates are labeled `Undated` rather than guessed.
5. Clicking an ADR or bug opens a deep-linked detail state in the same HTML document.
6. Browser Back restores the exact previous chronicle context.
7. Command search is keyboard accessible and can open any timeline, ADR, or bug entity.
8. Markdown detail content is safely rendered with no raw HTML execution.
9. Motion is smooth, interruptible, transform/opacity-based, and fully reduced-motion aware.
10. Desktop and mobile render without horizontal overflow.
11. The generated file remains deterministic, self-contained, offline-capable, and dependency-free at runtime.
12. Existing ArchiveService validation and source-hash behavior remain intact.

## 16. Non-goals

- Editing Markdown from the dashboard.
- Hosted APIs, authentication, or a database.
- WebGL, Canvas-only navigation, or a graph physics engine.
- Scroll-jacking or mandatory horizontal scrolling.
- Guessing missing dates from file order or Git timestamps.
- Loading remote fonts, icons, analytics, or runtime assets.
