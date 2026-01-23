# Task: Fix Mixed Content & API Connection Issues

## Context

The user is accessing the application via HTTPS (`https://snip.vonrodbox.eu/`), but the frontend is trying to connect to the backend via insecure HTTP (`http://192.168.1.16:4010`). Browsers block this as "Mixed Content".

## Current Focus

Diagnosing the deployment configuration and fixing the API URL to support HTTPS.

## Master Plan

- [ ] Analyze `docker-compose-unraid.yml` (if applicable) and current env vars. <!-- id: 0 -->
- [ ] Determine correct `VITE_API_URL` configuration (`/` relative request or HTTPS URL). <!-- id: 1 -->
- [ ] Update Frontend/Docker configuration to support HTTPS or relative paths. <!-- id: 2 -->
- [ ] Configure Proxy (Nginx/Traefik) if necessary (User guidance). <!-- id: 3 -->

## Progress Log

- [x] Task created.
