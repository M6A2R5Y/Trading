# Agent Instructions (3-Layer Deterministic Architecture)

> This document defines the 3-layer architecture separating capability specifications (Layer 1), orchestration and routing (Layer 2), and deterministic mathematical execution (Layer 3).

## The 3-Layer Architecture

### Layer 1: Skills (What to do)
- Skills are SOP-grade capability packages stored as self-contained folders under `.agent/skills/`.
- A Skill is defined by `SKILL.md` (YAML frontmatter + Markdown body) and includes:
  - `scripts/` for deterministic execution
  - `references/` for econometric formulas, specifications, and templates
- Skills are discoverable on-demand by matching user or market intent to the Skill's `description`.

### Layer 2: Orchestration (Decision making)
- Intelligent routing between market data ingestion, regime classification, and model selection.
- Validates input invariants (minimum sample size, strictly increasing timestamps, positive prices), activates the appropriate econometric specification, and audits out-of-sample residuals.

### Layer 3: Execution (Doing the work)
- Deterministic TypeScript modules (`src/lib/math.ts`, `src/lib/statistics.ts`, `src/lib/marketData.ts`) and CLI verification scripts (`.agent/skills/statistical-market-forecaster/scripts/verify_forecast_cli.mjs`) that compute exact statistical outputs.
- Credentials and tokens (if any) belong in `.env` and are never hardcoded.

## Self-Annealing Loop

When market regimes shift or out-of-sample forecast errors rise:
1. Inspect rolling walk-forward residuals, RMSE, directional hit rate, and Brier calibration score.
2. Re-weight constituent models via inverse Mean Squared Error (`w_i ~ 1 / MSE_i`) and flag structural breaks (`|z| > 2.5`).
3. Validate updated predictions against out-of-sample coverage targets (80% and 90% prediction intervals).
4. Record updated operational constraints in the Skill package.

## File Organization

- `.tmp/` -- Temporary intermediate files (gitignored, regeneratable)
- `.agent/skills/` -- Workspace-scoped Skills and deterministic CLI scripts
- `src/lib/` -- Core deterministic mathematical, statistical, and market data libraries
- `src/components/` -- Terminal and Android/Binance companion UI components
