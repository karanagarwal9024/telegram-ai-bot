import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be provided!');
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        flowType: 'pkce',
        detectSessionInUrl: false,
        autoRefreshToken: false,
        persistSession: false
    }
});
