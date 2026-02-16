import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { checkTarget } from './worker.js';
import { configureAI } from './aiService.js';
import { analyzeUrl } from './analyzer.js';
import { startRedditMonitor, getRedditStats } from './services/reddit.js';
import { getAllTargets, upsertTarget, deleteTarget, getSettings, saveSettings } from './database.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Load targets from DB with error handling
let targets = [];
try {
  targets = getAllTargets();
  console.log(`[DB] Loaded ${targets.length} targets from database`);
} catch (err) {
  console.error('[DB] Failed to load targets:', err);
}

// STARTUP FIX: Reset any targets stuck in CHECKING to IDLE
let dirty = false;
targets.forEach(t => {
  if (t.status === 'CHECKING') {
    console.log(`[STARTUP] Resetting stuck target ${t.url} from CHECKING to IDLE`);
    t.status = 'IDLE';
    try { upsertTarget(t); } catch (e) { console.error('[DB] upsertTarget failed:', e); }
  }
});

// Load Settings from DB with error handling
let settings = {
  openRouterKey: '',
  flaresolverr_url: '',
  defaultPseudo: '',
  defaultEmail: '',
  defaultPassword: ''
};
try {
  settings = { ...settings, ...getSettings() };
  console.log('[DB] Loaded settings from database');
} catch (err) {
  console.error('[DB] Failed to load settings:', err);
}

configureAI(settings.openRouterKey, settings.model);

