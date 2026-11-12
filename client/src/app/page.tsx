import { LandingPage } from '../views/LandingPage.tsx';

/**
 * / — Landing page.
 *
 * Server Component shell. LandingPage itself is a Client Component (it uses
 * hooks + browser APIs) but it is still server-rendered to HTML by the App
 * Router, so the marketing copy ships as real HTML instead of an empty div.
 */
export default function Page() {
  return <LandingPage />;
}
