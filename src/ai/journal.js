import {ChatGoogle} from "@langchain/google"
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import dotenv from 'dotenv';

dotenv.config();

// Initialize the Gemini model
const model = new ChatGoogle({
    model: 'gemini-3.1-flash-lite',
    apiKey: process.env.GOOGLE_API_KEY,
    temperature: 0.7,
});

// The Persona
const SYSTEM_PROMPT = `You are a highly empathetic and insightful personal journaling assistant.
Your goal is to help the user reflect on their day, explore their thoughts, and organize their feelings.
Be supportive, ask thoughtful follow-up questions, and maintain a conversational, non-judgmental tone.

CRITICAL INSTRUCTIONS FOR YOUR TONE AND STYLE:
1. Act like a real human texting a friend.
2. Adjust your response length naturally: give short, punchy 1-2 sentence replies for basic questions or simple statements. Only give longer responses when the user asks a deep question that requires a detailed explanation.
3. DO NOT use any markdown formatting like bold (**), italics (*), or bullet points in your reply. Reply in plain, normal text message style.

CRITICAL INSTRUCTION FOR CATEGORIZATION AND TAGGING:
At the very end of your response, you MUST append exactly two lines:
1. A single high-level category word prefixed with 'CATEGORY:'.
2. A list of 1-3 detailed tags prefixed with 'TAGS:'.

Example output format:
Your friendly reply message here...
CATEGORY: Health
TAGS: sleep, diet, feeling better`;

import { searchSimilarEntries } from './memory.js';

export const analyzeQuery = async (userInput) => {
    const prompt = `Analyze this user message for a journaling app.
If the user is trying to recall past memories that belong to a clear category (e.g., "What was my workout?"), output that Category.
If the query is just a broad statement or a normal journal entry (e.g. "I went to the store today"), output null for category.

Output ONLY a raw JSON object like this (no markdown, no backticks):
{"category": "Health"}

User Message: "${userInput}"`;

    try {
        const response = await model.invoke([new HumanMessage(prompt)]);
        let text = response.content.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(text);
        return {
            categoryFilter: parsed.category || null,
            tagsFilter: []
        };
    } catch (error) {
        console.error("Query Analysis Error:", error);
        return { categoryFilter: null, tagsFilter: [] };
    }
};

export const generateJournalResponse = async (userId, userInput) => {
    // 1. Search for relevant past entries using pure Vector Similarity
    // We bypass the Hard-Filter because AI-generated categories (like "Family" vs "Personal") 
    // can mismatch and accidentally hide valid memories!
    const pastContext = await searchSimilarEntries(userId, userInput, null, []);
    
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

    // 3. Create a stateless array with the persona, the injected past memory, and the immediate user input
    const messages = [
        new SystemMessage(SYSTEM_PROMPT + contextString),
        new HumanMessage(userInput)
    ];

    // 4. Generate the AI response statelessly and parse tags/category
    try {
        const aiResponse = await model.invoke(messages);
        const fullContent = aiResponse.content;
        
        let reply = fullContent;
        let tags = [];
        let category = null;
        
        // Extract CATEGORY
        const categoryMatch = fullContent.match(/CATEGORY:\s*(.+)/i);
        if (categoryMatch) {
            category = categoryMatch[1].trim();
            reply = reply.replace(categoryMatch[0], '').trim();
        }
        
        // Extract TAGS
        const tagsMatch = fullContent.match(/TAGS:\s*(.+)/i);
        if (tagsMatch) {
            const tagString = tagsMatch[1].trim();
            tags = tagString.split(',').map(t => t.trim().toLowerCase().replace('#', ''));
            reply = reply.replace(tagsMatch[0], '').trim();
        }
        
        return { reply, tags, category };
    } catch (error) {
        console.error("AI Generation Error:", error);
        return { 
            reply: "I'm sorry, I'm having trouble processing that right now. Could you please try again?", 
            tags: [],
            category: null
        };
    }
};
