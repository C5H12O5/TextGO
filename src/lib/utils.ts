/**
 * Encrypt a string using XOR and reverse operations.
 *
 * @param text - the plain text to encrypt
 * @param key - the encryption key
 * @returns the encrypted text
 */
export function encrypt(text: string, key: string = 'textgo'): string {
  const xored = xor(text, key);
  return xored.split('').reverse().join('');
}

/**
 * Decrypt a string encrypted by the encrypt function.
 *
 * @param text - the encrypted text to decrypt
 * @param key - the decryption key
 * @returns the decrypted text
 */
export function decrypt(text: string, key: string = 'textgo'): string {
  const reversed = text.split('').reverse().join('');
  return xor(reversed, key);
}

/**
 * XOR operation helper function.
 *
 * @param text - the text to process
 * @param key - the key to use for XOR
 * @returns the result of the XOR operation
 */
export function xor(text: string, key: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i) ^ key.charCodeAt(i % key.length);
    result += String.fromCharCode(charCode);
  }
  return result;
}
