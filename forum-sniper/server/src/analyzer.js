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

    return codes;
}

/**
 * Perform deep analysis of a forum URL
 */
export async function analyzeUrl(url, progressCallback) {
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
        progressCallback('Analyzing forum type...');
        const forumInfo = detectForumType(html);
        report.forumType = forumInfo?.name || 'Unknown';
        if (forumInfo) {
            report.registrationPaths = forumInfo.registrationPaths;
        }
        progressCallback(`Forum type: ${report.forumType}`);

        // 5. Extract all relevant links
        progressCallback('Scanning for registration links...');
        const links = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a[href]')).map(a => ({
                text: a.innerText.trim().slice(0, 50),
                href: a.href
            })).filter(l =>
                l.href.match(/register|signup|invite|join|inscription|créer/i) ||
                l.text.match(/register|signup|invite|join|inscription|créer|s'inscrire/i)
            );
        });
        report.allLinks = links.slice(0, 20);
        progressCallback(`Found ${links.length} relevant links`);

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
                                .filter(el => el.name || el.id)
                                .map(el => ({
                                    type: el.type || el.tagName.toLowerCase(),
                                    name: el.name || el.id,
                                    placeholder: el.placeholder || '',
                                    required: el.required
                                }));
                        });
                        report.formFields = fields;

                        // Check for invitation code field
                        const hasInviteField = fields.some(f =>
                            f.name.match(/invite|code|referral/i) ||
                            f.placeholder.match(/invite|code|referral/i)
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

    progressCallback('Analysis complete!');
    return report;
}
