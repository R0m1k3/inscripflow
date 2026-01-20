import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { checkTarget } from './worker.js';
import { configureAI } from './aiService.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 4000;
const DB_FILE = path.resolve('targets.json');

app.use(cors());
app.use(express.json());

// Load targets
let targets = [];
if (fs.existsSync(DB_FILE)) {
  try {
    targets = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (e) {
    console.error("Error reading targets DB", e);
  }
}

// Load Settings (API Key)
const SETTINGS_FILE = path.resolve('settings.json');
let settings = { openRouterKey: '' };
if (fs.existsSync(SETTINGS_FILE)) {
  try { settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')); } catch (e) { }
}
configureAI(settings.openRouterKey);

const saveTargets = () => {
  fs.writeFileSync(DB_FILE, JSON.stringify(targets, null, 2));
};

// Routes
app.get('/api/targets', (req, res) => res.json(targets));

app.post('/api/targets', (req, res) => {
  const newTarget = {
    id: Date.now().toString(),
    url: req.body.url,
    pseudo: req.body.pseudo,
    email: req.body.email,
    password: req.body.password,
    status: 'IDLE', // IDLE, CHECKING, OPEN, REGISTERED, ERROR
    logs: [],
    lastCheck: null
  };
  targets.push(newTarget);
  saveTargets();
  io.emit('targets_updated', targets);
  res.json(newTarget);
});

app.delete('/api/targets/:id', (req, res) => {
  targets = targets.filter(t => t.id !== req.params.id);
  saveTargets();
  io.emit('targets_updated', targets);
  res.json({ success: true });
});

app.post('/api/settings', (req, res) => {
  settings.openRouterKey = req.body.openRouterKey;
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  configureAI(settings.openRouterKey);
  res.json({ success: true });
});

app.get('/api/settings', (req, res) => res.json(settings));

// Socket.io
io.on('connection', (socket) => {
  console.log('Client connected');
  socket.emit('targets_updated', targets);
});

// Worker Loop
const log = (targetId, message) => {
  const target = targets.find(t => t.id === targetId);
  if (target) {
    const logEntry = `[${new Date().toLocaleTimeString()}] ${message}`;
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
    saveTargets();
    io.emit('status_update', { targetId, status, lastCheck: target.lastCheck });
  }
};

// Reusable Check Logic
const runTargetCheck = async (target) => {
  updateStatus(target.id, 'CHECKING');
  log(target.id, `Checking status for ${target.url}...`);

  try {
    const result = await checkTarget(target, (msg) => log(target.id, msg));

    if (result.success) {
      updateStatus(target.id, 'REGISTERED');
      log(target.id, 'SUCCESS: Registration completed!');
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
  const target = targets.find(t => t.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'Target not found' });

  // Don't await the check so we return immediately
  runTargetCheck(target);

  res.json({ success: true, message: 'Check initiated' });
});

// Check Loop (Every 60s for demo, can be faster)
setInterval(async () => {
  for (const target of targets) {
    if (target.status === 'REGISTERED') continue;
    // Avoid double checking if already in progress (optional, but good practice)
    if (target.status === 'CHECKING') continue;

    await runTargetCheck(target);
  }
}, 30000); // 30 seconds loop

httpServer.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
