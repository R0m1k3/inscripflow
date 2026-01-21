/**
 * Deep Forum Analyzer Module
 * Performs comprehensive analysis of forum URLs to find registration info
 */

import { chromium } from 'playwright-core';
import { detectForumType, getCommonRegistrationPaths } from './forumFingerprints.js';

const BROWSERLESS_URL = process.env.BROWSERLESS_HOST
    ? `ws://${process.env.BROWSERLESS_HOST}:3000`
    : 'ws://localhost:3000';

// Analyze robots.txt for forum hints
async function fetchRobotsTxt(baseUrl) {
    try {
        const robotsUrl = new URL('/robots.txt', baseUrl).href;
        const response = await fetch(robotsUrl, { signal: AbortSignal.timeout(5000) });
        if (response.ok) {
            const text = await response.text();
            const hints = [];
            const lower = text.toLowerCase();

            if (lower.includes('phpbb')) hints.push('phpBB');
            if (lower.includes('xenforo')) hints.push('XenForo');
            if (lower.includes('discourse')) hints.push('Discourse');
            if (lower.includes('invision')) hints.push('Invision');
            if (lower.includes('vbulletin')) hints.push('vBulletin');
            if (lower.includes('mybb')) hints.push('MyBB');
            if (lower.includes('register')) hints.push('Has /register');
            if (lower.includes('signup')) hints.push('Has /signup');

            return { hints, raw: text.slice(0, 1000) };
        }
    } catch (e) {
        // Ignore errors
    }
    return { hints: [], raw: null };
}

// Analyze sitemap.xml
async function fetchSitemap(baseUrl) {
    try {
        const sitemapUrl = new URL('/sitemap.xml', baseUrl).href;
        const response = await fetch(sitemapUrl, { signal: AbortSignal.timeout(5000) });
        if (response.ok) {
            const text = await response.text();
            const urls = [];
            const regexMatches = text.match(/<loc>([^<]+)<\/loc>/gi) || [];
            for (const match of regexMatches.slice(0, 50)) {
                const url = match.replace(/<\/?loc>/gi, '');
                if (url.match(/register|signup|invite|join/i)) {
                    urls.push(url);
                }
            }
            return urls;
        }
    } catch (e) {
        // Ignore errors
    }
    return [];
}

// Extract invitation codes from text
function extractInvitationCodes(text, url) {
    const codes = [];

    // URL patterns
    const urlPatterns = [
        /[?&]invite[_-]?code=([a-zA-Z0-9_-]{4,})/gi,
        /[?&]ref(?:erral)?=([a-zA-Z0-9_-]{4,})/gi,
        /[?&]code=([a-zA-Z0-9_-]{6,})/gi,
        /\/invite\/([a-zA-Z0-9_-]{4,})/gi,
        /\/register\/([a-zA-Z0-9_-]{8,})/gi
    ];

    for (const pattern of urlPatterns) {
        let match;
        const testStr = url + ' ' + text;
        while ((match = pattern.exec(testStr)) !== null) {
            if (!codes.includes(match[1])) {
                codes.push(match[1]);
            }
        }
    }

    // Text patterns for displayed codes
    const textPatterns = [
        /invitation\s*code[:\s]+([A-Z0-9]{4,20})/gi,
        /code\s*d['']?invitation[:\s]+([A-Z0-9]{4,20})/gi,
        /use\s*code[:\s]+([A-Z0-9]{4,20})/gi
    ];

    for (const pattern of textPatterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            if (!codes.includes(match[1])) {
                codes.push(match[1]);
            }
        }
    }

    const STOPWORDS = ['pour', 'code', 'invite', 'data', 'json', 'home', 'return', 'true', 'false', 'null', 'undefined', 'search', 'login'];
    const filteredCodes = [...new Set(codes)].filter(c =>
        !STOPWORDS.includes(c.toLowerCase()) &&
        c.length > 2 &&
        !c.match(/^\d+$/) // Ignore pure numbers unlikely to be complex invite codes
    );

    return filteredCodes;
}

/**
 * Perform intelligence search for invitation codes
 */
