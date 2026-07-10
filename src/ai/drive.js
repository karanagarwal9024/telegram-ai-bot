import { google } from 'googleapis';
import fs from 'fs';

const FOLDER_NAME = "AI Journal Backup";

const getOrCreateFolder = async (drive) => {
    // 1. Search for the folder
    const response = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false`,
        spaces: 'drive',
        fields: 'files(id, name)',
    });

    if (response.data.files.length > 0) {
        // Folder exists, return its ID
        return response.data.files[0].id;
    }

    // 2. Folder doesn't exist, create it
    const fileMetadata = {
        name: FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
    };
    
    const folder = await drive.files.create({
        requestBody: fileMetadata,
        fields: 'id',
    });
    
    return folder.data.id;
};

export const uploadToDrive = async (filePath, fileName, mimeType, providerToken, providerRefreshToken) => {
    try {
        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET
        );

        // We ONLY pass the refresh_token. Because we don't know the exact expiration date 
        // of the access token, passing only the refresh token forces Google to fetch a 
        // brand new access token every single time, guaranteeing it never fails!
        oauth2Client.setCredentials({
            refresh_token: providerRefreshToken
        });

        const drive = google.drive({ version: 'v3', auth: oauth2Client });

        // Get the folder ID (creates it if it doesn't exist)
        const folderId = await getOrCreateFolder(drive);

        const fileMetadata = {
            name: fileName,
            parents: [folderId] // Place the file inside the specific folder
        };
        
        const media = {
            mimeType: mimeType,
            body: fs.createReadStream(filePath),
        };

        const response = await drive.files.create({
            requestBody: fileMetadata,
            media: media,
            fields: 'id',
        });

        return response.data.id;
    } catch (error) {
        console.error("Google Drive Upload Error:", error);
        throw error;
    }
};
