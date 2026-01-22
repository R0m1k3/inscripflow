import { HttpsProxyAgent } from 'https-proxy-agent';

const SUBREDDIT_URL = 'https://www.reddit.com/r/FrancePirate/new.json?limit=25';
const BASE_INTERVAL = 15 * 60 * 1000; // 15 Minutes
const KEYWORDS_REGEX = /(ouvert|invitation|code|regist|s'inscrire|open|sign\s*up|liste|tracker|nouveau|adresse|lien|source|board|forum)/i;
const URL_REGEX = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%._\+.~#?&//=]*)/g;

// List of ignored domains
const IGNORED_DOMAINS = [
    'reddit.com', 'redd.it', 'imgur.com', 'gyazo.com', 'youtube.com', 'youtu.be',
    'discord.gg', 'discord.com', 't.me', 'twitter.com', 'x.com', 'facebook.com',
    'pinterest.com', 'google.com', 'yggtorrent.li', 'sharewood.tv'
];

// Stealth User Agents
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/50 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1'
];

// Statistics State
const stats = {
    checkCount: 0,
    lastCheck: null,
    history: [] // { timestamp, title, url, status: 'ADDED' | 'IGNORED_KEYWORD' | 'IGNORED_DOMAIN' | 'ERROR' }
};

const addToHistory = (entry) => {
    stats.history.unshift({ ...entry, timestamp: new Date() });
    if (stats.history.length > 50) stats.history.pop();
};

export const getRedditStats = () => stats;

const processedPosts = new Set();

const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
const getJitteredInterval = () => {
    // Randomize interval between 10 and 20 minutes (15 +/- 5)
    return Math.floor(BASE_INTERVAL + (Math.random() * 600000) - 300000);
};

export const startRedditMonitor = (addTargetCallback, logCallback) => {
    logCallback('Starting Stealth Reddit Monitor for r/FrancePirate...');

    const checkReddit = async () => {
        let nextRun = getJitteredInterval();
        stats.checkCount++;
        stats.lastCheck = new Date();

        try {
            logCallback(`Checking r/FrancePirate... (Next check in ~${Math.round(nextRun / 60000)}m)`);

            const options = {
                headers: {
                    'User-Agent': getRandomUserAgent(),
                    'Accept': 'application/json',
                    'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
                }
            };

            // Support Proxy from Environment
            if (process.env.REDDIT_PROXY) {
                options.agent = new HttpsProxyAgent(process.env.REDDIT_PROXY);
                logCallback('Using Proxy for Reddit request.');
            }

            // @ts-ignore
            const response = await fetch(SUBREDDIT_URL, options);

            if (!response.ok) {
                if (response.status === 429) {
                    logCallback('Reddit Rate Limit hit. Backing off for 30 minutes.');
                    nextRun = 30 * 60 * 1000;
                }
                throw new Error(`Reddit API Error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const posts = data.data.children;

            let newCount = 0;

            for (const post of posts) {
                const { id, title, selftext, url } = post.data;

                if (processedPosts.has(id)) continue;
                processedPosts.add(id);

                const content = `${title} ${selftext} ${url}`;

                if (!KEYWORDS_REGEX.test(content)) {
                    addToHistory({ title, url, status: 'IGNORED_NO_KEYWORD' }); // Keep log for visibility

                    continue;
                }

                const urls = content.match(URL_REGEX) || [];

                for (const foundUrl of urls) {
                    try {
                        const urlObj = new URL(foundUrl);
                        if (IGNORED_DOMAINS.some(d => urlObj.hostname.includes(d))) {
                            addToHistory({ title, url: foundUrl, status: 'IGNORED_DOMAIN' });
                            continue;
                        }

                        logCallback(`[STEALTH] Found candidate: ${foundUrl}`);

                        const added = addTargetCallback(foundUrl, 'REDDIT_STEALTH');
                        if (added) {
                            newCount++;
                            addToHistory({ title, url: foundUrl, status: 'ADDED' });
                        } else {
                            addToHistory({ title, url: foundUrl, status: 'DUPLICATE' });
                        }
                    } catch (e) { }
                }
            }

            if (newCount > 0) logCallback(`Scan Complete. Added ${newCount} targets.`);

            if (processedPosts.size > 1000) {
                const it = processedPosts.values();
                for (let i = 0; i < 200; i++) processedPosts.delete(it.next().value);
            }

        } catch (error) {
            logCallback(`Stealth Monitor Error: ${error.message}`);
            addToHistory({ title: 'System Error', url: '', status: 'ERROR', details: error.message });
        } finally {
            setTimeout(checkReddit, nextRun);
        }
    };

    checkReddit();
};
