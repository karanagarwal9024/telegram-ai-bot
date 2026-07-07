import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import { redis } from '../redis/client.js';

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
    const userId = ctx.from.id;
    await redis.del(`session:${userId}`);
    return ctx.reply('You have been logged out.');
});

// Authentication Middleware
bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    
    // Bypass auth for login command
    if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/login')) {
        return next();
    }
    
    const userId = ctx.from.id;
    const isAuth = await redis.get(`session:${userId}`);
    
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

bot.on('text', (ctx) => {
    ctx.reply(`Echo: ${ctx.message.text}`);
});

export const launchBot = async () => {
    await bot.launch();
    console.log('Telegram Bot successfully launched via long polling.');

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
};
