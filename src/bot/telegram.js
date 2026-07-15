import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import { redis } from '../redis/client.js';
import { supabase } from '../supabase/client.js';
import { generateJournalResponse } from '../ai/journal.js';
import { mediaQueue } from '../queue/index.js';
import { downloadTelegramFile } from './mediaHelper.js';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { generateEmbedding } from '../ai/memory.js';
import fs from 'fs';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN must be provided!');
}

export const bot = new Telegraf(token);

// Utility to send long messages to Telegram without hitting the 4096 char limit
const sendLongMessage = async (ctx, text) => {
    const MAX_LENGTH = 4000;
    for (let i = 0; i < text.length; i += MAX_LENGTH) {
        await ctx.reply(text.slice(i, i + MAX_LENGTH));
    }
};

// A dedicated model for analyzing images
const visionModel = new ChatGoogleGenerativeAI({
    model: 'gemini-3.5-flash',
    apiKey: process.env.GOOGLE_API_KEY,
    temperature: 0.4,
});

bot.command('login', async (ctx) => {
    const userId = ctx.from.id;
    const loginUrl = `http://localhost:3000/auth/login?userId=${userId}`;
    
    // We use HTML parse_mode to force Telegram to make the localhost URL a clickable link
    return ctx.reply(
        `Please click the link below to securely log in with Google:\n\n<a href="${loginUrl}">${loginUrl}</a>`,
        { parse_mode: 'HTML' }
    );
});

bot.command('logout', async (ctx) => {
    const userId = ctx.from.id.toString();
    
    // 1. Delete from Redis
    await redis.del(`session:${userId}`);
    
    // 2. Delete from Supabase permanent storage
    await supabase.from('telegram_users').delete().eq('telegram_id', userId);
    
    return ctx.reply('You have been logged out completely. You will need to re-authenticate to use the bot.');
});

// Authentication Middleware (Hybrid Session Check)
bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    
    // Bypass auth for login command
    if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/login')) {
        return next();
    }
    
    const userId = ctx.from.id.toString();
    
    // 1. Check Redis for ultra-fast temporary session
    let isAuth = await redis.get(`session:${userId}`);
    
    // 2. If not in Redis, check Supabase permanent storage
    if (!isAuth) {
        const { data, error } = await supabase
            .from('telegram_users')
            .select('supabase_user_id')
            .eq('telegram_id', userId)
            .single();
            
        if (data && data.supabase_user_id) {
            // Rehydrate Redis for another 24 hours
            await redis.set(`session:${userId}`, data.supabase_user_id, 'EX', 86400);
            isAuth = data.supabase_user_id;
        }
    }
    
    // 3. If still not authenticated, block them
    if (!isAuth) {
        return ctx.reply('🔒 You are not authorized. Please type /login to authenticate with Google.');
    }
    
    return next();
});

// Rate Limiting Middleware
bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    
    const userId = ctx.from.id;
    const key = `rate_limit:${userId}`;
    
    try {
        const requests = await redis.incr(key);
        if (requests === 1) {
            await redis.expire(key, 10); // 10 seconds window
        }
        
        if (requests > 5) {
            await ctx.reply('⚠️ You are sending messages too fast! Please slow down.');
            return;
        }
    } catch (error) {
        console.error('Redis error in rate limit', error);
    }
    
    return next();
});

bot.command('start', (ctx) => {
    ctx.reply('Welcome to the AI Bot! Send me text, voice notes, images, or PDFs.');
});

bot.on('text', async (ctx) => {
    const userId = ctx.from.id.toString();
    const text = ctx.message.text;
    
    await ctx.sendChatAction('typing');
    const { reply: aiResponse, tags, category } = await generateJournalResponse(userId, text);
    
    const embeddingText = `User: ${text}\nAI: ${aiResponse}`;
    const embeddingVector = await generateEmbedding(embeddingText);
    
    // Log text to database
    await supabase.from('journal_entries').insert({
        telegram_id: userId,
        content_type: 'text',
        raw_content: text,
        ai_summary: aiResponse,
        embedding: embeddingVector,
        tags: tags,
        category: category
    });
    
    await sendLongMessage(ctx, aiResponse);
});

