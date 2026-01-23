# Task: Migrate/Fix SQLite Persistence

## Context

The user reports data loss (configuration, etc.) when changing browsers or updating. This implies data is either stored in Client LocalStorage or not persisted properly on the Server. The goal is to ensure all data is running on SQLite and persisted.

## Current Focus

Analyzing the current implementation and planning the fix.

## Master Plan

- [x] Analyze Backend (`server`) for current storage (found `database.js` with SQLite). <!-- id: 0 -->
- [x] Analyze Frontend (`client`) to see if it uses API or LocalStorage for settings. <!-- id: 1 -->
- [x] Create Implementation Plan to enforce SQLite usage and fix persistence. <!-- id: 2 -->
- [x] Execute Fixes:
  - [x] Update Frontend to sync settings with Backend. <!-- id: 3 -->
  - [x] Ensure Docker volume configuration persists `server/data`. <!-- id: 4 -->
- [x] Verify persistence (Simulate browser change/restart). <!-- id: 5 -->

## Progress Log

- [x] Backend analysis: `database.js` has SQLite logic. `server/data` missing on host.
