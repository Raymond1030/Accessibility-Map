# Landing page fonts

Noto Sans SC (思源黑体) in four weights — 400 body, 500 labels and buttons, 700 subheadings, 900 headlines — obtained from Google Fonts. Licensed under SIL Open Font License 1.1; the license is included beside the files.

These locally served subsets contain only the characters used in `Welcome.tsx`, `WelcomeGuide.tsx` and `WelcomeMap.tsx` (comments excluded), plus printable ASCII and common Chinese punctuation. No runtime Google Fonts requests are made.

After changing homepage copy, regenerate the subsets:

```bash
node scripts/make-landing-fonts.mjs
```

The script asks the Google Fonts CSS2 API for each weight with the `text=` parameter, which returns a WOFF2 file containing exactly those glyphs, and writes them here. Characters missing from a subset fall back to the declared system fonts.

The chips and details drawn over the example-card maps (location label, result readout, partial-result badge, place details and retry) deliberately use `system-ui`, because their text comes from live queries and cannot be known when the subset is generated.