// Handle Photos
bot.on('photo', async (ctx) => {
    const userId = ctx.from.id.toString();
    const caption = ctx.message.caption || '';
    
    await ctx.sendChatAction('typing');
    
    // Get highest resolution photo
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileId = photo.file_id;
    const fileName = `${Date.now()}_image.jpg`;
    
    try {
        // 1. Download file locally
        const filePath = await downloadTelegramFile(fileId, fileName);
        
        // 2. Read image for Gemini Vision
        const imageBase64 = fs.readFileSync(filePath, { encoding: 'base64' });
        
        // 3. Get AI Analysis immediately
        const visionResponse = await visionModel.invoke([
            new SystemMessage(`Please provide a highly detailed, descriptive transcription of everything visible in this image. Do not reply to me, just provide the exact description of the image.`),
            new HumanMessage({
                content: [
                    { type: "text", text: `Here is a photo for my journal. Caption: ${caption}` },
                    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
                ]
            })
        ]);
        
        // Pass 1: Extraction
        let transcription = visionResponse.content;
        
        // Pass 2: Memory Retrieval & Generation
        const { reply: aiResponse, tags, category } = await generateJournalResponse(userId, `[Photo Uploaded. Caption: "${caption}" | Image Description: "${transcription}"]`);
        
        const embeddingText = `User (Photo): ${caption}\nImage Description: ${transcription}\nAI: ${aiResponse}`;
        const embeddingVector = await generateEmbedding(embeddingText);
        
        // 4. Save to Database instantly
        const { data: dbData } = await supabase
            .from('journal_entries')
            .insert({
                telegram_id: userId,
                content_type: 'image',
                raw_content: caption ? `[Photo] ${caption} | Description: ${transcription}` : `[Photo] Description: ${transcription}`,
                ai_summary: aiResponse,
                embedding: embeddingVector,
                tags: tags,
                category: category
            })
            .select()
            .single();
            
        // 5. Send the heavy upload task to BullMQ FIRST to ensure it never gets skipped
        if (dbData) {
            await mediaQueue.add('upload-image', {
                telegramId: userId,
                filePath,
                fileName,
                mimeType: 'image/jpeg',
                journalEntryId: dbData.id
            });
        }
            
        // 6. Instantly reply to unblock the user using the split message helper
        await sendLongMessage(ctx, aiResponse);
        
    } catch (error) {
        console.error("Photo Processing Error:", error);
        ctx.reply("❌ Sorry, I had trouble processing your photo.");
    }
});

// Handle Documents (PDFs, Word Docs, etc.)
bot.on('document', async (ctx) => {
    const userId = ctx.from.id.toString();
    const document = ctx.message.document;
    const caption = ctx.message.caption || '';
    
    await ctx.sendChatAction('typing');
    
    const fileId = document.file_id;
    const fileName = document.file_name || `${Date.now()}_file`;
    const mimeType = document.mime_type;
    
    try {
        // 1. Download file locally
        const filePath = await downloadTelegramFile(fileId, fileName);
        
        let aiSummary = "AI summary is not supported for this file type, but I have backed it up to your Drive!";
        let replyToUser = "I have safely backed this up to your Drive!";
        let tags = [];
        let category = null;
        
        // 2. Check if file is supported by Gemini (PDF, Text, or Uncompressed Images)
        const supportedMimeTypes = [
            'application/pdf', 
            'text/plain', 
            'text/csv',
            'image/jpeg',
            'image/png',
            'image/webp',
            'image/heic',
            'image/heif'
        ];
        
        let transcriptionForEmbedding = "N/A";
        
        if (supportedMimeTypes.includes(mimeType)) {
            // Check if file is too large for Telegram's 90-second synchronous limit (set to 3MB)
            if (document.file_size && document.file_size > 3 * 1024 * 1024) {
                aiSummary = "This document is too large for me to read instantly in chat, but I have securely backed it up to your Drive!";
            } else {
                const fileBase64 = fs.readFileSync(filePath, { encoding: 'base64' });
                
                const visionResponse = await visionModel.invoke([
                    new SystemMessage(`Please provide a highly detailed summary and transcription of the key information in this document. Do not reply to me, just provide the exact transcription/summary.`),
                    new HumanMessage({
                        content: [
                            { type: "text", text: `Here is a document for my journal. Caption: ${caption}` },
                            // LangChain uses the image_url field to pass all multimodal base64 files
                            { type: "image_url", image_url: { url: `data:${mimeType};base64,${fileBase64}` } }
                        ]
                    })
                ]);
                
                // Pass 1: Extraction
                let transcription = visionResponse.content;
                
                // Pass 2: Memory Retrieval & Generation
                const { reply: aiResponse, tags: generatedTags, category: generatedCategory } = await generateJournalResponse(userId, `[Document Uploaded. Caption: "${caption}" | Document Content/Summary: "${transcription}"]`);
                aiSummary = aiResponse;
                replyToUser = aiResponse;
                tags = generatedTags;
                category = generatedCategory;
                
                // Update for embedding
                transcriptionForEmbedding = transcription;
            }
        }
        
        const embeddingText = `User (Document): ${caption}\nDocument Content: ${transcriptionForEmbedding}\nAI: ${aiSummary}`;
        const embeddingVector = await generateEmbedding(embeddingText);
        
        // 3. Save to Database instantly
        const { data: dbData } = await supabase
            .from('journal_entries')
            .insert({
                telegram_id: userId,
                content_type: 'document',
                raw_content: caption ? `[Document] ${caption} | Content: ${transcriptionForEmbedding}` : `[Document] Content: ${transcriptionForEmbedding}`,
                ai_summary: aiSummary,
                embedding: embeddingVector,
                tags: tags,
                category: category
            })
            .select()
            .single();
            
        // 4. Send the heavy upload task to BullMQ FIRST
        if (dbData) {
            await mediaQueue.add('upload-document', {
                telegramId: userId,
                filePath,
                fileName,
                mimeType: mimeType,
                journalEntryId: dbData.id
            });
        }
            
        // 5. Instantly reply to unblock the user
        await sendLongMessage(ctx, replyToUser);
        
    } catch (error) {
        console.error("Document Processing Error:", error);
        ctx.reply("❌ Sorry, I had trouble processing your document.");
    }
});

