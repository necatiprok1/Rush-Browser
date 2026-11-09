# Rush Browser

A desktop browser experiment built with **Electron**, focused on productivity, customization, privacy-oriented controls, and smarter browsing workflows.

## Overview

Rush Browser explores a more customizable desktop browsing experience through features documented in this repository.

### Highlights

- **Workspace management** — organize browsing sessions into separate workspaces
- **Vertical tabs** — an alternative tab layout
- **Reading mode** — simplify page presentation for focused reading
- **Developer tools** — additional debugging and performance-inspection workflows
- **Extension support** — experimental Chrome-extension compatibility
- **Privacy controls** — tracker filtering and privacy-related reporting
- **Smart browsing experiments** — preloading, search suggestions, and page summarization workflows

> Feature availability and maturity may vary. Some documented integrations are experimental or placeholders; consult the source code and implementation notes before relying on them.

## Tech stack

- Electron
- JavaScript
- Node.js
- electron-store
- keytar

## Getting started

### Requirements

- Node.js
- npm
- A supported desktop environment for Electron

### Install

```bash
git clone https://github.com/necatiprok1/Rush-Browser.git
cd Rush-Browser
npm install
```

### Run in development

```bash
npm start
```

### Available checks

```bash
npm test
npm run lint
```

Both checks currently run a Node.js syntax check against `main.js`.

## Project files

```text
.
├── main.js
├── preload.js
├── index.html
├── search.html
├── settings.html
├── downloads.html
├── overlay.html
├── style.css
├── AI_SMART_FEATURES.md
├── IMPLEMENTATION_SUMMARY.md
├── PERFORMANCE_OPTIMIZATIONS.md
├── SECURITY_PRIVACY_OPTIMIZATIONS.md
└── RUN_AND_TEST.md
```

Implementation notes and test instructions are kept as Markdown files in the repository root.

## Security

- Do not commit API keys, passwords, browser profile data, or local secrets.
- Review permissions and Electron security settings before distributing builds.
- Report security concerns privately to the maintainer rather than publishing exploit details.

## Project status

Rush Browser is an evolving project. The repository's implementation notes describe completed experiments as well as placeholders and possible future work. The README intentionally avoids presenting every documented idea as a production-ready feature.

---

<div align="center">
  <sub>Rush Browser · An independent desktop browser project</sub>
</div>
