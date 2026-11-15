import axios from 'axios';

/**
 * Browser HTTP client for the storefront's own `/api/*` Route Handlers.
 * Uses Axios's Fetch adapter so requests go through the platform `fetch`.
 */
export const httpClient = axios.create({
  adapter: 'fetch',
  timeout: 8_000,
  headers: { Accept: 'application/json' },
});
