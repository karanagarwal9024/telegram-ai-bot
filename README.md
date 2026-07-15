# Telegram AI Journaling Bot 🧠

An enterprise-grade Telegram bot built to act as your ultimate personal journaling assistant. Unlike simple chatbots, this bot is equipped with **Long-Term Memory (RAG)**, **Decoupled Architecture**, and **Multimodal Processing**, allowing you to log text, voice notes, photos, and documents. It perfectly categorizes and remembers everything you tell it.

## 🚀 Key Features

*   **Long-Term Semantic Memory**: Uses `pgvector` and Gemini embeddings to instantly recall past memories based on the context of your current question.
*   **Two-Pass Architecture**:
    *   **Pass 1**: Analyzes text/media using Gemini Vision or Gemini Audio to extract rich transcriptions.
    *   **Pass 2**: Retrieves related past context from the database and generates a conversational reply.
*   **AI-Based Categorization & Tagging**: Automatically extracts overarching categories (e.g., "Health", "Work") and granular tags (e.g., `#coding`, `#gym`) behind the scenes without cluttering your Telegram chat.
*   **Asynchronous Workers (BullMQ)**: Heavy operations like analyzing 10MB PDFs or uploading files to Google Drive are completely offloaded to background workers (`Redis` + `BullMQ`), ensuring Telegram's 90-second timeout limit is never reached and the bot remains blazing fast.
*   **Google Drive Integration**: Automatically securely backs up your uploaded images and PDFs to your Google Drive.
*   **Network Resilience**: Implements intelligent retries and timeout extensions for Telegram API downloads.

## 🛠️ Technology Stack

*   **Backend Runtime**: Node.js (Express & ES Modules)
*   **Bot Framework**: `telegraf`
*   **AI Models**: Google Gemini (`gemini-3.1-flash-lite`, `gemini-2.5-flash`, `gemini-embedding-2`)
*   **AI Orchestration**: LangChain (`@langchain/google`, `@langchain/google-genai`)
*   **Database**: Supabase (PostgreSQL with `pgvector`)
*   **Background Jobs**: Redis + BullMQ
*   **Containerization**: Docker & Docker Compose

## ⚙️ Installation & Setup

### 1. Prerequisites
You must have the following installed on your machine:
*   [Docker](https://docs.docker.com/get-docker/) and Docker Compose
*   A Supabase Project with `pgvector` enabled
*   A Telegram Bot Token (from [@BotFather](https://t.me/botfather))
*   Google Gemini API Key
*   Google Cloud OAuth 2.0 Credentials (Client ID & Secret for Drive API)

### 2. Environment Variables
Create a `.env` file in the root directory (`d:\telegram-ai-bot`) and add the following keys:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
SUPABASE_URL=your_supabase_project_url_here
SUPABASE_ANON_KEY=your_supabase_anon_key_here
GOOGLE_API_KEY=your_gemini_api_key_here
GOOGLE_CLIENT_ID=your_oauth_client_id_here
GOOGLE_CLIENT_SECRET=your_oauth_client_secret_here
```

### 3. Database Setup (Supabase)
In your Supabase SQL Editor, you must run the provided scripts to set up the architecture. Ensure you create the `telegram_users` and `journal_entries` tables. 

**Critical: Ensure your `match_journal_entries` RPC function is installed for the search to work!**
```sql
CREATE OR REPLACE FUNCTION match_journal_entries(
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  p_telegram_id text,
  p_category text DEFAULT NULL,
  p_tags text[] DEFAULT '{}'
)
-- ... see full SQL script for details
```

### 4. Running the Bot
Because the architecture relies on Redis and multiple processes, it is highly recommended to run the project using Docker.

```bash
# Build and start all services in the background
docker-compose up -d --build
```

This will automatically spin up:
1. **Redis Server**: For caching sessions and holding the BullMQ job queues.
2. **Bot Container**: The main Telegraf polling server.
3. **Worker Container**: The background worker that processes heavy media and Google Drive uploads.

To view the logs and ensure everything started correctly:
```bash
docker-compose logs -f
```

## 🧠 How the Memory Works

1. **You ask:** "What is my father's name?"
2. **Vector Math:** Supabase calculates the cosine distance (`<=>`) between the embedding of your question and the embeddings of all your past memories.
3. **Context Injection:** The top 15 most mathematically similar memories are secretly injected into the AI's prompt as context.
4. **Reply:** The AI responds naturally, completely aware of your history!
