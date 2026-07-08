import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import { redis } from '../redis/client.js';
import { supabase } from '../supabase/client.js';
import { generateJournalResponse } from '../ai/journal.js';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN must be provided!');
}

export const bot = new Telegraf(token);

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
    
    // Send a typing indicator so the user knows the AI is thinking
    await ctx.sendChatAction('typing');
    
    // Generate the personalized journal response
    const aiResponse = await generateJournalResponse(userId, text);
    
    await ctx.reply(aiResponse);
});

export const launchBot = async () => {
    await bot.launch();
    console.log('Telegram Bot successfully launched via long polling.');

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
};
