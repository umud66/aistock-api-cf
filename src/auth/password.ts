const encoder = new TextEncoder();
const ITERATIONS = 100_000;
function hex(bytes: Uint8Array): string {
    return Array.from(bytes, v => v.toString(16).padStart(2, '0')).join('');
}
function unhex(value: string): Uint8Array {
    return Uint8Array.from(value.match(/../g) ?? [], v => parseInt(v, 16));
}
async function derive(password: string, pepper: string, salt: Uint8Array): Promise<string> {
    const hmacKey = await crypto.subtle.importKey('raw', encoder.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const secret = await crypto.subtle.sign('HMAC', hmacKey, encoder.encode(password));
    const key = await crypto.subtle.importKey('raw', secret, 'PBKDF2', false, ['deriveBits']);
    return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)));
}
export async function hashPassword(password: string, pepper: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return `pbkdf2-sha256:${ITERATIONS}:${hex(salt)}:${await derive(password, pepper, salt)}`;
}
export async function verifyPassword(password: string, pepper: string, stored: string | null): Promise<boolean> {
    // Missing usernames still perform the same expensive derivation.
    const valid = stored?.match(/^pbkdf2-sha256:100000:([a-f0-9]{32}):([a-f0-9]{64})$/);
    const expected = valid?.[2] ?? '0'.repeat(64);
    const actual = await derive(password, pepper, unhex(valid?.[1] ?? '0'.repeat(32)));
    let difference = 0;
    for (let i = 0; i < actual.length; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
    return !!valid && difference === 0;
}
