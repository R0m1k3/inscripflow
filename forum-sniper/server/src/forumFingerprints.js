/**
 * Forum Fingerprinting Module
 * Detects forum software type and provides registration paths
 */

// Forum signatures and their registration paths
const FORUM_SIGNATURES = [
    {
        name: 'phpBB',
        patterns: [
            /phpBB/i,
            /ucp\.php/i,
            /viewtopic\.php/i,
            /powered by phpBB/i
        ],
        registrationPaths: ['/ucp.php?mode=register']
    },
    {
        name: 'XenForo',
        patterns: [
            /data-xf-init/i,
            /XenForo/i,
            /xf-body/i,
            /js\/xf\//i
        ],
        registrationPaths: ['/register/', '/register']
    },
    {
        name: 'Discourse',
        patterns: [
            /ember-application/i,
            /discourse/i,
            /data-discourse/i
        ],
        registrationPaths: ['/signup', '/register']
    },
    {
        name: 'Invision',
        patterns: [
            /ips_/i,
            /invisioncommunity/i,
            /ipsLayout/i,
            /Invision Community/i
        ],
        registrationPaths: ['/register/', '/register']
    },
    {
        name: 'vBulletin',
        patterns: [
            /vbulletin/i,
            /vb_/i,
            /vBulletin/i,
            /register\.php\?do=signup/i
        ],
        registrationPaths: ['/register.php', '/register.php?do=signup']
    },
    {
        name: 'MyBB',
        patterns: [
            /mybb/i,
            /member\.php/i,
            /MyBB Group/i
        ],
        registrationPaths: ['/member.php?action=register']
    },
    {
        name: 'SMF',
        patterns: [
            /Simple Machines/i,
            /smf_/i,
            /action=register/i
        ],
        registrationPaths: ['/index.php?action=register']
    },
    {
        name: 'FluxBB',
        patterns: [
            /FluxBB/i,
            /flux/i,
            /Powered by FluxBB/i
        ],
        registrationPaths: ['/register.php']
    },
    {
        name: 'NodeBB',
        patterns: [
            /NodeBB/i,
            /nodebb/i,
            /data-widget-area/i
        ],
        registrationPaths: ['/register']
    },
    {
        name: 'Flarum',
        patterns: [
            /flarum/i,
            /Flarum/i,
            /data-flarum/i
        ],
        registrationPaths: ['/signup', '/register']
    },
    // Modern Web Apps & Tracker Software
    {
        name: 'TorrentTrader',
        patterns: [
            /TorrentTrader/i,
            /account-signup\.php/i,
            /powered by TorrentTrader/i,
            /SB_SHAMAN/i
        ],
        registrationPaths: ['/account-signup.php']
    },
    {
        name: 'UNIT3D Tracker',
        patterns: [
            /unit3d/i,
            /UNIT3D/i,
            /powered by UNIT3D/i
        ],
        registrationPaths: ['/register', '/signup']
    },
    {
        name: 'Nuxt.js',
        patterns: [
            /__nuxt/i,
            /nuxt-ready/i,
            /nuxt-loading/i,
            /_nuxt\//i
        ],
        registrationPaths: ['/register', '/signup', '/auth/register']
    },
    {
        name: 'Next.js',
        patterns: [
            /__NEXT_DATA__/i,
            /_next\//i
        ],
        registrationPaths: ['/register', '/signup', '/auth/signup']
    },
    {
        name: 'ASP.NET',
        patterns: [
            /aspnetcore/i,
            /\/Home\/Register/i,
            /\/Home\/Login/i,
            /__RequestVerificationToken/i
        ],
        registrationPaths: ['/Home/Register', '/Account/Register', '/register']
    },
    {
        name: 'Vue.js',
        patterns: [
            /data-v-[a-f0-9]/i,
            /vue-app/i
        ],
        registrationPaths: ['/register', '/signup']
    },
    {
        name: 'Gazelle Tracker',
        patterns: [
            /gazelle/i,
            /torrents\.php/i,
            /user\.php\?action=/i
        ],
        registrationPaths: ['/register.php', '/user.php?action=register']
    }
];

// Common registration paths to try if fingerprinting fails
const COMMON_REGISTRATION_PATHS = [
    '/register',
    '/register/',
    '/signup',
    '/signup/',
    '/inscription',
    '/inscription/',
    '/join',
    '/create-account',
    '/ucp.php?mode=register',
    '/register.php',
    '/member.php?action=register'
];

/**
 * Detect forum software type from HTML content
 * @param {string} html - The page HTML
 * @returns {object|null} - Forum info or null if not detected
 */
export function detectForumType(html) {
    for (const forum of FORUM_SIGNATURES) {
        for (const pattern of forum.patterns) {
            if (pattern.test(html)) {
                return {
                    name: forum.name,
                    registrationPaths: forum.registrationPaths
                };
            }
        }
    }
    return null;
}

/**
 * Get common registration paths to try
 * @returns {string[]} - Array of paths to test
 */
export function getCommonRegistrationPaths() {
    return COMMON_REGISTRATION_PATHS;
}

/**
 * Build full URLs from base URL and paths
 * @param {string} baseUrl - The base URL of the forum
 * @param {string[]} paths - Array of paths to append
 * @returns {string[]} - Full URLs
 */
export function buildRegistrationUrls(baseUrl, paths) {
    const base = new URL(baseUrl);
    const origin = base.origin;

    return paths.map(path => {
        if (path.startsWith('/')) {
            return origin + path;
        }
        return origin + '/' + path;
    });
}
