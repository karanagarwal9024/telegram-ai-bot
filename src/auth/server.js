import express from 'express';
import { supabase } from '../supabase/client.js';
import { redis } from '../redis/client.js';

export const app = express();
const port = 3000;

// Step 1: Redirect user to Google
app.get('/auth/login', async (req, res) => {
    const telegramUserId = req.query.userId;
    if (!telegramUserId) {
        return res.status(400).send('Missing telegram userId');
    }

    // Generate OAuth link
    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            // We pass the telegramUserId as a query param to the callback
            redirectTo: `http://localhost:3000/auth/callback?userId=${telegramUserId}`,
            queryParams: {
                prompt: 'consent'
            }
        },
    });

    if (error) {
        console.error('OAuth error:', error);
        return res.status(500).send('Failed to initiate login');
    }

    res.redirect(data.url);
});

// Step 2: Handle Google Redirect Callback
app.get('/auth/callback', async (req, res) => {
    const telegramUserId = req.query.userId;
    
    // Supabase automatically handles the code exchange via the URL fragment in SPAs, 
    // but on the server side we need to exchange the code for a session.
    const code = req.query.code;
    
    if (!telegramUserId || !code) {
        return res.status(400).send('Invalid callback parameters');
    }

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    
    if (error) {
        console.error('Session exchange error:', error);
        return res.status(500).send('Failed to verify session');
    }

    // Success! 
    // 1. Store the permanent mapping in Supabase database
    const supabaseUserId = data.session.user.id;
    
    try {
        const { error: dbError } = await supabase
            .from('telegram_users')
            .upsert({ 
                telegram_id: telegramUserId.toString(), 
                supabase_user_id: supabaseUserId 
            });
            
        if (dbError) throw dbError;

        // 2. Store the ultra-fast temporary session in Redis for 24 hours (86400 seconds)
        await redis.set(`session:${telegramUserId}`, supabaseUserId, 'EX', 86400);

        res.send(`
            <html>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: green;">Authentication Successful! 🎉</h1>
                <p>Your Google account has been securely linked to your Telegram bot.</p>
                <p>You can close this window and return to Telegram to start using the bot.</p>
            </body>
            </html>
        `);
    } catch (err) {
        console.error('Database/Redis save error:', err);
        res.status(500).send('Failed to save session data');
    }
});

export const startServer = () => {
    app.listen(port, () => {
        console.log(`Auth Web Server listening on http://localhost:${port}`);
    });
};
