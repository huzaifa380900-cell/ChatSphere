process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';
process.env.COOKIE_SAME_SITE = 'lax';
process.env.APP_URL = 'http://localhost:5173';
process.env.FRONTEND_PUBLIC_URL = 'http://localhost:3000';
// Isolate E2E tests from live external DB & SMTP accounts
process.env.DATABASE_URL = '';
process.env.DIRECT_URL = '';
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.PUSHER_APP_ID = '';
process.env.PUSHER_KEY = '';
process.env.PUSHER_SECRET = '';
process.env.PUSHER_CLUSTER = '';
// Deterministic signing fixtures for OAuth & Cloudinary cryptographic verification
process.env.CLOUDINARY_CLOUD_NAME = 'chatsphere-test-cloud';
process.env.CLOUDINARY_API_KEY = '123456789012345';
process.env.CLOUDINARY_API_SECRET = 'test_cloudinary_signing_secret_key_998877';
process.env.GOOGLE_CLIENT_ID = '1234567890-testclient.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'GOCSPX-test_google_oauth_secret_value';
