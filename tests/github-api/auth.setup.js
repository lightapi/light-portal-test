import authenticate from '../api-gateway-publication/auth.setup.js';

export default async function setup(config) {
  try { await authenticate(config); }
  catch {
    // Browser call logs may include credential-bearing fill arguments.
    throw new Error('Authorized Portal authentication setup failed; check private credentials/state. Sensitive login diagnostics suppressed.');
  }
}
