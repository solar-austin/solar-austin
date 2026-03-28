'use strict';

exports.handler = async () => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: 'Missing GOOGLE_MAPS_API_KEY environment variable' }),
    };
  }
  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
    body: JSON.stringify({ key }),
  };
};
