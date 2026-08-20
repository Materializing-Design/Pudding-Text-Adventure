#!/usr/bin/env node
// Regenerates index.html from whatever build folders exist in builds/.
// Run after adding or removing a build:  node scripts/generate-index.mjs

import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildsDir = join(root, "builds");

// Project name, author, and description live in config.json so the copy can be
// edited without touching this template.
const config = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));

for (const field of ["name", "author"]) {
  if (!config[field]?.trim()) {
    console.error(`config.json is missing a non-empty "${field}"`);
    process.exit(1);
  }
}

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const projectName = escapeHtml(config.name);
const projectAuthor = escapeHtml(config.author);
// description is optional — omit it from config.json and the paragraph is left out.
const projectDescription = config.description?.trim()
  ? escapeHtml(config.description.trim())
  : null;

// A build folder is named YYYY-MM-DD. When more than one build lands on the same day,
// it carries either a 24-hour time (YYYY-MM-DD-HHMM, or -HHMMSS to the second; "T"
// works as the separator too) or a plain sequence number (YYYY-MM-DD-1, -2, …).
//
// Both forms exist across the repos generated from this template, so both are
// supported: dropping the sequence form would silently delete those builds from their
// index. The digit count disambiguates — 4 or 6 digits is a time, 1 or 2 a sequence.
// A folder with neither counts as that day's earliest build.
const BUILD_NAME =
  /^(\d{4})-(\d{2})-(\d{2})(?:[-T](\d{2})(\d{2})(\d{2})?|-(\d{1,2}))?$/;

function parseBuildName(name) {
  const match = BUILD_NAME.exec(name);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, sequence] = match;
  const at = new Date(
    `${year}-${month}-${day}T${hour ?? "00"}:${minute ?? "00"}:${second ?? "00"}Z`
  );
  // The pattern alone still admits impossible values (2017-02-30, 25:70), which Date
  // either rejects outright or silently rolls over into the next day.
  if (Number.isNaN(at.getTime()) || !at.toISOString().startsWith(`${year}-${month}-${day}T`)) {
    return null;
  }
  return {
    name,
    at,
    hasTime: hour !== undefined,
    hasSeconds: second !== undefined,
    // Sorts sequenced builds within their day; 0 keeps an unnumbered folder first.
    sequence: sequence === undefined ? 0 : Number(sequence),
  };
}

