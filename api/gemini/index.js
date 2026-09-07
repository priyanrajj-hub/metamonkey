const { GoogleGenAI } = require('@google/genai');

const requestSpamMap = new Map();

module.exports = async (req, res) => {
    try {
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey || apiKey === '' || (typeof apiKey === 'string' && apiKey.includes('YOUR_API_KEY'))) {
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

        let targetModel = process.env.GEMINI_MODEL_NAME || "gemini-3.8-flash";
        targetModel = targetModel.replace('models/', '');

        let apiUrl = "";
        let rawResponse = null;
        let rawText = "";

        try {
            console.log("\n--- [GEMINI VERBOSE DEBUG START] ---");
            apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;

            console.log(`[DEBUG] Exact request URL: ${apiUrl.replace(apiKey, 'REDACTED_API_KEY')}`);
            console.log(`[DEBUG] Model Name: ${targetModel}`);
            console.log(`[DEBUG] API Version: v1beta`);

            rawResponse = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: textPrompt }] }] })
            });

            console.log(`[DEBUG] HTTP Status Code: ${rawResponse.status} ${rawResponse.statusText}`);

            rawText = await rawResponse.text();
            console.log(`[DEBUG] Full raw error/response body:\n`, rawText);
            console.log("--- [GEMINI VERBOSE DEBUG END] ---\n");

            if (!rawResponse.ok) {
                throw new Error(`HTTP Error ${rawResponse.status}: ${rawText}`);
            }

            const jsonResponse = JSON.parse(rawText);

            let replyText = "";
            if (jsonResponse.candidates && jsonResponse.candidates[0]?.content?.parts?.[0]?.text) {
                replyText = jsonResponse.candidates[0].content.parts[0].text;
            } else {
                throw new Error("No text returned from Gemini API. Body: " + JSON.stringify(jsonResponse));
            }

            return res.status(200).json({ text: replyText });

        } catch (apiError) {
            console.error("SDK Execution Error (Gemini):", apiError);
            let errorType = "Unknown Error";
            // Check message for HTTP errors
            if (apiError.message && (apiError.message.includes("404") || apiError.message.includes("models/"))) errorType = "Model Deprecated/Not Found";
            else if (apiError.message && apiError.message.includes("429")) errorType = "Rate Limit Exceeded";
            else if (apiError.message && (apiError.message.includes("403") || apiError.message.includes("401"))) errorType = "Authentication/Permission Denied";

            return res.status(500).json({
                error: `Gemini API Error [${errorType}] — Details: ` + (apiError.message || apiError),
                debug_info: `\n\n--- [DEBUG START] ---\nURL: ${apiUrl ? apiUrl.replace(apiKey, 'REDACTED') : 'URL not reached'}\nModel: ${targetModel}\nHTTP Status: ${rawResponse && rawResponse.status ? rawResponse.status : 'Unknown'}\nRaw Response Body: ${rawText ? rawText : 'No body read'}\n--- [DEBUG END] ---`
            });
        }

    } catch (e) {
        console.error("Critical Exception:", e);
        return res.status(500).json({ error: "Fatal Proxy Exception: " + (e.message || "Unknown error") });
    }
};
