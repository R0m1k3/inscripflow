import OpenAI from 'openai';

let openai = null;
let aiConfig = {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    model: 'google/gemini-2.0-flash-001'
};

export const configureAI = (apiKey, model = null) => {
    aiConfig.apiKey = apiKey;
    if (model) aiConfig.model = model;

    // Default to a stable model if the current one is problematic
    if (!aiConfig.model || aiConfig.model.includes('free')) {
        aiConfig.model = 'google/gemini-2.0-flash-001';
    }

    if (apiKey) {
        openai = new OpenAI({
            baseURL: "https://openrouter.ai/api/v1",
            apiKey: apiKey,
            defaultHeaders: {
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "Forum Sniper",
            }
        });
    }
};

export const getAIFormFillData = async (htmlContent, userData, logCallback) => {
    if (!openai) {
        logCallback("AI not configured. Skipping AI analysis.");
        return null;
    }

    logCallback("Sending form to Gemini AI for analysis...");

    const prompt = `
  You are an expert form filler. Your task is to analyze the provided HTML form and generate a JSON object to fill it.
  
  CONTEXT:
  - User Persona: A friendly tech enthusiast who wants to join this community to share knowledge and learn server administration.
  - User Data:
    - Pseudo: ${userData.pseudo}
    - Email: ${userData.email}
    - Password: ${userData.password}

  INSTRUCTIONS:
  1. Identify all input fields (text, email, password, textarea, select, radio, checkbox).
  2. Map the User Data to the appropriate fields.
  3. For any other field (security questions, "why join", location, etc.), GENERATE A REALISTIC ANSWER based on the persona.
  4. IGNORE hidden fields unless they look critical (like anti-bot tokens that need unmodified values, usually skip).
  5. IGNORE search bars or login fields if this is a registration page. Focus on Registration.
  
  OUTPUT FORMAT (JSON ONLY):
  {
    "fill_actions": [
      { "selector": "css_selector_for_field", "value": "value_to_fill", "action": "fill" },
      { "selector": "css_selector_for_checkbox", "value": "true", "action": "check" }
    ],
    "submit_selector": "css_selector_for_submit_button"
  }

  HTML FORM SEGMENT:
  ${htmlContent.substring(0, 15000)} 
  `;

    try {
        const completion = await openai.chat.completions.create({
            model: aiConfig.model,
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" }
        });

        const response = JSON.parse(completion.choices[0].message.content);
        logCallback("AI analysis complete.");
        return response;
    } catch (error) {
        logCallback(`AI Error: ${error.message}`);
        return null;
    }
};
