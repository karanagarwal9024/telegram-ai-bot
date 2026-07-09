import {ChatGoogle} from "@langchain/google"
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import dotenv from 'dotenv';

dotenv.config();

// Initialize the Gemini model
const model = new ChatGoogle({
    model: 'gemini-3.5-flash',
    apiKey: process.env.GOOGLE_API_KEY,
    temperature: 0.7,
});

// The Persona
const SYSTEM_PROMPT = `You are a highly empathetic and insightful personal journaling assistant.
Your goal is to help the user reflect on their day, explore their thoughts, and organize their feelings.
Be supportive, ask thoughtful follow-up questions, and maintain a conversational, non-judgmental tone.`;

export const generateJournalResponse = async (userId, userInput) => {
    // 1. Create a stateless array with just the persona and the immediate user input
    // This uses extremely few tokens since it does not pass conversation history!
    const messages = [
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(userInput)
    ];

    // 2. Generate the AI response statelessly
    try {
        const aiResponse = await model.invoke(messages);
        return aiResponse.content;
    } catch (error) {
        console.error("AI Generation Error:", error);
        return "I'm sorry, I'm having trouble processing that right now. Could you please try again?";
    }
};
