import authenticate, { readCurrentAccessToken } from '../promotion-ui/auth.setup.js';

export default async function setup(config) {
  const authFile = config.projects[0].use.storageState;
  // Leave enough token lifetime for both cycles and failure cleanup.
  const previous = process.env.PROMOTION_REUSE_AUTH_STATE;
  if (!readCurrentAccessToken(authFile, 600)) process.env.PROMOTION_REUSE_AUTH_STATE = 'false';
  try {
    await authenticate(config);
  } finally {
    if (previous === undefined) delete process.env.PROMOTION_REUSE_AUTH_STATE;
    else process.env.PROMOTION_REUSE_AUTH_STATE = previous;
  }
}