const directories = readdirSync(buildsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const unrecognized = directories.filter((name) => parseBuildName(name) === null);
if (unrecognized.length > 0) {
  console.error(
    `Skipping folders that aren't named YYYY-MM-DD[-HHMM|-N]: ${unrecognized.join(", ")}`
  );
}

const builds = directories
  .map(parseBuildName)
  .filter(Boolean)
  // Newest first. Comparing timestamps rather than strings keeps mixed naming
  // (2017-07-02 alongside 2017-07-02-1430) in true chronological order; sequence
  // breaks the tie between same-day builds that carry no time.
  .sort((a, b) => b.at - a.at || b.sequence - a.sequence || b.name.localeCompare(a.name));

if (builds.length === 0) {
  console.error("No dated build folders found in builds/");
  process.exit(1);
}

const missing = builds.filter((b) => !existsSync(join(buildsDir, b.name, "index.html")));
if (missing.length > 0) {
  console.error(`Skipping builds with no index.html: ${missing.map((b) => b.name).join(", ")}`);
}

const listed = builds.filter((b) => !missing.includes(b));

const longDate = (at) =>
  at.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

const clockTime = (build) =>
  build.at.toLocaleTimeString("en-CA", {
    hour: "2-digit",
    minute: "2-digit",
    ...(build.hasSeconds ? { second: "2-digit" } : {}),
    hour12: false,
    timeZone: "UTC",
  });

const items = listed
  .map(
    (build) => `        <li>
          <a href="builds/${build.name}/index.html">
            <span class="when">
              <span class="date">${longDate(build.at)}</span>${
                build.hasTime
                  ? `\n              <span class="time">${clockTime(build)}</span>`
                  : build.sequence
                    ? `\n              <span class="time">#${build.sequence}</span>`
                    : ""
              }
            </span>
            <span class="iso">${build.name}</span>
          </a>
        </li>`
  )
  .join("\n");

// Calendar dates only — the range reads as a span of days even when the individual
// builds within it carry times.
const first = listed[listed.length - 1].name.slice(0, 10);
const last = listed[0].name.slice(0, 10);
const dayCount = new Set(listed.map((b) => b.name.slice(0, 10))).size;

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// A fresh template repo can sit at a single build, where "1 builds · X to X" reads
// badly, so both the count and the range collapse to their singular forms.
const dateRange = first === last ? first : `${first} to ${last}`;
const buildSummary =
  dayCount === listed.length
    ? plural(listed.length, "build")
    : `${plural(listed.length, "build")} across ${plural(dayCount, "day")}`;

const html = `<!DOCTYPE html>
<!-- Generated by scripts/generate-index.mjs — edit that file, not this one. -->
<html lang="en">

<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${projectName} | Materializing Design</title>
  <meta name="description"
    content="${projectName} by ${projectAuthor} — an archive of ${buildSummary}, ${dateRange}.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;700&family=JetBrains+Mono:wght@400;600;700&display=swap">
  <style>
    /* Palette and type mirror the main site's theme engine (globals.css / layout.tsx).
       If a token changes there, change it here too. */
    :root {
      --coral: #E95F58;
      --ink: #2C2C2A;
      --white: #FFFFFF;
      --parchment: #F1EFE8;
      --stone: #8A8A8A;
      --background: #EEE;
      --font-heading: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      --font-body: "Archivo", system-ui, sans-serif;
    }

    * { box-sizing: border-box; }

    html { scroll-behavior: smooth; }

    body {
      margin: 0;
      background-color: var(--background);
      color: var(--ink);
      font-family: var(--font-body);
      -webkit-font-smoothing: antialiased;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    a { text-decoration: none; }

    /* ── Header ─────────────────────────────────────────────────────────────── */
    .site-header { width: 100%; padding: 1.5rem 1.5rem 1rem; }

    .site-header .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem 1rem;
    }

    .site-header img { width: 240px; max-width: min(240px, 60vw); height: auto; }

    .repo-name {
      font-family: var(--font-heading);
      font-weight: 700;
      font-size: 0.875rem;
      color: var(--ink);
      transition: color 0.15s;
    }

    a.repo-name:hover { color: var(--coral); }

    /* ── Main ───────────────────────────────────────────────────────────────── */
    main {
      flex: 1;
      width: 100%;
      max-width: 72rem;
      margin: 0 auto;
      padding: 2.5rem 1.5rem;
    }

    h1 {
      font-family: var(--font-heading);
      font-weight: 700;
      font-size: 1.875rem;
      color: var(--ink);
      margin: 0 0 0.5rem;
    }

    .subtitle {
      font-family: var(--font-heading);
      font-size: 0.875rem;
      color: var(--stone);
      margin: 0 0 1rem;
    }

    .lede {
      font-size: 0.9375rem;
      color: var(--stone);
      max-width: 44rem;
      line-height: 1.7;
      margin: 0 0 2.5rem;
    }

    /* The top margin only takes effect when there's no description above to collapse
       against, so the list keeps its spacing either way. */
    .build-count {
      font-family: var(--font-heading);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--stone);
      margin: 2.5rem 0 0.75rem;
    }

    /* ── Build list ─────────────────────────────────────────────────────────── */
    ul.builds {
      list-style: none;
      margin: 0;
      padding: 0;
      max-width: 44rem;
      border-top: 1px solid rgba(138, 138, 138, 0.2);
    }

    ul.builds li { border-bottom: 1px solid rgba(138, 138, 138, 0.2); }

    ul.builds a {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.75rem 0.25rem;
      color: var(--ink);
      transition: color 0.15s, background-color 0.15s;
    }

    ul.builds a:hover,
    ul.builds a:focus-visible { color: var(--coral); background: rgba(255, 255, 255, 0.6); }

    ul.builds a:focus-visible { outline: 2px solid var(--coral); outline-offset: -2px; }

    .when {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.125rem 0.625rem;
      min-width: 0;
    }

    .date { font-size: 0.9375rem; }

    ul.builds a:hover .date { text-decoration: underline; }

    .time {
      font-family: var(--font-heading);
      font-size: 0.75rem;
      color: var(--stone);
    }

    .iso {
      flex-shrink: 0;
      font-family: var(--font-heading);
      font-size: 0.75rem;
      color: var(--stone);
    }

    /* ── Footer ─────────────────────────────────────────────────────────────── */
    .site-footer {
      width: 100%;
      border-top: 1px solid rgba(138, 138, 138, 0.2);
      margin-top: 5rem;
      padding: 2.5rem 1.5rem;
    }

    .site-footer .inner {
      max-width: 72rem;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: flex-start;
      gap: 2rem;
    }

    @media (min-width: 768px) {
      .site-header, main, .site-footer { padding-left: 2.5rem; padding-right: 2.5rem; }
      .site-footer .inner { flex-direction: row; align-items: center; }
    }

    .foot-links { display: flex; gap: 2.5rem; font-size: 0.875rem; }

    .foot-col { display: flex; flex-direction: column; gap: 0.375rem; }

    .foot-col p {
      font-family: var(--font-heading);
      font-weight: 700;
      color: var(--ink);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin: 0 0 0.25rem;
    }

    .foot-col a { color: var(--stone); transition: color 0.15s; }

    .foot-col a:hover { color: var(--coral); }

    .foot-logos {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 1.5rem;
      min-width: 0;
    }

    /* Wraps as well as rows: side by side these two are ~565px, which overflows a
       768px viewport once the link columns sit beside them. */
    @media (min-width: 640px) {
      .foot-logos { flex-direction: row; flex-wrap: wrap; align-items: center; }
    }

    .foot-logos img { height: auto; object-fit: contain; max-width: 100%; }

    .foot-logos .sshrc { width: 400px; }

    .foot-logos .concordia { width: 140px; }
  </style>
