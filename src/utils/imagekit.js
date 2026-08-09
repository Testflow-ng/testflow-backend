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

console.log('[ImageKit] Instance Keys:', Object.keys(imagekit));

/**
 * Get authentication parameters for client-side upload.
 * These are valid for 60 seconds by default.
 */
export const getAuthParams = () => {
  if (!publicKey || !privateKey || !urlEndpoint) {
    throw new Error('ImageKit credentials not configured correctly.');
  }

  // In @imagekit/nodejs v7+, this method moved to the helper submodule
  if (imagekit.helper && typeof imagekit.helper.getAuthenticationParameters === 'function') {
    return imagekit.helper.getAuthenticationParameters();
  }

  // Fallback for older versions just in case
  if (typeof imagekit.getAuthenticationParameters === 'function') {
    return imagekit.getAuthenticationParameters();
  }

  throw new Error('ImageKit SDK method getAuthenticationParameters not found on instance or helper.');
};

export default imagekit;
