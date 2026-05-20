require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");

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
let genAI; // I-declare lang muna natin na blangko
let model;
const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRg-jxZlm3naMU94SLwrgBJ9oxLS8lXp_WMRC8nTAfilDpyUKnUKW6ZSqN-6ZrFJ7aH35L_CT4sgt0J/pub?output=csv';

async function initializeAI() {
    try {
        // DITO NATIN SIYA BUBUHAYIN PARA SIGURADONG BULSANG-BULSA NIYA NA YUNG SUSI MULA SA RENDER:
        genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

        // Kukunin ng server ang laman ng Google Sheet
        const response = await axios.get(SHEET_CSV_URL);
        const pricingData = response.data;

        const systemInstruction = `Ikaw ay isang magalang, ma-diskarte, at helpful na sales representative. Sumagot palagi sa maikli, direct-to-the-point na Taglish. Ang goal mo ay makabenta at magbigay ng magandang customer service.
        
        PRICELIST DATABASE:
        ${pricingData}
        
        MGA DAPAT MONG SUNDIN:
        1. TONE: Gumamit ng "po" para magalang, pero HUWAG gumamit ng "opo" sa dulo ng pangungusap. Maging natural.
        2. 5% DISCOUNT: LAHAT ng items ay may awtomatikong 5% discount! Bawasan ng 5% ang original price (Original Price x 0.95 = Discounted Price). Ipaalam nang masaya sa customer na may 5% discount sila.
        3. QUOTATION FORMAT: Kapag naglilista, gawin itong malinis. HUWAG gagamit ng double quotes (") o inch symbols. Sundan ang format na ito:
        • [Qty] pcs - [Item Name] @ ₱[Discounted Price] = ₱[Total]
        4. KAPAG IBA ANG TANONG: Makipag-chat ka nang natural at helpful.
        5. HABA NG SAGOT: Keep it conversational (1-3 sentences max).
        6. KAPAG MARAMING PAGPIPILIAN (CRITICAL): Kapag naghanap ang customer ng item na may napakaraming variant (halimbawa: "2 inch elbow" na may Powerguard, Waterline, Saniguard), HUWAG mong ilista lahat ng presyo dahil mapuputol ang message mo sa Facebook. Sa halip, ibigay lang ang presyo ng 1 o 2 best-sellers at tanungin ang customer kung anong specific variant ang hanap nila.`;

        // Bubuhayin si Gemini kasama ang bagong data at NAKA-OFF ANG MGA FILTERS
        model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            systemInstruction: systemInstruction,
            safetySettings: [
                {
                    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                    threshold: HarmBlockThreshold.BLOCK_NONE,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                    threshold: HarmBlockThreshold.BLOCK_NONE,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                    threshold: HarmBlockThreshold.BLOCK_NONE,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                    threshold: HarmBlockThreshold.BLOCK_NONE,
                },
            ],
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
            res.status(200).send('EVENT_RECEIVED');

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
