# Landing page fonts

Noto Serif SC (500) and Noto Sans SC (400, 500), obtained from Google Fonts.
Licensed under SIL Open Font License 1.1; licenses are included beside the files.

These locally served subsets contain the characters in Welcome.tsx and WelcomeGuide.tsx at generation time, including Latin UI text. When adding new copy, regenerate the subsets or add the missing glyphs; unsupported characters use the declared system fallback. No runtime Google Fonts requests are made.

The chips and details drawn over the example-card maps (location label, result readout, partial-result badge, place details and retry) deliberately use `system-ui`, because their text comes from live queries and cannot be known when the subset is generated. Text there does not need to be in the subset.
