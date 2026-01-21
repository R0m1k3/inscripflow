import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_FILE = path.resolve(__dirname, '../settings.json');

console.log("Reading settings from:", SETTINGS_FILE);
let settings = {};
try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
} catch (e) {
    console.error("Failed to read settings.json", e);
    process.exit(1);
}

const apiKey = settings.openRouterKey;
const model = 'google/gemini-2.0-flash-001';

console.log(`Testing with Key: ${apiKey.slice(0, 5)}...${apiKey.slice(-5)}`);
console.log(`Testing with Model: ${model}`);

async function test() {
    try {
        console.log("Sending raw fetch request...");
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "Forum Sniper Test",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: model,
                messages: [{ role: "user", content: "Hello" }]
            })
        });

        console.log("Response Status:", response.status);
        console.log("Response Status Text:", response.statusText);

        const data = await response.text();
        console.log("Response Body:", data);

    } catch (error) {
        console.error("Fetch Error:", error);
    }
}

test();
