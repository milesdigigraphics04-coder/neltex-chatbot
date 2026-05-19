require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(bodyParser.json());

// Basic route to check if server is running
app.get('/', (req, res) => {
    res.send('Chatbot Webhook Server is running!');
});

// Load pricing data and initialize Gemini
// BAGONG CODE PARA SA GOOGLE SHEETS:

// ILAGAY MO ITO SA IBABAW NG "let model;"
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
let model;
const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRg-jxZlm3naMU94SLwrgBJ9oxLS8lXp_WMRC8nTAfilDpyUKnUKW6ZSqN-6ZrFJ7aH35L_CT4sgt0J/pub?output=csv';

async function initializeAI() {
    try {
        // Kukunin ng server ang laman ng Google Sheet
        const response = await axios.get(SHEET_CSV_URL);
        const pricingData = response.data;

        const systemInstruction = `You are a polite sales representative. ALWAYS reply in very short, direct-to-the-point Taglish. Use "po" and "opo".
        
        Database:
        ${pricingData}
        
        RULES:
        1. Keep answers short (1-2 sentences max if just asking for a price).
        2. If quoting multiple items, give the list and Grand Total immediately.
        3. Base all prices ONLY on the database.
        4. CRITICAL RULE: If the user asks about an item NOT in the database, or asks a question completely unrelated to our products, YOU MUST REPLY WITH EXACTLY THIS WORD AND NOTHING ELSE: NO_REPLY
        
        FORMAT FOR SINGLE ITEM:
        "Hello po! Ang [Item] po ay ₱[Price]. May idadagdag po ba kayo?"
        
        FORMAT FOR MULTIPLE ITEMS (QUOTATION):
        "Ito po ang quotation niyo:
        - [Qty]x [Item] @ ₱[Price] = ₱[Total]
        Grand Total: ₱[Sum]
        Let me know po kung ipapa-process na. Salamat!"`;

        // Bubuhayin si Gemini kasama ang bagong data
        model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash", // (O gemini-2.5-flash, kung ano man ang napagana mo kanina)
            systemInstruction: systemInstruction,
        });

        console.log("✅ Google Sheets Pricing Data loaded successfully!");
    } catch (error) {
        console.error("❌ Error loading Google Sheet:", error.message);
    }
}

// Patakbuhin ang function para mag-load pag-start ng server
initializeAI();

// BONUS: Awtomatikong magre-refresh ang presyo every 1 hour (3600000 milliseconds)
// Para hindi mo na kailangang i-restart ang server kapag may iniba ka sa Sheet!
setInterval(initializeAI, 3600000);

// In-memory conversation history
const conversationHistory = {};

// Facebook Webhook Verification
app.get('/webhook', (req, res) => {
    const verify_token = process.env.VERIFY_TOKEN;

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === verify_token) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
});

// Webhook endpoint to receive messages from Messenger
app.post('/webhook', async (req, res) => {
    try {
        const body = req.body;

        // Check if this is an event from a page subscription
        if (body.object === 'page') {
            // Iterate over each entry - there may be multiple if batched
            for (const entry of body.entry) {
                // Get the webhook event. entry.messaging is an array, but 
                // will only ever contain one event, so we get index 0
                const webhook_event = entry.messaging[0];

                const sender_psid = webhook_event.sender.id;

                if (webhook_event.message) {
                    const messageText = webhook_event.message.text;
                    const attachments = webhook_event.message.attachments;

                    console.log(`Sender ID: ${sender_psid}`);
                    if (messageText) console.log(`Message: ${messageText}`);

                    let userParts = [];
                    if (messageText) {
                        userParts.push(messageText);
                    }

                    if (attachments && attachments[0].type === 'image') {
                        const imageUrl = attachments[0].payload.url;
                        console.log(`Received image attachment: ${imageUrl}`);
                        try {
                            const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
                            const mimeType = response.headers['content-type'] || 'image/jpeg';
                            userParts.push({
                                inlineData: {
                                    data: Buffer.from(response.data, 'binary').toString('base64'),
                                    mimeType: mimeType
                                }
                            });
                        } catch (err) {
                            console.error('Error fetching image:', err.message);
                        }
                    }

                    if (userParts.length > 0) {
                        try {
                            // Initialize history if not present
                            if (!conversationHistory[sender_psid]) {
                                conversationHistory[sender_psid] = [];
                            }

                            const chatSession = model.startChat({
                                history: conversationHistory[sender_psid]
                            });

                            const result = await chatSession.sendMessage(userParts);
                            const responseText = result.response.text();

                            // Update our in-memory history
                            conversationHistory[sender_psid] = await chatSession.getHistory();

                            // Keep history bounded to avoid large memory use (e.g. max 20 messages = 10 turns)
                            if (conversationHistory[sender_psid].length > 20) {
                                // startChat history must start with user, so we remove the oldest 2 elements (1 turn)
                                conversationHistory[sender_psid].splice(0, 2);
                            }

                            // BAGONG LOGIC: I-check kung nag-trigger ang secret code
                            if (responseText.trim().includes("NO_REPLY")) {
                                console.log("🤫 Hindi sumagot ang AI dahil wala sa listahan o iba ang tanong.");
                            } else {
                                // Send a reply back using the helper function
                                await sendMessage(sender_psid, responseText);
                            }
                        } catch (err) {
                            console.error('Error generating AI response:', err);
                            await sendMessage(sender_psid, 'Sorry, I am having trouble processing your request right now.');
                        }
                    }
                }
            }

            // Return a '200 OK' response to all requests
            res.status(200).send('EVENT_RECEIVED');
        } else {
            // Return a '404 Not Found' if event is not from a page subscription
            res.sendStatus(404);
        }
    } catch (error) {
        console.error('Error handling webhook request:', error);
        res.status(500).send('Internal server error');
    }
});

// Helper function to send messages back to the user via Facebook Graph API
async function sendMessage(sender_psid, response_text) {
    const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
    const request_body = {
        recipient: {
            id: sender_psid
        },
        message: {
            text: response_text
        }
    };

    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, request_body);
        console.log('Message sent successfully!');
    } catch (error) {
        console.error('Unable to send message:', error.response ? error.response.data : error.message);
    }
}

// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
