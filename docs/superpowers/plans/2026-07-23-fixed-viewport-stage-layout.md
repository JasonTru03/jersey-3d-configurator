# Fixed Viewport 3D Stage Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the full jersey centered in a stable first-screen 3D stage while long desktop configuration panels scroll internally.

**Architecture:** Constrain only the existing wide two-column shell to the dynamic viewport and propagate `min-height: 0` through the grid so its children can shrink. The right panel owns vertical overflow; the existing `1040px` single-column breakpoint restores normal document flow.

**Tech Stack:** React 19, CSS Grid, Three.js, Vitest, Codex in-app browser.

---

### Task 1: Lock the desktop layout contract with TDD

**Files:**
- Create: `src/features/configurator/ui/configuratorLayout.test.js`
- Modify: `src/features/configurator/ui/configurator.css`

- [x] **Step 1: Write the failing CSS contract test**

Create `src/features/configurator/ui/configuratorLayout.test.js`:

```js
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/features/configurator/ui/configurator.css'),
  'utf8',
);

function ruleBody(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`Missing CSS rule: ${selector}`);
  return match[1].replace(/\s+/g, ' ');
}

describe('wide configurator viewport layout', () => {
  it('keeps the stage in one viewport and gives overflow to the right panel', () => {
    expect(ruleBody(css, '.configurator-shell')).toContain('height: 100dvh');
    expect(ruleBody(css, '.configurator-shell')).toContain('overflow: hidden');
    expect(ruleBody(css, '.workspace')).toContain('min-height: 0');
    expect(ruleBody(css, '.workspace')).toContain('overflow: hidden');
    expect(ruleBody(css, '.workspace-grid')).toContain('overflow: hidden');
    expect(ruleBody(css, '.stage-wrap')).toContain('min-height: 0');
    expect(ruleBody(css, '.config-panel')).toContain('overflow-y: auto');
  });

  it('restores document flow at the existing single-column breakpoint', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 1040px)'));
    expect(ruleBody(narrow, '.configurator-shell')).toContain('height: auto');
    expect(ruleBody(narrow, '.configurator-shell')).toContain('overflow: visible');
    expect(ruleBody(narrow, '.workspace')).toContain('overflow: visible');
    expect(ruleBody(narrow, '.workspace-grid')).toContain('overflow: visible');
    expect(ruleBody(narrow, '.stage-wrap')).toContain('min-height: 560px');
    expect(ruleBody(narrow, '.config-panel')).toContain('overflow: visible');
  });
});
```

- [x] **Step 2: Run the focused test and verify red**

Run:

```powershell
npm test -- --run src/features/configurator/ui/configuratorLayout.test.js
```

Expected: both tests fail because the wide shell is not height-constrained and the breakpoint does not restore document flow.

- [x] **Step 3: Add the minimal wide-layout constraints**

Update the existing rules in `configurator.css`:

```css
.configurator-shell {
  height: 100vh;
  height: 100dvh;
  min-height: 100vh;
  overflow: hidden;
}

.workspace {
  min-height: 0;
  overflow: hidden;
}

.workspace-grid {
  overflow: hidden;
}

.stage-wrap {
  min-height: 0;
}

.config-panel {
  overflow-x: hidden;
  overflow-y: auto;
}
```

Inside `@media (max-width: 1040px)`, add:

```css
.configurator-shell {
  height: auto;
  overflow: visible;
}

.workspace,
.workspace-grid {
  overflow: visible;
}

.stage-wrap {
  min-height: 560px;
}

.config-panel {
  overflow: visible;
}
```

Keep the existing `@media (max-width: 720px)` stage minimum of `420px`.

- [x] **Step 4: Run the focused test and verify green**

Run:

```powershell
npm test -- --run src/features/configurator/ui/configuratorLayout.test.js
```

Expected: 1 test file and 2 tests pass.

### Task 2: Verify the real Size-to-Template transition

**Files:**
- Modify: `project-logs/changes/2026-07-23-fixed-viewport-stage-layout.md`

- [x] **Step 1: Start the local application**

Run:

```powershell
npm run dev -- --host 127.0.0.1
```

- [x] **Step 2: Capture Size metrics at `1908 × 942`**

Record:

- `window.innerHeight`;
- document scroll height;
- `.stage-wrap` width and height;
- `.config-panel` client height and scroll height.

Expected: document height equals `942px`; stage fits within the first viewport.

- [x] **Step 3: Open Template and capture the same metrics**

Expected:

- document height stays `942px`;
- stage width and height match Size;
- panel client height matches the available row height;
- panel scroll height is greater than client height;
- the full jersey remains centered.

- [x] **Step 4: Exercise 3D controls**

Check Orbit view, Top view, Detail view, mouse orbit, and wheel zoom. Expected: the controls still update the model view without changing the document layout.

- [x] **Step 5: Record evidence**

Create `project-logs/changes/2026-07-23-fixed-viewport-stage-layout.md` with the before/after measurements, root cause, changed files, and visual result.

### Task 3: Run repository verification and checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-07-23-fixed-viewport-stage-layout.md`
- Modify: `project-logs/changes/2026-07-23-fixed-viewport-stage-layout.md`

- [x] **Step 1: Run full verification**

```powershell
npm test -- --run
npm run build
git diff --check
```

Expected:

- 37 test files and 221 tests pass;
- application and Shopify builds exit zero;
- only the existing large-chunk and `inlineDynamicImports` warnings remain;
- no whitespace errors.

- [ ] **Step 2: Commit the verified fix**

```powershell
git add src/features/configurator/ui/configurator.css `
  src/features/configurator/ui/configuratorLayout.test.js `
  docs/superpowers/plans/2026-07-23-fixed-viewport-stage-layout.md `
  project-logs/changes/2026-07-23-fixed-viewport-stage-layout.md
git commit -m "fix: keep 3d stage within desktop viewport"
```

- [ ] **Step 3: Push both Git remotes and read back**

```powershell
git push origin codex/continuous-bottom-pattern
git push backup codex/continuous-bottom-pattern
git ls-remote --heads origin codex/continuous-bottom-pattern
git ls-remote --heads backup codex/continuous-bottom-pattern
```

Expected: local, origin, and backup hashes match.

### Task 4: Deploy and verify the Worker

**Files:**
- Modify: `project-logs/changes/2026-07-23-fixed-viewport-stage-layout.md`

- [ ] **Step 1: Deploy the verified build**

Run the repository's existing Cloudflare Worker deployment command.

Expected: Wrangler reports a new deployment version for `jersey-3d-configurator`.

- [ ] **Step 2: Read back the deployed entry assets**

Open the Worker with a cache-busting query and record its JavaScript and CSS asset names.

- [ ] **Step 3: Repeat the browser acceptance**

At `1908 × 942`, repeat the Size-to-Template measurements on the deployed Worker.

Expected: document and stage dimensions remain stable, the full jersey stays centered, and Template owns the vertical scroll.

- [ ] **Step 4: Update the log and create the deployment checkpoint**

Record the Worker version, asset names, live metrics, and verification result. Commit and push the log update to both remotes.
