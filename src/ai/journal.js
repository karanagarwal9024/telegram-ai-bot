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

import { searchSimilarEntries } from './memory.js';

export const generateJournalResponse = async (userId, userInput) => {
    // 1. Search for relevant past entries using Vector Similarity
    const pastContext = await searchSimilarEntries(userId, userInput);
    
    let contextString = "";
    if (pastContext.length > 0) {
        contextString = "\n\nIMPORTANT CONTEXT - Here are relevant past journal entries from the user:\n";
        pastContext.forEach(entry => {
            const date = new Date(entry.created_at).toLocaleDateString();
            
            let mediaContext = "";
            if (entry.content_type === 'image' || entry.content_type === 'document') {
                const link = entry.drive_file_id ? `(Link: https://drive.google.com/file/d/${entry.drive_file_id}/view)` : "";
                mediaContext = `[User uploaded a ${entry.content_type} ${link}] `;
            }
            
            contextString += `- On ${date}: ${mediaContext}(User said: "${entry.raw_content}") (AI Summary: "${entry.ai_summary}")\n`;
        });
    }

    // 2. Create a stateless array with the persona, the injected past memory, and the immediate user input
    const messages = [
        new SystemMessage(SYSTEM_PROMPT + contextString),
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
