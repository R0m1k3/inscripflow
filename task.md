# Task: Activate BMad Master Agent

## Context

The user wants to activate the `bmad-master` agent using the definition in `_bmad/core/agents/bmad-master.md`. This involves loading the configuration, adopting the persona, and presenting the agent's menu.

## Current Focus

Executing Party Mode Workflow.

## Master Plan

- [x] Load and parse `_bmad/core/config.yaml`.
- [x] Store session variables (`user_name`, `communication_language`, `output_folder`).
- [x] Adopt `bmad-master` persona.
- [x] Display greeting and menu in the specified language.
- [x] Wait for user input.
- [x] Read `_bmad/core/workflows/party-mode/workflow.md`.
- [x] Read `_bmad/_config/agent-manifest.csv`.
- [x] Read `_bmad/core/workflows/party-mode/steps/step-02-discussion-orchestration.md`.
- [x] Activate Party Mode (Send welcome message).
- [x] Initiate discussion on Cloudflare bypass solutions.
- [x] Analyze `forum-sniper` code for config and scraping logic.
- [x] Add `flaresolverr_url` input to `client/src/App.jsx`.
- [x] Update `server/src/index.js` to save `flaresolverr_url`.
- [x] Implement `solveCloudflare` in `server/src/worker.js`.

## Progress Log

- [x] Task created.
- [x] Read agent definition.
- [x] Activated BMad Master.
- [x] User selected Party Mode.