async function performIntelligence(domain, forumName) {
    const results = [];

    // 1. Reddit OpenSignups
    results.push({
        source: 'Reddit r/OpenSignups',
        url: `https://www.reddit.com/r/OpenSignups/search/?q=${encodeURIComponent(domain)}&restrict_sr=1&sort=new`,
        description: `Check for open signup posts for ${domain}`
    });

    // 2. Twitter Search
    results.push({
        source: 'Twitter / X',
        url: `https://twitter.com/search?q=${encodeURIComponent(domain + ' invitation code')}&f=live`,
        description: `Real-time tweets for ${domain} invites`
    });

    // 3. Opentrackers.org (Review site)
    results.push({
        source: 'Opentrackers Reviews',
        url: `https://opentrackers.org/?s=${encodeURIComponent(domain)}`,
        description: `Check tracker status and invite availability`
    });

    // 4. Wayback Machine (Historical Cache)
    results.push({
        source: 'Wayback Machine',
        url: `https://web.archive.org/web/*/${domain}`,
        description: `Check historical versions of the site for codes`
    });

    // 5. Text Dumps (Pastebin, JustPaste, etc.)
    results.push({
        source: 'Text Dumps Search',
        url: `https://www.google.com/search?q=${encodeURIComponent('site:pastebin.com OR site:justpaste.it OR site:rentry.co "' + domain + '"')}`,
        description: `Search for codes in public text dumps`
    });

    // 6. Yandex Search (Less censored)
    results.push({
        source: 'Yandex Search',
        url: `https://yandex.com/search/?text=${encodeURIComponent('"' + domain + '" invite code')}`,
        description: `Broad search on Yandex (often better results)`
    });

    return results;
}

/**
 * Perform deep analysis of a forum URL
 */
