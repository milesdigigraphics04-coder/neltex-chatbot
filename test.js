const { GoogleGenerativeAI } = require("@google/generative-ai");

// I-paste mo ang bago mong key sa loob ng single quotes sa ibaba:
const genAI = new GoogleGenerativeAI('AIzaSyBy6I88FYsfDJFtv4Lrmu2ecyTrlz_iTqA');
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

async function runTest() {
    console.log("Kinakausap si Gemini, sandali lang...");
    try {
        const result = await model.generateContent("Mag-hello world ka nga.");
        console.log("SAGOT NI GEMINI: ", result.response.text());
    } catch (error) {
        console.error("MAY ERROR NA LUMABAS: ", error.message);
    }
}

runTest();