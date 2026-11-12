import { describe, expect, it } from 'vitest';
import {
  hashOtp,
  hashPassword,
  verifyOtpHash,
  verifyPassword,
} from '../src/utils/crypto.ts';

const existingBcryptHash =
  '$2b$12$abcdefghijklmnopqrstuuVIQMHxxVvOoxHrSF9EwhPBXU78jLvg6';

describe('bcrypt-compatible password and OTP hashing', () => {
  it('verifies password hashes created by the previous bcrypt implementation', async () => {
    await expect(
      verifyPassword('ChatSphere legacy hash compatibility', existingBcryptHash)
    ).resolves.toBe(true);
    await expect(verifyPassword('incorrect password', existingBcryptHash)).resolves.toBe(false);
  });

  it('continues to hash and verify passwords and OTPs asynchronously', async () => {
    const passwordHash = await hashPassword('StrongPassword#2026');
    expect(passwordHash).toMatch(/^\$2[aby]\$12\$/);
    await expect(verifyPassword('StrongPassword#2026', passwordHash)).resolves.toBe(true);

    const otpHash = await hashOtp('123456');
    expect(otpHash).toMatch(/^\$2[aby]\$10\$/);
    await expect(verifyOtpHash('123456', otpHash)).resolves.toBe(true);
  });
});
