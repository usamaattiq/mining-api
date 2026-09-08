import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../../config/env';

export interface UserAccessTokenPayload {
  sub: string;
  jti: string;
}

export async function signUserAccessToken(input: {
  sub: string;
}): Promise<{ token: string; jti: string }> {
  const jti = randomUUID();
  const token = jwt.sign({ sub: input.sub, jti }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as jwt.SignOptions);

  return { token, jti };
}

export function verifyUserAccessToken(token: string): UserAccessTokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as UserAccessTokenPayload;
}
