import ImageKit from '@imagekit/nodejs';
import { config } from '../config/env.js';
import fs from 'node:fs/promises';

// Initialize ImageKit
const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY || '',
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || '',
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || '',
});

/**
 * Upload a local file to ImageKit and delete it from the server afterwards.
 * @param {string} filePath - Local path to the file
 * @param {string} fileName - Destination filename in ImageKit
 * @param {string} folder - Folder name in ImageKit (e.g. 'receipts')
 * @returns {Promise<object>} - ImageKit upload response
 */
export const uploadToImageKit = async (filePath, fileName, folder = 'receipts') => {
  try {
    const fileContent = await fs.readFile(filePath);

    const response = await imagekit.upload({
      file: fileContent,
      fileName,
      folder,
      useUniqueFileName: true,
    });

    // Cleanup: Remove local file after successful upload
    await fs.unlink(filePath).catch(err => console.error('ImageKit Cleanup Error:', err));

    return response;
  } catch (error) {
    console.error('ImageKit Upload Error:', error);
    // Even if upload fails, we should attempt to cleanup if the file exists
    await fs.unlink(filePath).catch(() => {});
    throw error;
  }
};

export default imagekit;
