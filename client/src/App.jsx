import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { Target, ShieldAlert, CheckCircle, Clock, Plus, Trash2, Terminal, PauseCircle, PlayCircle, Search } from 'lucide-react';

// Ensure API_URL doesn't produce double-slashes when combined with /api
const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const socket = io(API_URL);

function App() {
    const [targets, setTargets] = useState([]);
    const [showAddForm, setShowAddForm] = useState(false);
    const [newTarget, setNewTarget] = useState({ url: '', pseudo: '', email: '', password: '' });

    // Pre-fill form with settings when opening add form
    const openAddForm = () => {
        setNewTarget({
            url: '',
            pseudo: settingsForm.defaultPseudo || '',
            email: settingsForm.defaultEmail || '',
            password: settingsForm.defaultPassword || ''
        });
        setShowAddForm(true);
    };
    const [showSettings, setShowSettings] = useState(false);
    const [settingsForm, setSettingsForm] = useState({
        openRouterKey: '',
        defaultPseudo: '',
        defaultEmail: '',
        defaultPassword: ''
    });
    const [showAnalyze, setShowAnalyze] = useState(false);
    const [analyzeUrl, setAnalyzeUrl] = useState('');
    const [analyzing, setAnalyzing] = useState(false);
    const [analysisResult, setAnalysisResult] = useState(null);
    const [analysisLogs, setAnalysisLogs] = useState([]);
    const [redditStats, setRedditStats] = useState({ checkCount: 0, lastCheck: null, history: [] });

    useEffect(() => {
        if (showSettings) {
            fetch(`${API_URL}/api/settings`).then(r => r.json()).then(d => {
                // Load other settings if needed, but for now we just use a local state or ref to manage the form?
                // Actually, let's update state to hold all settings
                setSettingsForm({
                    openRouterKey: d.openRouterKey || '',
                    defaultPseudo: d.defaultPseudo || '',
                    defaultEmail: d.defaultEmail || '',
                    defaultPassword: d.defaultPassword || ''
                });
            });
        }
    }, [showSettings]);

    const saveSettings = async (e) => {
        e.preventDefault();
        await fetch(`${API_URL}/api/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settingsForm)
        });
        setShowSettings(false);
    };

    // Real-time Updates
    useEffect(() => {
        socket.on('targets_updated', (data) => setTargets(data));
        socket.on('status_update', ({ targetId, status, lastCheck }) => {
            setTargets(prev => prev.map(t => t.id === targetId ? { ...t, status, lastCheck } : t));
        });
        socket.on('log_update', ({ targetId, logEntry }) => {
            setTargets(prev => prev.map(t => t.id === targetId ? { ...t, logs: [logEntry, ...t.logs].slice(0, 50) } : t));
        });
        socket.on('metadata_update', ({ targetId, forumType, robotsInfo, invitationCodes }) => {
            setTargets(prev => prev.map(t => t.id === targetId ? { ...t, forumType, robotsInfo, invitationCodes } : t));
        });

        socket.on('reddit_stats', (stats) => setRedditStats(stats));

        // Initial fetch
        fetch(`${API_URL}/api/targets`).then(res => res.json()).then(setTargets);
        fetch(`${API_URL}/api/reddit`).then(res => res.json()).then(setRedditStats);

        return () => {
            socket.off('targets_updated');
            socket.off('status_update');
            socket.off('log_update');
            socket.off('metadata_update');
            socket.off('reddit_stats');
        };
    }, []);

    // Analysis socket listeners
    useEffect(() => {
        socket.on('analyze_progress', ({ message }) => {
            setAnalysisLogs(prev => [...prev, message]);
        });
        socket.on('analyze_complete', (report) => {
            setAnalysisResult(report);
            setAnalyzing(false);
        });
        return () => {
            socket.off('analyze_progress');
            socket.off('analyze_complete');
        };
    }, []);

    const addTarget = async (e) => {
        e.preventDefault();
        await fetch(`${API_URL}/api/targets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newTarget)
        });
        setShowAddForm(false);
        setNewTarget({ url: '', pseudo: '', email: '', password: '' });
    };

    const deleteTarget = async (id) => {
        if (!confirm('Delete this target?')) return;
        await fetch(`${API_URL}/api/targets/${id}`, { method: 'DELETE' });
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'REGISTERED': return 'text-green-400 border-green-400 bg-green-400/10';
            case 'OPEN': return 'text-orange-400 border-orange-400 bg-orange-400/10';
            case 'NEEDS_INVITE': return 'text-yellow-400 border-yellow-400 bg-yellow-400/10';
            case 'CHECKING': return 'text-blue-400 border-blue-400 bg-blue-400/10';
            case 'ERROR': return 'text-red-400 border-red-400 bg-red-400/10';
            default: return 'text-gray-400 border-gray-600 bg-gray-800';
        }
    };



    return (
        <div className="min-h-screen bg-gray-950 text-gray-100 p-8 font-mono">
            {/* Header */}
            <header className="mb-10 flex justify-between items-center border-b border-gray-800 pb-4">
                <div className="flex items-center gap-3">
                    <Target className="w-8 h-8 text-red-500" />
                    <h1 className="text-2xl font-bold tracking-wider">FORUM_SNIPER <span className="text-xs font-normal text-gray-500">v1.1.0 AI</span></h1>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={() => setShowSettings(true)}
                        className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2 rounded transition-colors"
                    >
                        <Terminal className="w-4 h-4" /> AI CONFIG
                    </button>
                    <button
                        onClick={() => { setShowAnalyze(true); setAnalysisResult(null); setAnalysisLogs([]); }}
                        className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded transition-colors"
                    >
                        <Search className="w-4 h-4" /> ANALYZE
                    </button>
                    <button
                        onClick={() => openAddForm()}
                        className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded transition-colors"
                    >
                        <Plus className="w-4 h-4" /> ADD TARGET
                    </button>
                </div>
            </header>



            {/* Reddit Dashboard */}
            <div className="mb-8 grid grid-cols-1 lg:grid-cols-4 gap-4">
                <div className="bg-gray-900 border border-orange-500/30 p-4 rounded-lg flex items-center justify-between">
                    <div>
                        <div className="text-gray-400 text-xs font-bold uppercase tracking-wider">Reddit Scans</div>
                        <div className="text-3xl font-bold text-orange-500">{redditStats.checkCount}</div>
                    </div>
                    <div className="text-right">
                        <div className="text-gray-500 text-xs">LAST SCAN</div>
                        <div className="text-sm font-mono text-gray-300">{redditStats.lastCheck ? new Date(redditStats.lastCheck).toLocaleTimeString() : 'Waiting...'}</div>
                    </div>
                </div>

                <div className="col-span-1 lg:col-span-3 bg-gray-900 border border-gray-800 p-4 rounded-lg flex flex-col h-32">
                    <div className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2 flex justify-between">
                        <span>r/FrancePirate Activity Log</span>
                        <span className="text-gray-600">Last 50 events</span>
                    </div>
                    <div className="flex-1 overflow-auto logs-scrollbar font-mono text-xs space-y-1">
                        {[...redditStats.history].reverse().map((h, i) => (
                            <div key={i} className="flex gap-2 border-b border-gray-800/50 pb-1 last:border-0">
                                <span className="text-gray-600">[{new Date(h.timestamp).toLocaleTimeString()}]</span>
                                <span className={`font-bold ${h.status === 'ADDED' ? 'text-green-500' : h.status === 'ERROR' ? 'text-red-500' : 'text-gray-500'}`}>{h.status}</span>
                                <span className="text-gray-300 truncate flex-1" title={h.title}>{h.title}</span>
                                <a href={h.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline truncate max-w-[200px]">{h.url}</a>
                            </div>
                        ))}
                        {redditStats.history.length === 0 && <span className="text-gray-600 italic">No matches found yet...</span>}
                    </div>
                </div>
            </div>

            {/* Target Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {targets.map(target => (
                    <div key={target.id} className={`border rounded-lg p-4 bg-gray-900 flex flex-col h-[400px] transition-all ${getStatusColor(target.status).split(' ')[1]}`}>
                        {/* Card Header */}
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 className="font-bold truncate max-w-[200px]" title={target.url}>{target.url}</h3>
                                <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                                    <ShieldAlert className="w-3 h-3" /> {target.username || 'Anonymous'}
                                </div>
                            </div>
                            <div className={`px-2 py-1 text-xs font-bold border rounded ${getStatusColor(target.status)}`}>
                                {target.status}
                            </div>
                        </div>

                        {/* Info */}
                        <div className="grid grid-cols-2 gap-2 text-xs mb-4 text-gray-400 bg-black/20 p-2 rounded">
                            <div>USER: <span className="text-gray-300">{target.pseudo}</span></div>
                            <div>PASS: <span className="text-gray-300">******</span></div>
                            <div className="col-span-2">LAST CHECK: {target.lastCheck ? new Date(target.lastCheck).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : 'NEVER'}</div>
                            {target.forumType && (
                                <div className="col-span-2 flex items-center gap-2">
                                    <span className="text-gray-500">TYPE:</span>
                                    <span className="px-2 py-0.5 bg-purple-600/30 text-purple-300 rounded text-xs font-bold">{target.forumType}</span>
                                </div>
                            )}
                            {target.robotsInfo?.forumHints?.length > 0 && (
                                <div className="col-span-2 flex items-center gap-2 flex-wrap">
                                    <span className="text-gray-500">HINTS:</span>
                                    {target.robotsInfo.forumHints.map((hint, i) => (
                                        <span key={i} className="px-1.5 py-0.5 bg-cyan-600/20 text-cyan-400 rounded text-xs">{hint}</span>
                                    ))}
                                </div>
                            )}
                            {target.invitationCodes?.length > 0 && (
                                <div className="col-span-2 flex items-center gap-2 flex-wrap">
                                    <span className="text-gray-500">CODES:</span>
                                    {target.invitationCodes.map((c, i) => (
                                        <span key={i} className="px-1.5 py-0.5 bg-yellow-600/30 text-yellow-300 rounded text-xs font-mono" title={`Source: ${c.source}`}>{c.code}</span>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Logs Console */}
                        <div className="flex-1 bg-black rounded p-2 overflow-hidden flex flex-col font-mono text-xs border border-gray-800">
                            <div className="flex items-center gap-2 text-gray-500 mb-2 border-b border-gray-800 pb-1">
                                <Terminal className="w-3 h-3" /> LIVE LOGS
                            </div>
                            <div className="flex-1 overflow-y-auto logs-scrollbar space-y-1">
                                {target.logs.map((log, i) => (
                                    <div key={i} className="truncate text-green-500/80 hover:text-green-400 break-all whitespace-pre-wrap">
                                        {log}
                                    </div>
                                ))}
                                {target.logs.length === 0 && <span className="text-gray-700 italic">Waiting for activity...</span>}
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="mt-4 flex justify-end gap-2 border-t border-gray-800 pt-3">
                            <button
                                onClick={() => fetch(`${API_URL}/api/targets/${target.id}/check`, { method: 'POST' })}
                                disabled={target.status === 'CHECKING'}
                                className={`p-1 ${target.status === 'CHECKING' ? 'text-gray-700 cursor-not-allowed' : 'text-gray-500 hover:text-green-500'}`}
                                title="Run Check Now"
                            >
                                <PlayCircle className="w-4 h-4" />
                            </button>
                            <button onClick={() => deleteTarget(target.id)} className="text-gray-500 hover:text-red-500 p-1">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                ))}

                {targets.length === 0 && (
                    <div className="col-span-full text-center py-20 text-gray-600 border-2 border-dashed border-gray-800 rounded-lg">
                        No targets configured. Add a forum URL to start monitoring.
                    </div>
                )}
            </div>

            {/* Add Modal */}
            {
                showAddForm && (
                    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
                        <div className="bg-gray-900 border border-gray-700 p-6 rounded-lg w-full max-w-md shadow-2xl">
                            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                                <Target className="w-5 h-5 text-red-500" /> New Sniper Target
                            </h2>
                            <form onSubmit={addTarget} className="space-y-4">
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">TARGET URL</label>
                                    <input
                                        required
                                        type="url"
                                        placeholder="https://forum.example.com/register"
                                        className="w-full bg-black border border-gray-700 rounded p-2 focus:border-red-500 outline-none transition-colors"
                                        value={newTarget.url}
                                        onChange={e => setNewTarget({ ...newTarget, url: e.target.value })}
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">PSEUDO</label>
                                        <input
                                            required
                                            type="text"
                                            className="w-full bg-black border border-gray-700 rounded p-2 focus:border-red-500 outline-none"
                                            value={newTarget.pseudo}
                                            onChange={e => setNewTarget({ ...newTarget, pseudo: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">PASSWORD</label>
                                        <input
                                            required
                                            type="password"
                                            className="w-full bg-black border border-gray-700 rounded p-2 focus:border-red-500 outline-none"
                                            value={newTarget.password}
                                            onChange={e => setNewTarget({ ...newTarget, password: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">EMAIL</label>
                                    <input
                                        required
                                        type="email"
                                        className="w-full bg-black border border-gray-700 rounded p-2 focus:border-red-500 outline-none"
                                        value={newTarget.email}
                                        onChange={e => setNewTarget({ ...newTarget, email: e.target.value })}
                                    />
                                </div>
                                <div className="flex justify-end gap-3 mt-6">
                                    <button
                                        type="button"
                                        onClick={() => setShowAddForm(false)}
                                        className="px-4 py-2 hover:bg-gray-800 rounded transition"
                                    >
                                        CANCEL
                                    </button>
                                    <button
                                        type="submit"
                                        className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded font-bold transition"
                                    >
                                        ACTIVATE
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }

            {/* AI Settings Modal */}
            {
                showSettings && (
                    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
                        <div className="bg-gray-900 border border-gray-700 p-6 rounded-lg w-full max-w-md shadow-2xl">
                            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                                <Terminal className="w-5 h-5 text-blue-500" /> AI Configuration
                            </h2>
                            <form onSubmit={saveSettings} className="space-y-4">
                                <div className="bg-blue-900/20 border border-blue-900 p-3 rounded text-xs text-blue-200 mb-4">
                                    Global configuration for AI and default credentials.
                                </div>

                                <div className="space-y-4 border-b border-gray-700 pb-4 mb-4">
                                    <h3 className="text-sm font-bold text-gray-300">AI Service</h3>
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">OPENROUTER API KEY</label>
                                        <input
                                            type="password"
                                            placeholder="sk-or-..."
                                            className="w-full bg-black border border-gray-700 rounded p-2 focus:border-blue-500 outline-none transition-colors"
                                            value={settingsForm.openRouterKey}
                                            onChange={e => setSettingsForm({ ...settingsForm, openRouterKey: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <h3 className="text-sm font-bold text-gray-300">Default Credentials</h3>
                                    <p className="text-xs text-gray-500">Automatically applied to new targets found by Reddit or added manually.</p>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs text-gray-400 mb-1">DEFAULT PSEUDO</label>
                                            <input
                                                type="text"
                                                className="w-full bg-black border border-gray-700 rounded p-2 focus:border-blue-500 outline-none"
                                                value={settingsForm.defaultPseudo}
                                                onChange={e => setSettingsForm({ ...settingsForm, defaultPseudo: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs text-gray-400 mb-1">DEFAULT PASSWORD</label>
                                            <input
                                                type="text"
                                                className="w-full bg-black border border-gray-700 rounded p-2 focus:border-blue-500 outline-none"
                                                value={settingsForm.defaultPassword}
                                                onChange={e => setSettingsForm({ ...settingsForm, defaultPassword: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">DEFAULT EMAIL</label>
                                        <input
                                            type="email"
                                            className="w-full bg-black border border-gray-700 rounded p-2 focus:border-blue-500 outline-none"
                                            value={settingsForm.defaultEmail}
                                            onChange={e => setSettingsForm({ ...settingsForm, defaultEmail: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div className="flex justify-end gap-3 mt-6">
                                    <button
                                        type="button"
                                        onClick={() => setShowSettings(false)}
                                        className="px-4 py-2 hover:bg-gray-800 rounded transition"
                                    >
                                        CANCEL
                                    </button>
                                    <button
                                        type="submit"
                                        className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded font-bold transition"
                                    >
                                        SAVE CONFIG
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }

            {/* Analyze Modal */}
            {
                showAnalyze && (
                    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm overflow-auto">
                        <div className="bg-gray-900 border border-gray-700 p-6 rounded-lg w-full max-w-3xl shadow-2xl max-h-[90vh] overflow-auto">
                            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                                <Search className="w-5 h-5 text-purple-500" /> Deep Forum Analysis
                            </h2>

                            {/* URL Input */}
                            <div className="mb-4">
                                <label className="block text-xs text-gray-400 mb-1">FORUM URL</label>
                                <div className="flex gap-2">
                                    <input
                                        type="url"
                                        placeholder="https://forum.example.com"
                                        className="flex-1 bg-black border border-gray-700 rounded p-2 focus:border-purple-500 outline-none transition-colors"
                                        value={analyzeUrl}
                                        onChange={e => setAnalyzeUrl(e.target.value)}
                                        disabled={analyzing}
                                    />
                                    <button
                                        onClick={async () => {
                                            if (!analyzeUrl) return;
                                            setAnalyzing(true);
                                            setAnalysisLogs([]);
                                            setAnalysisResult(null);
                                            try {
                                                const res = await fetch(`${API_URL}/api/analyze`, {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ url: analyzeUrl })
                                                });
                                                const data = await res.json();
                                                setAnalysisResult(data);
                                            } catch (e) {
                                                setAnalysisLogs(prev => [...prev, `Error: ${e.message}`]);
                                            }
                                            setAnalyzing(false);
                                        }}
                                        disabled={analyzing || !analyzeUrl}
                                        className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 px-4 py-2 rounded font-bold transition"
                                    >
                                        {analyzing ? 'ANALYZING...' : 'ANALYZE'}
                                    </button>
                                </div>
                            </div>

                            {/* Live Logs */}
                            {analysisLogs.length > 0 && (
                                <div className="mb-4 bg-black rounded p-3 max-h-32 overflow-auto font-mono text-xs border border-gray-800">
                                    {analysisLogs.map((log, i) => (
                                        <div key={i} className="text-green-400">[LOG] {log}</div>
                                    ))}
                                </div>
                            )}

                            {/* Results */}
                            {analysisResult && (
                                <div className="space-y-4">
                                    {/* Page Title & Description */}
                                    {analysisResult.pageTitle && (
                                        <div className="bg-gray-800/50 p-3 rounded">
                                            <div className="text-lg font-bold text-white">{analysisResult.pageTitle}</div>
                                            {analysisResult.pageDescription && (
                                                <div className="text-xs text-gray-400 mt-1">{analysisResult.pageDescription}</div>
                                            )}
                                        </div>
                                    )}

                                    {/* Forum Type */}
                                    <div className="flex items-center gap-3">
                                        <span className="text-gray-400 text-sm">TYPE:</span>
                                        <span className="px-3 py-1 bg-purple-600/30 text-purple-300 rounded font-bold">{analysisResult.forumType}</span>
                                    </div>

                                    {/* Social Links */}
                                    {analysisResult.socialLinks?.length > 0 && (
                                        <div>
                                            <span className="text-gray-400 text-sm block mb-2">💬 SOCIAL / INVITE LINKS:</span>
                                            <div className="flex flex-wrap gap-2">
                                                {analysisResult.socialLinks.map((l, i) => (
                                                    <a key={i} href={l.href} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-indigo-600/30 text-indigo-300 rounded text-xs hover:bg-indigo-600/50">{l.text || l.href}</a>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Registration Paths */}
                                    {analysisResult.registrationPaths?.length > 0 && (
                                        <div>
                                            <span className="text-gray-400 text-sm block mb-2">REGISTRATION PATHS:</span>
                                            <div className="flex flex-wrap gap-2">
                                                {analysisResult.registrationPaths.map((p, i) => (
                                                    <a key={i} href={new URL(p, analysisResult.url).href} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-green-600/20 text-green-400 rounded text-xs hover:bg-green-600/40">{p}</a>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Invitation Codes */}
                                    {analysisResult.invitationCodes?.length > 0 && (
                                        <div>
                                            <span className="text-gray-400 text-sm block mb-2">INVITATION CODES FOUND:</span>
                                            <div className="flex flex-wrap gap-2">
                                                {analysisResult.invitationCodes.map((c, i) => (
                                                    <span key={i} className="px-2 py-1 bg-yellow-600/30 text-yellow-300 rounded text-xs font-mono">{c}</span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Links Found */}
                                    {analysisResult.allLinks?.length > 0 && (
                                        <div>
                                            <span className="text-gray-400 text-sm block mb-2">RELEVANT LINKS:</span>
                                            <div className="bg-black/50 rounded p-2 max-h-40 overflow-auto">
                                                {analysisResult.allLinks.map((l, i) => (
                                                    <div key={i} className="text-xs py-1 border-b border-gray-800 last:border-0">
                                                        <a href={l.href} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">{l.text || l.href}</a>
                                                        <span className="text-gray-600 ml-2">{l.href}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Form Fields */}
                                    {analysisResult.formFields?.length > 0 && (
                                        <div>
                                            <span className="text-gray-400 text-sm block mb-2">FORM FIELDS DETECTED:</span>
                                            <div className="flex flex-wrap gap-2">
                                                {analysisResult.formFields.map((f, i) => (
                                                    <span key={i} className={`px-2 py-1 rounded text-xs ${f.name.match(/invite|code|referral/i) ? 'bg-yellow-600/30 text-yellow-300' : 'bg-gray-700 text-gray-300'}`}>
                                                        {f.name} ({f.type}){f.required && ' *'}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Intelligence Search */}
                                    {analysisResult.intelligence?.length > 0 && (
                                        <div>
                                            <span className="text-gray-400 text-sm block mb-2">🕵️‍♂️ INTELLIGENCE / RESEARCH:</span>
                                            <div className="bg-indigo-900/10 border border-indigo-900/30 p-3 rounded space-y-2">
                                                {analysisResult.intelligence.map((item, i) => (
                                                    <a key={i} href={item.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-2 bg-black/40 hover:bg-black/60 rounded transition group">
                                                        <div className="flex flex-col">
                                                            <span className="text-indigo-300 font-bold text-xs">{item.source}</span>
                                                            <span className="text-gray-400 text-xs">{item.description}</span>
                                                        </div>
                                                        <span className="text-gray-500 text-xs group-hover:text-indigo-400">OPEN ↗</span>
                                                    </a>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Notes */}
                                    {analysisResult.notes?.length > 0 && (
                                        <div className="bg-orange-900/20 border border-orange-900 p-3 rounded">
                                            {analysisResult.notes.map((n, i) => (
                                                <div key={i} className="text-orange-300 text-sm">{n}</div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Robots.txt */}
                                    {analysisResult.robotsTxtInfo?.hints?.length > 0 && (
                                        <div>
                                            <span className="text-gray-400 text-sm block mb-2">ROBOTS.TXT HINTS:</span>
                                            <div className="flex flex-wrap gap-2">
                                                {analysisResult.robotsTxtInfo.hints.map((h, i) => (
                                                    <span key={i} className="px-2 py-1 bg-cyan-600/20 text-cyan-400 rounded text-xs">{h}</span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Close Button */}
                            <div className="flex justify-end mt-6">
                                <button
                                    onClick={() => setShowAnalyze(false)}
                                    className="px-4 py-2 hover:bg-gray-800 rounded transition"
                                >
                                    CLOSE
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
}

export default App;