</head>

<body>
  <header class="site-header">
    <div class="row">
      <a href="https://materializing.design/">
        <img src="assets/MD_logo.svg" alt="Materializing Design">
      </a>
      <a class="repo-name" href="https://github.com/Materializing-Design/Pudding">Pudding</a>
    </div>
  </header>

  <main>
    <h1>${projectName}</h1>
    <p class="subtitle">${projectAuthor}</p>
${projectDescription ? `    <p class="lede">${projectDescription}</p>\n` : ""}
    <p class="build-count">${buildSummary} &middot; ${dateRange}</p>

    <ul class="builds">
${items}
    </ul>
  </main>

  <footer class="site-footer">
    <div class="inner">
      <div class="foot-links">
        <div class="foot-col">
          <p>MDM</p>
          <a href="https://materializing.design/mdm">Method</a>
          <a href="https://materializing.design/design-archive">Archive</a>
          <a href="https://materializing.design/analyses">Analyses</a>
          <a href="https://materializing.design/guides-and-tools">Guides</a>
        </div>
        <div class="foot-col">
          <p>Connect</p>
          <a href="mailto:hello@materializing.design">Email</a>
          <a href="https://github.com/Materializing-Design" target="_blank" rel="noreferrer">GitHub</a>
          <a href="https://materializing.design/about">About</a>
        </div>
      </div>
      <div class="foot-logos">
        <img class="sshrc" src="assets/SSHRC_logo.svg"
          alt="Social Sciences and Humanities Research Council of Canada">
        <img class="concordia" src="assets/Concordia_logo.svg" alt="Concordia University">
      </div>
    </div>
  </footer>
</body>

</html>
`;

writeFileSync(join(root, "index.html"), html);
console.log(`Wrote index.html with ${buildSummary} (${dateRange}).`);
