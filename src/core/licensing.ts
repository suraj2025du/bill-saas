/**
 * Offline cryptographic-checksum licensing utility.
 * Validates keys of format XXXXX-XXXXX-XXXXX-XXXXX
 */

export interface ValidationResult {
  valid: boolean;
  type: 'STARTER' | 'ENTERPRISE' | null;
  error?: string;
}

export function validateLicenseKey(key: string): ValidationResult {
  const clean = key.toUpperCase().trim();
  if (!/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(clean)) {
    return { valid: false, type: null, error: 'Key must be in XXXXX-XXXXX-XXXXX-XXXXX format.' };
  }

  const chars = clean.replace(/-/g, '');
  const firstChar = chars[0];
  if (firstChar !== 'S' && firstChar !== 'E') {
    return { valid: false, type: null, error: 'Invalid license key signature.' };
  }

  // Calculate checksum
  let sum = 0;
  for (let i = 0; i < chars.length; i++) {
    sum += chars.charCodeAt(i);
  }

  const mod = sum % 31;
  const expectedType = firstChar === 'S' ? 'STARTER' : 'ENTERPRISE';
  const expectedMod = firstChar === 'S' ? 7 : 14;

  if (mod !== expectedMod) {
    return { valid: false, type: null, error: 'License key fails integrity verification.' };
  }

  return { valid: true, type: expectedType };
}

export function generateLicenseKey(type: 'STARTER' | 'ENTERPRISE'): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No confusing characters like I, O, 0, 1
  const firstChar = type === 'STARTER' ? 'S' : 'E';
  const expectedMod = type === 'STARTER' ? 7 : 14;

  while (true) {
    let raw = firstChar;
    for (let i = 1; i < 20; i++) {
      raw += alphabet[Math.floor(Math.random() * alphabet.length)];
    }

    // Check sum of first 19
    let sum = 0;
    for (let i = 0; i < 19; i++) {
      sum += raw.charCodeAt(i);
    }

    // We want (sum + lastChar) % 31 === expectedMod
    // lastChar % 31 === (expectedMod - sum) % 31
    let targetMod = (expectedMod - sum) % 31;
    if (targetMod < 0) targetMod += 31;

    // Find a character in our alphabet whose charCode % 31 is targetMod
    const matchingChars: string[] = [];
    for (let i = 0; i < alphabet.length; i++) {
      if (alphabet.charCodeAt(i) % 31 === targetMod) {
        matchingChars.push(alphabet[i]);
      }
    }

    if (matchingChars.length > 0) {
      const lastChar = matchingChars[Math.floor(Math.random() * matchingChars.length)];
      const key20 = raw.slice(0, 19) + lastChar;
      // Format as XXXXX-XXXXX-XXXXX-XXXXX
      return [
        key20.slice(0, 5),
        key20.slice(5, 10),
        key20.slice(10, 15),
        key20.slice(15, 20)
      ].join('-');
    }
  }
}
