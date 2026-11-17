# Paper Atlas Implementation Plan

> **For agentic workers:** Execute this presentation-only plan inline; verify with the existing tests and browser inspection. Preserve the user's existing work.

**Goal:** Redesign the existing frontend around a cool-white and mist-blue centered hero while preserving all functions and the animated map. The user rejected yellow and requested a richer lower introduction.

**Architecture:** Keep the `Welcome.onEnter(Scene)` contract and existing Zustand state. Reuse `WelcomeMap` lifecycle and animation clock, changing only layout and presentation. Theme the existing working panels through the app stylesheet.

**Tech Stack:** React 18, TypeScript, Vite, Mapbox GL, CSS.

**Spec:** `docs/superpowers/specs/2026-11-07-paper-atlas-design.md`

## Global Constraints

- Archive all current frontend source including uncommitted changes before edits.
- Chinese UI; retain 生活半径 brand and all three scenes.
- Retain four-stage map animation, pause, replay, error/retry, attribution, reduced motion.
- No new dependencies or changes to providers and geometry algorithms.

## Review Focus

- Glass card must route to the selected real scene.
- Wide map camera must also frame both places on a narrow screen.
- Loading and error messages must remain legible without hiding the entry card.
- Mobile navigation and bottom drawers must fit without horizontal scrolling.
- Reduced motion and keyboard navigation must remain usable.

## Tasks

- [x] Archive the current source in `archives/2026-11-07-before-redesign/`, with patch and restore instructions.
- [x] Rebuild `src/components/Welcome.tsx` and `Welcome.css`: centered hero, brand, three-scene launcher, responsive layout.
- [x] Restyle `WelcomeMap.css` and presentation values in `WelcomeMap.tsx`: cool light map, preserve clock/data, fit camera to responsive stage.
- [x] Consolidate `src/App.css` into the cool working theme and update `index.html` metadata.
- [x] Add `WelcomeGuide.tsx` and `WelcomeGuide.css`: three steps, three illustrated use cases with real scene navigation, and FAQ disclosures.
- [x] Run `npm test -- --reporter=dot`, `npm run build`, check desktop/mobile and animation controls in the browser, review against the pre-change snapshot.

## Execution record

Baseline source archived before any product edits. The work stays in the existing feature checkout because it contains the current user-visible version and uncommitted work; the snapshot makes the original reviewable and recoverable.

Final verification:

- 284/284 tests across 37 files passed. Local Node 18 needs `NODE_OPTIONS=--experimental-global-webcrypto`; the pre-change baseline had four failures without that flag. Existing CI uses Node 22. No production crypto changes were made.
- `npm run build` passed TypeScript and Vite production bundling. Existing large-bundle warning remains; no dependencies were added.
- `git diff --check` passed after normalizing file endings.
- Browser checked 1440px desktop, 768px tablet, approximately 390px and 320px mobile. Document width stayed within viewport; launcher choices and all case cards fit. Mobile working drawer collapses correctly.
- Verified commute launcher, exploration and isochrone guide CTAs, return to homepage, FAQ expansion, replay reset to scene 0, manual scene switching, and frozen progress while paused. All four scenes and the real common range appeared in the browser.
- Independent final review found attribution clipping and insufficient muted-text contrast. Both fixed: Mapbox control container now fills the map frame (verified 490px vs previous 0px), and essential muted text is `#5b6f7c` (4.71:1 on the soft surface, 4.96:1 on the page); guide paragraphs are larger.
- Review scope decisions: exact camera and drawer rendering were verified by parent browser QA; existing providers and business algorithms were preserved byte-for-byte from the archived snapshot; the reference was treated as visual direction, not a pixel-copy requirement.
- Archived SHA-256 rechecked unchanged. Only six existing product files differ from the archived source, plus the two new guide files. Original unrelated changes remain intact.
- Saved screenshots: `docs/assets/redesign-2026-11-07/homepage.jpg` and `guide.jpg`. Preview remains at `http://127.0.0.1:5173/`.

## Follow-up: restore the original Mapbox presentation

The user reported that the map animation appeared lost. The redesign had converted the original dark foreground animation into a low-contrast background under gradients. Restored WelcomeMap from the pre-redesign archive, retaining its four scenes, clock, original map style, colors and range calculations. The map now has an independent visible frame and a homepage anchor link; narrow-screen camera padding is adapted. The cool homepage and expanded guide remain. The intermediate background version is retained in archives/2026-11-07-before-redesign/map-background-version.

The preview server was also stopped and has been restarted on 127.0.0.1:5173. Verified automatic advance from scene 0 to 1, actual shared-area result in scene 3, and pause/resume. Production build and 14 story tests passed. Unrelated local-engine work in the checkout was preserved.

## Follow-up: typography (2026-11-07)

Headings use self-hosted Noto Serif SC 500; body text uses Noto Sans SC 400/500. Both are subsets in `public/fonts/` (OFL), and no Google Fonts requests are made at runtime. Bold weights were reduced to 500. Pre-change copies are in `archives/2026-11-07-before-redesign/before-typography/` and `before-font-family/`. Screenshots: `typography-home.jpg`, `typography-guide.jpg` and `refined-fonts.jpg`.

## Follow-up: computed example cards, plainer copy, colour (2026-11-08)

- The three use-case cards now draw live results on their maps (`src/welcome/casePreview.ts`). These replace the earlier hand-set routes and times:
  - Commute: Amap transit routes and durations from 大冲新城花园 and 南山花园 to 腾讯大厦.
  - Meeting: 30-minute cycling ranges from the two story places, plus their intersection.
  - Explore: a 15-minute walking range from 红树湾地铁站, plus real places whose walking route fits within 15 minutes.

  A failed query shows as failed or partial; nothing is filled in with sample data. Queries start when a card nears the viewport and are aborted on unmount. Covered by 5 tests in `casePreview.test.ts`.
- Internal wording was removed from the homepage and the commute, comparison and explore panels: 核验, cache times, query counts and timestamps. Data sources moved into collapsed details.
- Green text was removed at the user's request. Navy + coral (`--type-accent: #a54d50`) was tried next; after viewing it the user replied 「還可以」 ("it's fine"), so it stays.
  - The explore card's map overlays follow the accent.
  - The pass badge, the transit 查看地图 link and the local-engine card use the mist-blue working theme.
  - The restored hero animation keeps its original colours, including the mint highlight on 30 分钟. Map data colours are unchanged (cycling range, metro lines, transit fallbacks).
- Chips drawn over the card maps use `system-ui`, so live text never depends on the font subset. The subset lacked 红 and 树 from 红树湾.
- Verified: typecheck, 299/299 tests (Node 18 with `--experimental-global-webcrypto`), the production build, and a live explore query in the browser (all overlay colours coral). Computed styles across the three app views showed no green text. The screenshots in `docs/assets/case-preview/` predate the colour change.
