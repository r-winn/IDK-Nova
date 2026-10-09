export function diagnoseConnection(error: string): { title: string; action: string } {
  if (/\b401\b|invalid.?api.?key|authentication_error/i.test(error)) return { title: 'Authentication rejected', action: 'Check the API key for this Base URL. The server responded; this is not proof of an internet outage.' };
  if (/\b403\b/i.test(error)) return { title: 'Access denied', action: 'Check model permissions, your company network policy and regional access restrictions.' };
  if (/model.*(not found|does not exist)|model_not_found|\b404\b/i.test(error)) return { title: 'Model or endpoint unavailable', action: 'Refresh the model list and confirm the Base URL ends at the API root, not /chat/completions.' };
  if (/\b429\b|quota|rate.limit/i.test(error)) return { title: 'Quota or rate limit', action: 'Check provider credits and request limits; wait before retrying.' };
  if (/\b5\d\d\b/i.test(error)) return { title: 'Provider server error', action: 'The server responded with an error. Retry later or use a different provider.' };
  if (/\b400\b/i.test(error)) return { title: 'Request rejected', action: 'Check supported models, images, tools and API compatibility. See the server detail below.' };
  if (/timeout|timed out|abort/i.test(error)) return { title: 'Request timed out', action: 'The model may still be loading, or the server/network may be slow. Check provider availability and retry.' };
  return { title: 'Connection could not be verified', action: 'Check the provider process, URL, VPN and network. In the web app, CORS or HTTP restrictions can cause the same error; the message alone cannot distinguish them.' };
}
