import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import { redis } from '../redis/client.js';
import { supabase } from '../supabase/client.js';
import { generateJournalResponse } from '../ai/journal.js';
import { mediaQueue } from '../queue/index.js';
import { downloadTelegramFile } from './mediaHelper.js';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
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
    model: 'gemini-2.5-flash',
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
    const aiResponse = await generateJournalResponse(userId, text);
    
    // Log text to database
    await supabase.from('journal_entries').insert({
        telegram_id: userId,
        content_type: 'text',
        raw_content: text,
        ai_summary: aiResponse
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
            new SystemMessage("You are a helpful journaling assistant. Analyze the image and provide a thoughtful summary or reaction."),
            new HumanMessage({
                content: [
                    { type: "text", text: `Here is a photo for my journal. Caption: ${caption}` },
                    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
                ]
            })
        ]);
        const aiSummary = visionResponse.content;
        
        // 4. Save to Database instantly
        const { data: dbData } = await supabase
            .from('journal_entries')
            .insert({
                telegram_id: userId,
                content_type: 'image',
                raw_content: caption,
                ai_summary: aiSummary
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
        await sendLongMessage(ctx, aiSummary);
        
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
        
        if (supportedMimeTypes.includes(mimeType)) {
            const fileBase64 = fs.readFileSync(filePath, { encoding: 'base64' });
            
            const visionResponse = await visionModel.invoke([
                new SystemMessage("You are a helpful journaling assistant. Analyze the document and provide a thoughtful summary or reaction."),
                new HumanMessage({
                    content: [
                        { type: "text", text: `Here is a document for my journal. Caption: ${caption}` },
                        // LangChain uses the image_url field to pass all multimodal base64 files
                        { type: "image_url", image_url: { url: `data:${mimeType};base64,${fileBase64}` } }
                    ]
                })
            ]);
            aiSummary = visionResponse.content;
        }
        
        // 3. Save to Database instantly
        const { data: dbData } = await supabase
            .from('journal_entries')
            .insert({
                telegram_id: userId,
                content_type: 'document',
                raw_content: caption,
                ai_summary: aiSummary
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
        await sendLongMessage(ctx, aiSummary);
        
    } catch (error) {
        console.error("Document Processing Error:", error);
        ctx.reply("❌ Sorry, I had trouble processing your document.");
    }
});

export const launchBot = async () => {
    await bot.launch();
    console.log('Telegram Bot successfully launched via long polling.');

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
};
