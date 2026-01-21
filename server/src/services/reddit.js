
const SUBREDDIT_URL = 'https://www.reddit.com/r/FrancePirate/new.json?limit=25';
const POLL_INTERVAL = 15 * 60 * 1000; // 15 Minutes
const KEYWORDS_REGEX = /(ouvert|invitation|code|regist|s'inscrire|open|sign\s*up)/i;
const URL_REGEX = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g;

// List of ignored domains (common non-forum links found on Reddit)
const IGNORED_DOMAINS = [
    'reddit.com', 'redd.it', 'imgur.com', 'gyazo.com', 'youtube.com', 'youtu.be',
    'discord.gg', 'discord.com', 't.me', 'twitter.com', 'x.com', 'facebook.com',
    'pinterest.com', 'google.com', 'yggtorrent.li', 'sharewood.tv' // Add known huge trackers that might be mentioned but are not "new"
];

// Set of processed post IDs to avoid processing same post twice in a session
// In production with restart persistence, this should be in a DB, but memory is fine for now
const processedPosts = new Set();

/**
 * Starts the Reddit monitoring loop.
 * @param {Function} addTargetCallback - Function (url) => boolean (returns true if added, false if exists)
 * @param {Function} logCallback - Function (msg) => void
 */
export const startRedditMonitor = (addTargetCallback, logCallback) => {
    logCallback('Starting Reddit Monitor for r/FrancePirate...');

    const checkReddit = async () => {
        try {
            logCallback('Checking r/FrancePirate for new open forums...');

            const response = await fetch(SUBREDDIT_URL, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; ForumSniperBot/1.0; +http://localhost)'
                }
            });

            if (!response.ok) {
                throw new Error(`Reddit API Error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const posts = data.data.children;

            let newCount = 0;

            for (const post of posts) {
                const { id, title, selftext, url } = post.data;

                if (processedPosts.has(id)) continue;
                processedPosts.add(id);

                // Combine title and content for search
                const content = `${title} ${selftext} ${url}`;

                // 1. Keyword Check
                if (!KEYWORDS_REGEX.test(content)) {
                    continue;
                }

                // 2. URL Extraction
                const urls = content.match(URL_REGEX) || [];

                for (const foundUrl of urls) {
                    try {
                        const urlObj = new URL(foundUrl);

                        // 3. Domain Filter
                        if (IGNORED_DOMAINS.some(d => urlObj.hostname.includes(d))) continue;

                        // 4. FR Check (Heuristic)
                        // If the post is in r/FrancePirate (which is FR), we assume the context is FR.
                        // But we can check TLD (.fr) or content language if needed.
                        // For now, we rely on the subreddit source + manual Review.
                        // The prompt says "attention le forum doit etre FR".
                        // We'll trust the subreddit but maybe flag it? 
                        // We just add it. The filtering will happen in analysis.

                        logCallback(`Found potential candidate: ${foundUrl} in post "${title}"`);

                        const added = addTargetCallback(foundUrl, 'REDDIT_AUTO');
                        if (added) {
                            newCount++;
                            logCallback(`[AUTO-ADD] Added ${foundUrl} to targets.`);
                        }
                    } catch (e) {
                        // Invalid URL in regex match
                    }
                }
            }

            if (newCount > 0) {
                logCallback(`Reddit Scan Complete. Added ${newCount} new targets.`);
            }

            // Cleanup memory (keep last 1000 IDs)
            if (processedPosts.size > 1000) {
                const it = processedPosts.values();
                for (let i = 0; i < 200; i++) processedPosts.delete(it.next().value);
            }

        } catch (error) {
            logCallback(`Error checking Reddit: ${error.message}`);
        } finally {
            // Schedule next run
            setTimeout(checkReddit, POLL_INTERVAL);
        }
    };

    // Start immediately
    checkReddit();
};
