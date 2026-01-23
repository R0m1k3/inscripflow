import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.resolve('data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'database.sqlite');
const db = new Database(DB_PATH);

// Enable WAL mode for concurrency
db.pragma('journal_mode = WAL');

// Initialize Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS targets (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    pseudo TEXT,
    email TEXT,
    password TEXT,
    status TEXT,
    logs TEXT, -- JSON Array
    lastCheck TEXT,
    forumType TEXT,
    robotsInfo TEXT, -- JSON
    invitationCodes TEXT -- JSON
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Migration Logic: Import from JSON if DB is empty
const TARGETS_JSON = path.join(DATA_DIR, 'targets.json');
const SETTINGS_JSON = path.join(DATA_DIR, 'settings.json');

const targetCount = db.prepare('SELECT count(*) as count FROM targets').get();
if (targetCount.count === 0 && fs.existsSync(TARGETS_JSON)) {
    console.log('[DB] Migrating targets.json to SQLite...');
    try {
        const targets = JSON.parse(fs.readFileSync(TARGETS_JSON, 'utf-8'));
        const insert = db.prepare(`
            INSERT INTO targets (id, url, pseudo, email, password, status, logs, lastCheck, forumType, robotsInfo, invitationCodes)
            VALUES (@id, @url, @pseudo, @email, @password, @status, @logs, @lastCheck, @forumType, @robotsInfo, @invitationCodes)
        `);
        const insertMany = db.transaction((list) => {
            for (const t of list) {
                insert.run({
                    id: t.id,
                    url: t.url,
                    pseudo: t.pseudo,
                    email: t.email,
                    password: t.password,
                    status: t.status,
                    logs: JSON.stringify(t.logs || []),
                    lastCheck: t.lastCheck,
                    forumType: t.forumType,
                    robotsInfo: JSON.stringify(t.robotsInfo || {}),
                    invitationCodes: JSON.stringify(t.invitationCodes || [])
                });
            }
        });
        insertMany(targets);
        console.log(`[DB] Imported ${targets.length} targets.`);
        fs.renameSync(TARGETS_JSON, TARGETS_JSON + '.bak'); // Rename to prevent re-import
    } catch (e) {
        console.error('[DB] Migration failed:', e);
    }
}

const settingsCount = db.prepare('SELECT count(*) as count FROM settings').get();
if (settingsCount.count === 0 && fs.existsSync(SETTINGS_JSON)) {
    console.log('[DB] Migrating settings.json to SQLite...');
    try {
        const settings = JSON.parse(fs.readFileSync(SETTINGS_JSON, 'utf-8'));
        const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
        const insertMany = db.transaction((obj) => {
            for (const [k, v] of Object.entries(obj)) {
                insert.run(k, String(v));
            }
        });
        insertMany(settings);
        console.log('[DB] Imported settings.');
        fs.renameSync(SETTINGS_JSON, SETTINGS_JSON + '.bak');
    } catch (e) {
        console.error('[DB] Settings migration failed:', e);
    }
}

// Helpers
export const getAllTargets = () => {
    const rows = db.prepare('SELECT * FROM targets').all();
    return rows.map(r => ({
        ...r,
        logs: JSON.parse(r.logs || '[]'),
        robotsInfo: JSON.parse(r.robotsInfo || '{}'),
        invitationCodes: JSON.parse(r.invitationCodes || '[]')
    }));
};

export const upsertTarget = (target) => {
    const stmt = db.prepare(`
        INSERT INTO targets (id, url, pseudo, email, password, status, logs, lastCheck, forumType, robotsInfo, invitationCodes)
        VALUES (@id, @url, @pseudo, @email, @password, @status, @logs, @lastCheck, @forumType, @robotsInfo, @invitationCodes)
        ON CONFLICT(id) DO UPDATE SET
        url=@url, pseudo=@pseudo, email=@email, password=@password, status=@status, logs=@logs, lastCheck=@lastCheck,
        forumType=@forumType, robotsInfo=@robotsInfo, invitationCodes=@invitationCodes
    `);
    const info = stmt.run({
        ...target,
        logs: JSON.stringify(target.logs || []),
        robotsInfo: JSON.stringify(target.robotsInfo || {}),
        invitationCodes: JSON.stringify(target.invitationCodes || [])
    });
    return info;
};

export const deleteTarget = (id) => {
    return db.prepare('DELETE FROM targets WHERE id = ?').run(id);
};

export const getSettings = () => {
    const rows = db.prepare('SELECT * FROM settings').all();
    const settings = {};
    for (const row of rows) {
        settings[row.key] = row.value;
    }
    return settings;
};

export const saveSettings = (newSettings) => {
    const insert = db.prepare('INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value=@value');
    const updateMany = db.transaction((obj) => {
        for (const [k, v] of Object.entries(obj)) {
            if (v !== undefined) {
                insert.run({ key: k, value: String(v) });
            }
        }
    });
    updateMany(newSettings);
};

export { db };
