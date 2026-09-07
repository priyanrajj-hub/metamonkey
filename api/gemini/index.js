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

        try {
            const response = await ai.models.generateContent({
                model: targetModel,
                contents: textPrompt
            });

            // Modern SDK exposes response.text natively.
            let replyText = "";
            if (response.text) {
                replyText = response.text;
            } else if (response.candidates && response.candidates[0]?.content?.parts?.[0]?.text) {
                replyText = response.candidates[0].content.parts[0].text;
            } else {
                throw new Error("No text returned from Gemini API.");
            }

            return res.status(200).json({ text: replyText });

        } catch (apiError) {
            console.error("SDK Execution Error (Gemini):", apiError?.status || apiError?.code || 'Unknown status', apiError);
            let errorType = "Unknown Error";
            if (apiError.status === 404 || apiError.code === 404) errorType = "Model Deprecated/Not Found";
            else if (apiError.status === 429 || apiError.code === 429) errorType = "Rate Limit Exceeded";
            else if (apiError.status === 403 || apiError.code === 403 || apiError.status === 401 || apiError.code === 401) errorType = "Authentication/Permission Denied";

            return res.status(500).json({
                error: `Gemini API Error [${errorType}] — Details: ` + (apiError.message || apiError)
            });
        }

    } catch (e) {
        console.error("Critical Exception:", e);
        return res.status(500).json({ error: "Fatal Proxy Exception: " + (e.message || "Unknown error") });
    }
};