// Handle Voice Messages
bot.on('voice', async (ctx) => {
    const userId = ctx.from.id.toString();
    const voice = ctx.message.voice;
    
    await ctx.sendChatAction('typing');
    
    const fileId = voice.file_id;
    const fileName = `${Date.now()}_voice.ogg`;
    
    try {
        // 1. Download file locally
        const filePath = await downloadTelegramFile(fileId, fileName);
        const fileBase64 = fs.readFileSync(filePath, { encoding: 'base64' });
        
        // 2. Fetch Gemini REST API directly for audio support
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=' + process.env.GOOGLE_API_KEY;
        const systemPrompt = `Please provide a highly detailed transcription of everything said in this voice note. Do not reply to me, just provide the exact transcription of what the user is saying.`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: {
                    parts: [{ text: systemPrompt }]
                },
                contents: [{
                    parts: [
                        { text: `Here is a voice note for my journal.` },
                        { inlineData: { mimeType: 'audio/ogg', data: fileBase64 } }
                    ]
                }]
            })
        });
        
        const data = await response.json();
        
        if (data.error) {
            throw new Error(`Gemini API Error: ${data.error.message}`);
        }
        
        // Pass 1: Extraction
        let transcription = data?.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't process the audio.";
        
        // Pass 2: Memory Retrieval & Generation
        const { reply: aiResponse, tags, category } = await generateJournalResponse(userId, `[Voice Note Transcription]: ${transcription}`);
        
        const embeddingText = `User (Voice Note): ${transcription}\nAI: ${aiResponse}`;
        const embeddingVector = await generateEmbedding(embeddingText);
        
        // 3. Save to Database instantly
        const { data: dbData } = await supabase
            .from('journal_entries')
            .insert({
                telegram_id: userId,
                content_type: 'voice',
                raw_content: `[Voice Transcription]: ${transcription}`,
                ai_summary: aiResponse,
                embedding: embeddingVector,
                tags: tags,
                category: category
            })
            .select()
            .single();
            
        // 4. Delete the temporary file from the server
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
            
        // 5. Instantly reply to unblock the user
        await sendLongMessage(ctx, aiResponse);
        
    } catch (error) {
        console.error("Voice Processing Error:", error);
        ctx.reply(`❌ Sorry, I had trouble processing your voice message.\n\nError: ${error.message}`);
    }
});

export const launchBot = async () => {
    await bot.launch();
    console.log('Telegram Bot successfully launched via long polling.');

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
};