export async function analyzeUrl(inputUrl, progressCallback) {
    // Ensure URL has protocol
    let url = inputUrl;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }

    const report = {
        url,
        forumType: null,
        registrationPaths: [],
        invitationCodes: [],
        robotsTxtInfo: null,
        sitemapLinks: [],
        allLinks: [],
        formFields: [],
        notes: [],
        timestamp: new Date().toISOString()
    };

    progressCallback('Starting deep analysis...');

    // 1. Fetch robots.txt
    progressCallback('Fetching robots.txt...');
    report.robotsTxtInfo = await fetchRobotsTxt(url);
    if (report.robotsTxtInfo.hints.length > 0) {
        progressCallback(`robots.txt hints: ${report.robotsTxtInfo.hints.join(', ')}`);
    }

    // 2. Fetch sitemap.xml
    progressCallback('Fetching sitemap.xml...');
    report.sitemapLinks = await fetchSitemap(url);
    if (report.sitemapLinks.length > 0) {
        progressCallback(`Found ${report.sitemapLinks.length} relevant sitemap links`);
    }

    // 3. Browser analysis
    let browser;
    try {
        progressCallback('Connecting to browser...');
        browser = await chromium.connectOverCDP(BROWSERLESS_URL);
        const context = await browser.newContext();
        const page = await context.newPage();

        progressCallback(`Navigating to ${url}...`);
        await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });

        // Get page content
        const html = await page.content();
        const bodyText = await page.innerText('body').catch(() => '');

        // 4. Detect forum type
        // 4. Detect forum type
        progressCallback('Analyzing forum type...');
        const forumInfo = detectForumType(html);
        report.forumType = forumInfo?.name || 'Unknown';

        // Fallback: Generic Technology & Semantic Detection
        if (report.forumType === 'Unknown') {
            const techStack = [];
            const lowerHtml = html.toLowerCase();

            // Frameworks/CMS
            if (lowerHtml.includes('wp-content')) techStack.push('WordPress');
            if (lowerHtml.includes('joomla')) techStack.push('Joomla');
            if (lowerHtml.includes('drupal')) techStack.push('Drupal');
            if (lowerHtml.includes('bootstrap')) techStack.push('Bootstrap');
            if (lowerHtml.includes('tailwind')) techStack.push('Tailwind');
            if (lowerHtml.includes('jquery')) techStack.push('jQuery');
            if (lowerHtml.includes('react')) techStack.push('React');
            if (lowerHtml.includes('vue')) techStack.push('Vue');
            if (lowerHtml.includes('laravel')) techStack.push('Laravel');

            // Site Categories
            const lowerBody = bodyText.toLowerCase();
            const siteTypes = [];
            if (lowerBody.match(/torrent|tracker|seed|leech|peers/)) siteTypes.push('Torrent Tracker');
            if (lowerBody.match(/board|topic|thread|post|community/)) siteTypes.push('Forum Board');
            if (lowerBody.match(/blog|article|comment/)) siteTypes.push('Blog');
            if (lowerBody.match(/shop|store|cart|product/)) siteTypes.push('E-Commerce');

            if (techStack.length > 0 || siteTypes.length > 0) {
                const techStr = techStack.length > 0 ? `Tech: ${techStack.join('/')}` : '';
                const typeStr = siteTypes.length > 0 ? `Type: ${siteTypes.join('/')}` : '';
                report.forumType = [typeStr, techStr].filter(Boolean).join(' | ') || 'Custom Site';
            }
        }

        if (forumInfo) {
            report.registrationPaths = forumInfo.registrationPaths;
        }
        progressCallback(`Forum type: ${report.forumType}`);

        // 5. Extract ALL page information
        progressCallback('Scanning page structure...');
        const pageInfo = await page.evaluate(() => {
            // Get all links
            const allLinks = Array.from(document.querySelectorAll('a[href]')).map(a => ({
                text: a.innerText.trim().slice(0, 100),
                href: a.href
            })).filter(l => l.text || l.href);

            // Filter relevant links (register, invite, signup, etc.)
            const relevantLinks = allLinks.filter(l =>
                l.href.match(/register|signup|invite|join|inscription|créer|account|login|auth/i) ||
                l.text.match(/register|signup|invite|join|inscription|créer|s'inscrire|compte|connexion|login/i)
            );

            // Get page metadata
            const title = document.title;
            const description = document.querySelector('meta[name="description"]')?.content || '';
            const generator = document.querySelector('meta[name="generator"]')?.content || '';

            // Get navigation items
            const navItems = Array.from(document.querySelectorAll('nav a, header a, [role="navigation"] a')).map(a => ({
                text: a.innerText.trim().slice(0, 50),
                href: a.href
            })).slice(0, 30);

            // Get all buttons
            const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]')).map(b => ({
                text: b.innerText?.trim() || b.value || '',
                type: b.tagName.toLowerCase()
            })).filter(b => b.text).slice(0, 20);

            // Check for Discord/Telegram invite links
            const socialLinks = allLinks.filter(l =>
                l.href.match(/discord\.gg|t\.me|telegram|twitter\.com|x\.com/i)
            ).slice(0, 10);

            // Check for closed/invite-only indications
            const bodyText = document.body.innerText.toLowerCase();
            const pageClues = {
                isClosed: bodyText.includes('closed') || bodyText.includes('fermé') || bodyText.includes('fermée'),
                isInviteOnly: bodyText.includes('invite only') || bodyText.includes('invitation') || bodyText.includes('parrainage'),
                hasDiscord: !!document.querySelector('a[href*="discord"]'),
                hasTelegram: !!document.querySelector('a[href*="t.me"], a[href*="telegram"]')
            };

            return { allLinks, relevantLinks, title, description, generator, navItems, buttons, socialLinks, pageClues };
        });

        // Store comprehensive info
        report.pageTitle = pageInfo.title;
        report.pageDescription = pageInfo.description;
        if (pageInfo.generator) report.notes.push(`🔧 Generator: ${pageInfo.generator}`);
        report.allLinks = pageInfo.relevantLinks.slice(0, 20);
        report.navItems = pageInfo.navItems;
        report.buttons = pageInfo.buttons;
        report.socialLinks = pageInfo.socialLinks;

        if (pageInfo.pageClues.isClosed) report.notes.push('🔒 Page mentions "closed/fermé"');
        if (pageInfo.pageClues.isInviteOnly) report.notes.push('🔑 Page mentions invitation/parrainage');
        if (pageInfo.pageClues.hasDiscord) report.notes.push('💬 Discord link found');
        if (pageInfo.pageClues.hasTelegram) report.notes.push('📱 Telegram link found');

        progressCallback(`Found ${pageInfo.relevantLinks.length} relevant links, ${pageInfo.navItems.length} nav items, ${pageInfo.buttons.length} buttons`);

        // 6. Extract invitation codes from current page
        progressCallback('Searching for invitation codes...');
        const pageUrl = page.url();
        report.invitationCodes = extractInvitationCodes(html + bodyText, pageUrl);
        if (report.invitationCodes.length > 0) {
            progressCallback(`Found codes: ${report.invitationCodes.join(', ')}`);
        }

        // 7. Try to find registration page and analyze form
        progressCallback('Looking for registration page...');
        const regPaths = [...(forumInfo?.registrationPaths || []), ...getCommonRegistrationPaths()];

        for (const regPath of regPaths.slice(0, 5)) {
            try {
                const regUrl = new URL(regPath, url).href;
                const response = await page.goto(regUrl, { timeout: 10000, waitUntil: 'domcontentloaded' });

                if (response && response.ok()) {
                    const regHtml = await page.content();

                    // Check if this looks like a registration page
                    if (regHtml.match(/password|email|username|inscription|register/i)) {
                        progressCallback(`Found registration at: ${regPath}`);

                        if (!report.registrationPaths.includes(regPath)) {
                            report.registrationPaths.push(regPath);
                        }

                        // Extract form fields
                        const fields = await page.evaluate(() => {
                            return Array.from(document.querySelectorAll('input, textarea, select'))
                                .filter(el => (el.name || el.id) && el.type !== 'hidden')
                                .map(el => {
                                    // Find associated label
                                    let label = '';
                                    if (el.id) {
                                        const labelEl = document.querySelector(`label[for="${el.id}"]`);
                                        if (labelEl) label = labelEl.innerText;
                                    }
                                    if (!label && el.closest('label')) {
                                        label = el.closest('label').innerText;
                                    }
                                    // Try to find label in previous element if not found
                                    if (!label) {
                                        const prev = el.previousElementSibling;
                                        if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'B')) {
                                            label = prev.innerText;
                                        }
                                    }

                                    return {
                                        type: el.type || el.tagName.toLowerCase(),
                                        name: el.name || el.id,
                                        placeholder: el.placeholder || '',
                                        title: el.title || '',
                                        label: label.trim(),
                                        required: el.required
                                    };
                                });
                        });
                        report.formFields = fields;

                        // Check for invitation code field
                        const hasInviteField = fields.some(f =>
                            (f.name && f.name.match(/invite|code|referral|parrainage/i)) ||
                            (f.placeholder && f.placeholder.match(/invite|code|referral|parrainage/i)) ||
                            (f.title && f.title.match(/invite|code|referral|parrainage/i)) ||
                            (f.label && f.label.match(/invite|code|referral|parrainage/i))
                        );
                        if (hasInviteField) {
                            report.notes.push('⚠️ Requires invitation code');
                        }

                        // Check for closed registration
                        const regBody = await page.innerText('body').catch(() => '');
                        if (regBody.match(/closed|fermé|disabled|not available/i)) {
                            report.notes.push('🔒 Registration appears closed');
                        }

                        // Check for captcha
                        const frames = await page.frames();
                        const hasCaptcha = frames.some(f =>
                            f.url().includes('recaptcha') ||
                            f.url().includes('captcha') ||
                            f.url().includes('cloudflare')
                        );
                        if (hasCaptcha) {
                            report.notes.push('🤖 Captcha detected');
                        }

                        // Extract more invitation codes from registration page
                        const regPageCodes = extractInvitationCodes(regHtml, page.url());
                        for (const code of regPageCodes) {
                            if (!report.invitationCodes.includes(code)) {
                                report.invitationCodes.push(code);
                            }
                        }

                        break; // Found registration, stop searching
                    }
                }
            } catch (e) {
                // Continue to next path
            }
        }

        await browser.close();

    } catch (error) {
        report.notes.push(`Error: ${error.message}`);
        if (browser) await browser.close();
    }

    // 8. Intelligence / Web Research
    progressCallback('Gathering invitation intelligence...');
    try {
        const domain = new URL(url).hostname.replace('www.', '');
        report.intelligence = await performIntelligence(domain, report.pageTitle || domain);
    } catch (e) {
        // Ignore intelligence errors
    }

    progressCallback('Analysis complete!');
    return report;
}
