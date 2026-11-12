import { renderToString } from 'react-dom/server';
import App from './App.tsx';

export async function render(url: string): Promise<string> {
  return renderToString(<App initialUrl={url} />);
}
