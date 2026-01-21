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


export async function checkTarget(target, logCallback) {
    logCallback(`Connecting to Browserless at ${BROWSERLESS_URL}...`);

    let browser;
    let detectedForumType = null;
    let robotsTxtInfo = null;

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


        // 1. Check for "Closed" keywords (AFTER potential navigation)
        const bodyText = await page.innerText('body');
        if (bodyText.match(/registration.*closed/i) || bodyText.match(/inscriptions.*fermées/i)) {
            await browser.close();
            return { success: false, open: false, forumType: detectedForumType, robotsInfo: robotsTxtInfo };
        }

        // 2. Search for Inputs
        const passwordInputs = await page.locator('input[type="password"]').count();
        const emailInputs = await page.locator('input[type="email"], input[name*="mail"]').count();
        const textareaCount = await page.locator('textarea').count();

        // Use strict heuristics ONLY if it looks like a simple form (no text areas for questions)
        if (passwordInputs > 0 && emailInputs > 0 && textareaCount === 0) {
            logCallback(`Detected registration form! (${emailInputs} email fields, ${passwordInputs} password fields)`);

            // ATTEMPT REGISTRATION
            logCallback(`Attempting to fill form...`);

            // Fill Email
            await page.locator('input[type="email"], input[name*="mail"]').first().fill(target.email);

            // Fill Pseudo/Username
            const usernameInput = page.locator('input[name*="user"], input[name*="pseudo"], input[name*="login"]');
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

            // Check for Captcha frames
            const iframes = await page.frames();
            const hasCaptcha = iframes.some(f => f.url().includes('recaptcha') || f.url().includes('cloudflare'));

            if (hasCaptcha) {
                logCallback(`CAPTCHA DETECTED! Cannot solve automatically in MVP.`);
                await browser.close();
                return { success: false, open: true, captcha: true, forumType: detectedForumType, robotsInfo: robotsTxtInfo };
            }

            // Submit
            const submitBtn = page.locator('button[type="submit"], input[type="submit"]').first();
            if (await submitBtn.count() > 0) {
                logCallback(`Clicking submit...`);
                await submitBtn.click();
                await page.waitForTimeout(5000); // Wait for navigation

                // Check success URL or message
                const url = page.url();
                const newBody = await page.innerText('body');
                if (newBody.match(/welcome/i) || newBody.match(/bienvenue/i) || newBody.match(/success/i) || newBody.match(/activate/i)) {
                    await browser.close();
                    return { success: true, forumType: detectedForumType, robotsInfo: robotsTxtInfo };
                }
            }

            await browser.close();
            return { success: false, open: true, forumType: detectedForumType, robotsInfo: robotsTxtInfo }; // Open but failed/unknown result
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
                        return { success: true, forumType: detectedForumType, robotsInfo: robotsTxtInfo };
                    }
                }

            } else {
                logCallback(`AI could not generate a valid plan.`);
            }
        }

        logCallback(`No successful registration path found.`);
        await browser.close();
        return { success: false, open: false, forumType: detectedForumType, robotsInfo: robotsTxtInfo };

    } catch (error) {
        logCallback(`Browser Error: ${error.message}`);
        if (browser) await browser.close();
        throw error;
    }
}
