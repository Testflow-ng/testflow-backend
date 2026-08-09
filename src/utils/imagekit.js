import ImageKit from '@imagekit/nodejs';
import { config } from '../config/env.js';
import fs from 'node:fs/promises';

// Initialize ImageKit with trimmed keys to avoid hidden whitespace issues
const publicKey = config.IMAGEKIT_PUBLIC_KEY?.trim();
const privateKey = config.IMAGEKIT_PRIVATE_KEY?.trim();
const urlEndpoint = config.IMAGEKIT_URL_ENDPOINT?.trim();

if (typeof ImageKit !== 'function') {
  console.error('❌ [ImageKit] Fatal Error: ImageKit constructor not found. Check import format.');
}

const imagekit = new ImageKit({
  publicKey: publicKey || '',
  privateKey: privateKey || '',
  urlEndpoint: urlEndpoint || '',
});

console.log('[ImageKit] Initialization Check:');
console.log(`  - Public Key:  ${publicKey ? 'OK (' + publicKey.length + ' chars)' : 'MISSING'}`);
console.log(`  - Private Key: ${privateKey ? 'OK (' + privateKey.length + ' chars)' : 'MISSING'}`);
console.log(`  - Endpoint:    ${urlEndpoint ? 'OK' : 'MISSING'}`);

/**
 * Get authentication parameters for client-side upload.
 * These are valid for 60 seconds by default.
 */
export const getAuthParams = () => {
  if (!publicKey || !privateKey || !urlEndpoint) {
    throw new Error('ImageKit credentials not configured correctly.');
  }
  return imagekit.getAuthenticationParameters();
};

export default imagekit;
