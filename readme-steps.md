# How to Run This Project Locally

Welcome to the **AI Telegram Journal Application**! Because this project utilizes an advanced microservice architecture (Node.js Bot, Node.js BullMQ Worker, and a Redis Queue), we have fully containerized it using Docker. 

This means you **do not** need to install Node.js, install Redis, or manually download any NPM packages. Docker will handle everything identically to how it runs in production.

Please follow these 3 simple steps to boot the project on your system:

## Step 1: Ensure Docker is Installed
To run this project, your computer must have Docker installed.
*   **Windows/Mac Users:** Download and install [Docker Desktop](https://www.docker.com/products/docker-desktop/).
*   **Linux Users:** Install the standard Docker Engine and `docker-compose`.

*Note: Make sure Docker Desktop is open and running in the background before proceeding.*

## Step 2: Add the Secret `.env` File
To maintain strict security and adhere to professional coding standards, all sensitive API keys (Telegram Bot Tokens, Supabase Credentials, Google Drive OAuth tokens) are explicitly excluded from GitHub via the `.gitignore` file.

1.  Obtain the `.env` file directly from the developer via a secure channel (e.g., direct message or email).
2.  Place the `.env` file directly into the **root directory** of this project (in the exact same folder where `docker-compose.yml` is located).

*If you skip this step, the bot will immediately crash upon startup as it cannot connect to the cloud database or AI models!*

## Step 3: Build and Run 🚀
1.  Open your Terminal (or Command Prompt / PowerShell).
2.  Navigate to the root directory of this project where you placed the `.env` file:
    ```bash
    cd path/to/telegram-ai-bot
    ```
3.  Execute the following command to download the server environments, build the code, and launch the application asynchronously:
    ```bash
    docker-compose up -d --build
    ```

## Step 4: Test the Application
Once the containers spin up successfully, you can open Telegram on your phone or web browser and send a message to the bot. 
The code running locally on your computer will instantly process the message, invoke the Google Gemini models, and write to the cloud database!

### Useful Docker Commands (Optional)
*   **To view the real-time server logs:** `docker-compose logs -f`
*   **To safely stop the bot:** `docker-compose down`
