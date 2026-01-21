import { chromium } from 'playwright-core';
import { getAIFormFillData } from './aiService.js';
import { detectForumType, getCommonRegistrationPaths, buildRegistrationUrls } from './forumFingerprints.js';

const BROWSERLESS_URL = process.env.BROWSERLESS_HOST
    ? `ws://${process.env.BROWSERLESS_HOST}:3000`
    : 'ws://localhost:3000';

// Analyze robots.txt for forum hints
function analyzeRobotsTxt(robotsText) {
    const hints = [];
    const lines = robotsText.toLowerCase();

    if (lines.includes('phpbb')) hints.push('phpBB');
    if (lines.includes('xenforo')) hints.push('XenForo');
    if (lines.includes('discourse')) hints.push('Discourse');
    if (lines.includes('invision') || lines.includes('ips4')) hints.push('Invision');
    if (lines.includes('vbulletin')) hints.push('vBulletin');
    if (lines.includes('mybb')) hints.push('MyBB');
    if (lines.includes('wp-content')) hints.push('WordPress');
    if (lines.includes('register.php') || lines.includes('signup')) hints.push('Has Registration');

    return { forumHints: hints, raw: robotsText.slice(0, 500) };
}

// Detect invitation codes from URLs and page content
function detectInvitationCodes(html, url) {
    const codes = [];

    // Common invitation URL patterns
    const urlPatterns = [
        /[?&]invite[_-]?code=([a-zA-Z0-9_-]+)/i,
        /[?&]ref(?:erral)?=([a-zA-Z0-9_-]+)/i,
        /[?&]code=([a-zA-Z0-9_-]+)/i,
        /\/invite\/([a-zA-Z0-9_-]+)/i,
        /\/register\/([a-zA-Z0-9_-]{6,})/i
    ];

    // Check URL
    for (const pattern of urlPatterns) {
        const match = url.match(pattern);
        if (match) codes.push({ source: 'url', code: match[1] });
    }

    // Check HTML for invitation links
    const htmlPatterns = [
        /href=["'][^"']*invite[_-]?code=([a-zA-Z0-9_-]+)[^"']*/gi,
        /href=["'][^"']*\/invite\/([a-zA-Z0-9_-]+)[^"']*/gi,
        /invitation.*?code.*?["'>:]\s*([A-Z0-9]{4,20})/gi,
        /code\s*d['']?invitation.*?["'>:]\s*([A-Z0-9]{4,20})/gi
    ];

    for (const pattern of htmlPatterns) {
        let match;
        while ((match = pattern.exec(html)) !== null) {
            if (match[1] && !codes.find(c => c.code === match[1])) {
                codes.push({ source: 'page', code: match[1] });
            }
        }
    }

    return codes;
}



export async function checkTarget(target, logCallback) {
    logCallback(`Connecting to Browserless at ${BROWSERLESS_URL}...`);

    let browser;
    let detectedForumType = 'Unknown';
    let robotsTxtInfo = null;
    let invitationCodes = [];

    try {
        browser = await chromium.connectOverCDP(BROWSERLESS_URL);
        const context = await browser.newContext();
        const page = await context.newPage();

        // STEP 0: Fetch robots.txt for clues
        try {
            const robotsUrl = new URL('/robots.txt', target.url).href;
            const robotsResponse = await fetch(robotsUrl, { signal: AbortSignal.timeout(5000) });
            if (robotsResponse.ok) {
                const robotsText = await robotsResponse.text();
                robotsTxtInfo = analyzeRobotsTxt(robotsText);
                if (robotsTxtInfo.forumHints.length > 0) {
                    logCallback(`robots.txt hints: ${robotsTxtInfo.forumHints.join(', ')}`);
                }
            }
        } catch (e) {
            // robots.txt not available or timeout
        }

        logCallback(`Navigating to ${target.url}...`);
        await page.goto(target.url, { timeout: 30000, waitUntil: 'domcontentloaded' });

        // STEP 1: FORUM FINGERPRINTING
        const initialHtml = await page.content();
        const forumInfo = detectForumType(initialHtml);

        if (forumInfo) {
            detectedForumType = forumInfo.name;
            logCallback(`Detected forum type: ${forumInfo.name}`);

            // Try known registration paths for this forum type
            for (const regPath of forumInfo.registrationPaths) {
                try {
                    const regUrl = new URL(regPath, target.url).href;
                    logCallback(`Trying known path: ${regUrl}`);

                    const response = await page.goto(regUrl, { timeout: 15000, waitUntil: 'domcontentloaded' });

                    if (response && response.ok()) {
                        // Check if this looks like a registration page
                        const regHtml = await page.content();
                        if (regHtml.match(/password|email|username|inscription|register/i)) {
                            logCallback(`Found registration page at ${regUrl}`);
                            break; // Stay on this page
                        }
                    }
                } catch (e) {
                    logCallback(`Path ${regPath} failed: ${e.message}`);
                }
            }
        } else {
            detectedForumType = 'Unknown';
            logCallback(`Forum type not recognized. Using generic detection...`);

            // Try common registration paths if fingerprint failed
            const commonPaths = getCommonRegistrationPaths().slice(0, 5); // Try first 5
            for (const regPath of commonPaths) {
                try {
                    const regUrl = new URL(regPath, target.url).href;
                    const response = await page.goto(regUrl, { timeout: 10000, waitUntil: 'domcontentloaded' });

                    if (response && response.ok()) {
                        const regHtml = await page.content();
                        if (regHtml.match(/password|email|username|inscription|register/i)) {
                            logCallback(`Found registration at common path: ${regUrl}`);
                            break;
                        }
                    }
                } catch (e) {
                    // Silently continue to next path
                }
            }
        }

        // STEP 1: LINK DISCOVERY (existing logic, now as fallback)
        const passwordInputsBefore = await page.locator('input[type="password"]').count();
        if (passwordInputsBefore === 0 || (await page.locator('input[type="email"]').count()) === 0) {
            logCallback(`No obvious form found. Searching for 'Register' link...`);
            const registerLink = page.locator('a', { hasText: /register|sign up|inscription|créer.*compte|join/i }).first();
            if (await registerLink.count() > 0) {
                const linkText = await registerLink.innerText();
                logCallback(`Found link: "${linkText}". Clicking...`);
                await registerLink.click();
                await page.waitForLoadState('domcontentloaded');
                await page.waitForTimeout(2000); // Wait for potential modals or transitions
            }
        }


        // STEP 2: DETECT INVITATION CODES
        const currentHtml = await page.content();
        const currentUrl = page.url();
        invitationCodes = detectInvitationCodes(currentHtml, currentUrl);
        if (invitationCodes.length > 0) {
            logCallback(`Found ${invitationCodes.length} invitation code(s): ${invitationCodes.map(c => c.code).join(', ')}`);
        }

        // 1. Check for "Closed" keywords (AFTER potential navigation)
        const bodyText = await page.innerText('body');
        if (bodyText.match(/registration.*closed/i) || bodyText.match(/inscriptions.*fermées/i)) {
            await browser.close();
            return { success: false, open: false, forumType: detectedForumType, robotsInfo: robotsTxtInfo, invitationCodes };
        }

        // 2. Search for Inputs
        // 2. Search for Inputs (checking name, id, placeholder, and labels)
        const passwordInputs = await page.locator('input[type="password"]').count();
        const emailInputs = await page.locator('input[type="email"], input[name*="mail"], input[placeholder*="mail"], input[placeholder*="courriel"]').count();
        const textareaCount = await page.locator('textarea').count();

        // Check for invitation code inputs (by name, placeholder, or nearby label)
        const inviteInputs = await page.locator('input').filter({ has: page.locator('xpath=self::*[contains(@name, "invite") or contains(@name, "code") or contains(@placeholder, "invitation") or contains(@placeholder, "invite") or contains(@placeholder, "code")]') }).count();

        // Also check labels if input attributes are missing
        const labelInvite = await page.locator('label', { hasText: /invitation|invite|code/i }).count();
        const needsInvite = inviteInputs > 0 || labelInvite > 0;

        if (needsInvite) {
            const submitBtn = page.locator('button[type="submit"], input[type="submit"]').first();
            // If we have an invite field AND a submit button (enabled or disabled), we likely need an invite
            logCallback(`Invitation code field detected!`);
            await browser.close();
            return { success: false, open: true, needsInvite: true, forumType: detectedForumType, robotsInfo: robotsTxtInfo, invitationCodes };
        }

        // Use strict heuristics ONLY if it looks like a simple form (no text areas for questions)
        if (passwordInputs > 0 && emailInputs > 0 && textareaCount === 0) {
            logCallback(`Detected registration form! (${emailInputs} email fields, ${passwordInputs} password fields)`);

            // ATTEMPT REGISTRATION
            logCallback(`Attempting to fill form...`);

            // Fill Email
            await page.locator('input[type="email"], input[name*="mail"], input[placeholder*="mail"], input[placeholder*="courriel"]').first().fill(target.email);

            // Fill Pseudo/Username
            const usernameInput = page.locator('input[name*="user"], input[name*="pseudo"], input[name*="login"], input[placeholder*="utilisateur"], input[placeholder*="pseudo"], input[placeholder*="username"]');
            if (await usernameInput.count() > 0) {
                await usernameInput.first().fill(target.pseudo);
            }

            // Fill Password
            await page.locator('input[type="password"]').first().fill(target.password);
            // Fill Confirm Password if exists
            const confirmPass = page.locator('input[type="password"]').nth(1);
            if (await confirmPass.count() > 0) {
                await confirmPass.fill(target.password);
            }

            logCallback(`Form partially filled. Checking for Captcha...`);

            // ... (rest of the filling logic)

            // Check for Captcha frames
            const iframes = await page.frames();
            const hasCaptcha = iframes.some(f => f.url().includes('recaptcha') || f.url().includes('cloudflare'));

            if (hasCaptcha) {
                logCallback(`CAPTCHA DETECTED! Cannot solve automatically in MVP.`);
                await browser.close();
                return { success: false, open: true, captcha: true, forumType: detectedForumType, robotsInfo: robotsTxtInfo, invitationCodes };
            }

            // Submit
            const submitBtn = page.locator('button[type="submit"], input[type="submit"]').first();
            if (await submitBtn.count() > 0) {
                // Check if button is disabled (likely needs invitation code)
                const isDisabled = await submitBtn.evaluate(el => el.disabled || el.hasAttribute('disabled'));
                if (isDisabled) {
                    logCallback(`Submit button is DISABLED. Likely needs invitation code or additional fields.`);
                    await browser.close();
                    return { success: false, open: true, needsInvite: true, forumType: detectedForumType, robotsInfo: robotsTxtInfo, invitationCodes };
                }

                logCallback(`Clicking submit...`);
                await submitBtn.click({ timeout: 10000 });
                await page.waitForTimeout(5000); // Wait for navigation

                // Check success URL or message
                const url = page.url();
                const newBody = await page.innerText('body');
                if (newBody.match(/welcome/i) || newBody.match(/bienvenue/i) || newBody.match(/success/i) || newBody.match(/activate/i)) {
                    await browser.close();
                    return { success: true, forumType: detectedForumType, robotsInfo: robotsTxtInfo, invitationCodes };
                }
            }

            await browser.close();
            return { success: false, open: true, forumType: detectedForumType, robotsInfo: robotsTxtInfo, invitationCodes }; // Open but failed/unknown result
        }

        // If Heuristics failed to find enough fields, OR if we want to force AI check for complex Q&A
        if (passwordInputs === 0 || emailInputs === 0 || (await page.locator('textarea').count()) > 0) {
            logCallback(`Standard heuristics inconclusive. Engaging AI...`);

            // Get relevant HTML (form or body)
            const html = await page.evaluate(() => {
                const forms = document.querySelectorAll('form');
                if (forms.length > 0) {
                    let largest = forms[0];
                    forms.forEach(f => { if (f.innerHTML.length > largest.innerHTML.length) largest = f; });
                    return largest.outerHTML;
                }
                return document.body.innerHTML;
            });

            const aiPlan = await getAIFormFillData(html, target, logCallback);

            if (aiPlan && aiPlan.fill_actions) {
                logCallback(`AI Plan received with ${aiPlan.fill_actions.length} actions.`);

                for (const action of aiPlan.fill_actions) {
                    try {
                        const loc = page.locator(action.selector).first();
                        if (await loc.count() > 0) {
                            if (action.action === 'fill') {
                                await loc.fill(action.value);
                                logCallback(`AI Filled: ${action.selector.slice(0, 20)}...`);
                            } else if (action.action === 'check') {
                                await loc.check();
                            }
                        }
                    } catch (e) {
                        logCallback(`AI Action Failed for ${action.selector}: ${e.message}`);
                    }
                }

                if (aiPlan.submit_selector) {
                    logCallback(`AI Submitting via ${aiPlan.submit_selector}...`);
                    await page.locator(aiPlan.submit_selector).first().click();
                    await page.waitForTimeout(5000);

                    const newBody = await page.innerText('body');
                    if (newBody.match(/welcome/i) || newBody.match(/bienvenue/i) || newBody.match(/success/i)) {
                        await browser.close();
                        return { success: true, forumType: detectedForumType, robotsInfo: robotsTxtInfo, invitationCodes };
                    }
                }

            } else {
                logCallback(`AI could not generate a valid plan.`);
            }
        }

        logCallback(`No successful registration path found.`);
        await browser.close();
        return { success: false, open: false, forumType: detectedForumType, robotsInfo: robotsTxtInfo, invitationCodes };

    } catch (error) {
        logCallback(`Browser Error: ${error.message}`);
        throw error;
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch (closeError) {
                console.error("Error closing browser:", closeError);
            }
        }
    }
}
