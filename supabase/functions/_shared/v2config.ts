// V2 settings shared by the live functions (one place instead of copies in each function).

// sites allowed to call the functions from a browser. ai-mggo.vercel.app = the vercel project's own address of the live site.
export const ORIGINS = ['https://app.primeos.co.il', 'https://ai-mggo.vercel.app', 'https://primeos-staging.vercel.app', 'http://localhost:5173', 'http://localhost:4173', 'http://localhost:8080'];

// the allowed origin to answer with (an unknown origin gets the live site, so the browser blocks it)
export const allowOrigin = (o: string) => (ORIGINS.includes(o) ? o : ORIGINS[0]);

// Claude models in fallback order: an empty, refused or failed answer moves to the next one
export const CLAUDE_MODELS = ['claude-sonnet-5-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'];