// Routes with error handling
app.get('/api/targets', (req, res) => {
  try {
    res.json(targets);
  } catch (err) {
    console.error('[API] GET /api/targets error:', err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', targets: targets.length, dbConnected: true });
});

app.post('/api/targets', (req, res) => {
  try {
    const newTarget = {
      id: Date.now().toString(),
      url: req.body.url,
      pseudo: req.body.pseudo || settings.defaultPseudo || `AutoUser_${Math.floor(Math.random() * 1000)}`,
      email: req.body.email || settings.defaultEmail || '',
      password: req.body.password || settings.defaultPassword || '',
      status: 'IDLE', // IDLE, CHECKING, OPEN, REGISTERED, ERROR
      logs: [],
      lastCheck: null,
      forumType: null,
      robotsInfo: {},
      invitationCodes: []
    };
    targets.push(newTarget);
    upsertTarget(newTarget);
    io.emit('targets_updated', targets);
    res.json(newTarget);
  } catch (err) {
    console.error('[API] POST /api/targets error:', err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

app.delete('/api/targets/:id', (req, res) => {
  try {
    targets = targets.filter(t => t.id !== req.params.id);
    deleteTarget(req.params.id);
    io.emit('targets_updated', targets);
    res.json({ success: true });
  } catch (err) {
    console.error('[API] DELETE /api/targets error:', err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

app.post('/api/settings', (req, res) => {
  const updates = {};
  if (req.body.openRouterKey !== undefined) updates.openRouterKey = req.body.openRouterKey;
  if (req.body.model !== undefined) updates.model = req.body.model;
  if (req.body.flaresolverr_url !== undefined) updates.flaresolverr_url = req.body.flaresolverr_url;

  // Default Credentials
  if (req.body.defaultPseudo !== undefined) updates.defaultPseudo = req.body.defaultPseudo;
  if (req.body.defaultEmail !== undefined) updates.defaultEmail = req.body.defaultEmail;
  if (req.body.defaultPassword !== undefined) updates.defaultPassword = req.body.defaultPassword;

  settings = { ...settings, ...updates };
  saveSettings(updates);

  configureAI(settings.openRouterKey, settings.model);
  res.json({ success: true });
});

app.get('/api/settings', (req, res) => res.json(settings));

app.get('/api/reddit', (req, res) => res.json(getRedditStats()));

// Deep Analysis Endpoint
app.post('/api/analyze', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  console.log(`[ANALYZE] Starting deep analysis of ${url}`);
  const logs = [];

  try {
    const report = await analyzeUrl(url, (msg) => {
      console.log(`[ANALYZE] ${msg}`);
      logs.push(msg);
      io.emit('analyze_progress', { url, message: msg });
    });

    report.logs = logs;
    io.emit('analyze_complete', report);
    res.json(report);
  } catch (error) {
    console.error('[ANALYZE] Error:', error);
    res.status(500).json({ error: error.message, logs });
  }
});

// Socket.io
io.on('connection', (socket) => {
  console.log('Client connected');
  socket.emit('targets_updated', targets);
});

// Worker Loop
const log = (targetId, message) => {
  console.log(`[LOG:${targetId}] ${message}`); // Debug to stdout
  const target = targets.find(t => t.id === targetId);
  if (target) {
    const timeStr = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const logEntry = `[${timeStr}] ${message}`;
    target.logs.unshift(logEntry);
    if (target.logs.length > 50) target.logs.pop();
    io.emit('log_update', { targetId, logEntry });
  }
};

const updateStatus = (targetId, status) => {
  const target = targets.find(t => t.id === targetId);
  if (target) {
    target.status = status;
    target.lastCheck = new Date().toISOString();
    upsertTarget(target);
    io.emit('status_update', { targetId, status, lastCheck: target.lastCheck });
  }
};

// Reusable Check Logic
const runTargetCheck = async (target) => {
  updateStatus(target.id, 'CHECKING');
  log(target.id, `Checking status for ${target.url}...`);

  try {
    const result = await Promise.race([
      checkTarget(target, (msg) => log(target.id, msg)),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout limit of ${CHECK_TIMEOUT_MS / 1000}s exceeded`)), CHECK_TIMEOUT_MS))
    ]);

    // Update forum metadata if detected
    if (result.forumType || result.robotsInfo || result.invitationCodes?.length > 0) {
      target.forumType = result.forumType || target.forumType;
      target.robotsInfo = result.robotsInfo || target.robotsInfo;
      target.invitationCodes = result.invitationCodes || target.invitationCodes;
      upsertTarget(target);
      io.emit('metadata_update', {
        targetId: target.id,
        forumType: target.forumType,
        robotsInfo: target.robotsInfo,
        invitationCodes: target.invitationCodes
      });
    }

    if (result.success) {
      updateStatus(target.id, 'REGISTERED');
      log(target.id, 'SUCCESS: Registration completed!');
    } else if (result.needsInvite) {
      updateStatus(target.id, 'NEEDS_INVITE');
      log(target.id, 'OPEN but requires invitation code or additional info.');
    } else if (result.open) {
      updateStatus(target.id, 'OPEN');
      log(target.id, 'WARNING: Registration seems open but failed to automate.');
    } else {
      updateStatus(target.id, 'CLOSED');
      log(target.id, 'Registration appears closed.');
    }
  } catch (error) {
    updateStatus(target.id, 'ERROR');
    log(target.id, `Error: ${error.message}`);
  }
};

// Check Endpoint
app.post('/api/targets/:id/check', async (req, res) => {
  console.log(`[API] Force check requested for ${req.params.id}`);
  const target = targets.find(t => t.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'Target not found' });

  // Don't await the check so we return immediately
  runTargetCheck(target);

  res.json({ success: true, message: 'Check initiated' });
});

const CHECK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max per check

// Random Scheduler (Stealth Mode)
// DEBUG: Reduced intervals for testing (was 45-90 mins)
const MIN_INTERVAL = 10 * 60 * 1000; // 10 minutes
const MAX_INTERVAL = 10 * 60 * 1000; // 10 minutes

const startScheduler = (initialDelay = null) => {
  const delay = initialDelay !== null
    ? initialDelay
    : Math.floor(Math.random() * (MAX_INTERVAL - MIN_INTERVAL + 1)) + MIN_INTERVAL;

  const nextCheck = new Date(Date.now() + delay).toLocaleTimeString();

  console.log(`[SCHEDULER] Next check loop scheduled in ${Math.round(delay / 60000)} minutes (${nextCheck})`);

  setTimeout(async () => {
    console.log(`[SCHEDULER] Starting check batch...`);
    try {
      for (const target of targets) {
        if (target.status === 'REGISTERED') continue;

        // Fix for Stuck Checks: If status is CHECKING but lastCheck is old (> 10 mins), reset it.
        if (target.status === 'CHECKING') {
          const timeSinceCheck = Date.now() - new Date(target.lastCheck).getTime();
          const STALE_TIMEOUT = 10 * 60 * 1000; // 10 minutes

          if (timeSinceCheck > STALE_TIMEOUT) {
            console.log(`[SCHEDULER] Found stale CHECKING target ${target.url} (Last check: ${target.lastCheck}). Resetting/Retrying...`);
            // We don't continue; we let it fall through to runTargetCheck, which will update status to CHECKING (fresh timestamp)
          } else {
            continue; // Still validly checking
          }
        }

        // Wrap individual check in try/catch just in case runTargetCheck fails unexpectedly
        try {
          await runTargetCheck(target);
        } catch (targetError) {
          console.error(`[SCHEDULER] Critical error checking target ${target.id} (${target.url}):`, targetError);
          // FORCE ERROR STATUS if not already set, so we don't try again immediately or get stuck
          updateStatus(target.id, 'ERROR');
          log(target.id, `System Error: ${targetError.message}`);
        }

        // Brief pause to prevent CPU spiking if loop is tight
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (batchError) {
      console.error("[SCHEDULER] Critical error in check batch:", batchError);
    } finally {
      // Schedule next run regardless of errors
      startScheduler();
    }
  }, delay);
};

// Start initial loop
// Start initial loop with 1 minute delay
startScheduler(60 * 1000);

// Start Reddit Monitor
startRedditMonitor((url, source) => {
  // Check duplicates
  if (targets.some(t => t.url === url || t.url === url + '/')) return false;

  const newTarget = {
    id: Date.now().toString(),
    url: url,
    url: url,
    pseudo: settings.defaultPseudo || `AutoUser_${Math.floor(Math.random() * 1000)}`,
    email: settings.defaultEmail || '',
    password: settings.defaultPassword || '',
    status: 'IDLE',
    logs: [`[${source}] Auto-detected from Reddit r/FrancePirate`],
    lastCheck: null
  };
  targets.push(newTarget);
  upsertTarget(newTarget);
  io.emit('targets_updated', targets);
  io.emit('reddit_stats', getRedditStats());
  console.log(`[REDDIT] Added new target: ${url}`);
  return true;
}, (msg) => {
  console.log(`[REDDIT] ${msg}`);
  io.emit('reddit_stats', getRedditStats());
});

httpServer.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
