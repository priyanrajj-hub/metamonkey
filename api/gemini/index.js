const { GoogleGenAI } = require('@google/genai');

const requestSpamMap = new Map();

module.exports = async (req, res) => {
    try {
        const apiKey = process.env.GEMINI_API_KEY || "";

        if (!apiKey || apiKey === '' || apiKey.includes('YOUR_API_KEY')) {
            console.warn("[CANOPY SERVER] WARNING: GEMINI_API_KEY is undefined or empty. AI insights will silently fail or fallback.");
            return res.status(503).json({ error: "API Key missing! Please configure GEMINI_API_KEY in Vercel Deployment Settings." });
        }

        const ip = req.headers['x-forwarded-for'] || 'anonymous';
        const now = Date.now();
        if (requestSpamMap.has(ip)) {
            const hits = requestSpamMap.get(ip);
            if (hits.length >= 2) {
                const oldest = hits[0];
                if (now - oldest < 10000) {
                    return res.status(429).json({ error: "Rate limit exceeded. Please wait 10 seconds." });
                } else {
                    hits.shift();
                }
            }
            hits.push(now);
        } else {
            requestSpamMap.set(ip, [now]);
        }
        if (requestSpamMap.size > 200) requestSpamMap.clear();

        const body = req.body;
        let textPrompt = "";
        if (body && body.contents) {
            textPrompt = body.contents[0].parts[0].text;
        } else if (body && body.prompt) {
            textPrompt = body.prompt;
        } else {
            return res.status(400).json({ error: "Missing prompt or contents payload" });
        }

        const ai = new GoogleGenAI({ apiKey: apiKey });

        let targetModel = process.env.GEMINI_MODEL_NAME || "gemini-1.5-flash";
        targetModel = targetModel.replace('models/', '');

        let apiUrl = "";
        let rawResponse = null;
        let rawText = "";

        const generateWithFallback = async (modelName, isRetry = false) => {
            const DEBUG = false;

            if (DEBUG) console.log(`\n--- [GEMINI VERBOSE DEBUG START] [${isRetry ? 'RETRY' : 'PRIMARY'}] ---`);
            apiUrl = `https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent?key=${apiKey}`;

            const headers = { 'Content-Type': 'application/json' };

            rawResponse = await fetch(apiUrl, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ contents: [{ parts: [{ text: textPrompt }] }] })
            });

            if (DEBUG) console.log(`[DEBUG] HTTP Status Code: ${rawResponse.status} ${rawResponse.statusText}`);
            rawText = await rawResponse.text();
            if (DEBUG) {
                console.log(`[DEBUG] Exact request URL: ${apiUrl.replace(apiKey, 'REDACTED_API_KEY')}`);
                console.log(`[DEBUG] Model Name: ${modelName}`);
                console.log(`[DEBUG] Full raw body:\n`, rawText);
                console.log("--- [GEMINI VERBOSE DEBUG END] ---\n");
            }

            if (!rawResponse.ok) {
                // If 503 overloaded and we haven't retried yet, throw a specific code to trigger fallback
                if (rawResponse.status === 503 && !isRetry) {
                    throw { type: 'OVERLOADED', message: rawText };
                }
                throw new Error(`HTTP Error ${rawResponse.status}: ${rawText}`);
            }

            const jsonResponse = JSON.parse(rawText);

            if (jsonResponse.candidates && jsonResponse.candidates[0]?.content?.parts?.[0]?.text) {
                return jsonResponse.candidates[0].content.parts[0].text;
            } else {
                throw new Error("No text returned from Gemini API. Body: " + JSON.stringify(jsonResponse));
            }
        };

        try {
            let replyText = "";
            try {
                // Try primary model
                replyText = await generateWithFallback(targetModel, false);
            } catch (err) {
                if (err.type === 'OVERLOADED') {
                    console.log(`[CANOPY AI INSIGHT] Model ${targetModel} overloaded (503). Falling back to gemini-1.5-flash...`);
                    replyText = await generateWithFallback("gemini-1.5-flash", true);
                } else {
                    throw err; // Re-throw other errors
                }
            }

            console.log("[CANOPY AI INSIGHT] Successful generation from Gemini API.");
            return res.status(200).json({ text: replyText });

        } catch (apiError) {
            console.error("SDK Execution Error (Gemini):", apiError);
            let errorType = "Unknown Error";
            let statusCode = 500;
            let rawDetails = apiError.message || String(apiError);

            if (apiError.message) {
                if (apiError.message.includes("404") || apiError.message.includes("models/")) errorType = "Model Deprecated/Not Found";
                else if (apiError.message.includes("429")) { errorType = "Rate Limit Exceeded"; statusCode = 429; }
                else if (apiError.message.includes("403") || apiError.message.includes("401")) { errorType = "Authentication/Permission Denied"; statusCode = 401; }
                else if (apiError.message.includes("503")) { errorType = "AI Service Overloaded"; statusCode = 503; }

                let match = apiError.message.match(/HTTP Error (\d+):/);
                if (match) statusCode = parseInt(match[1], 10);
            }

            console.error(`[CANOPY SERVER] Gemini Request Failed. Status: ${statusCode}, Type: ${errorType}, Raw Details: ${rawDetails}`);

            return res.status(statusCode).json({
                error: `Gemini API Error [${errorType}]`,
                message: rawDetails,
                status: statusCode
            });
        }

    } catch (e) {
        console.error("Critical Exception:", e);
        return res.status(500).json({ error: "Fatal Proxy Exception: " + (e.message || "Unknown error") });
    }
};
