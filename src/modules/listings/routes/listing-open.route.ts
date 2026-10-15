import { Router } from 'express';
import { listingAppUrl } from '../utils/listing-app-url';

const CATEGORIES = new Set(['equipment', 'services', 'gold']);
const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.silveraxis.mining';
const APP_STORE = 'https://apps.apple.com/search?term=Dahabi';

export const listingOpenRouter = Router();

listingOpenRouter.get('/listing/:category/:id', (req, res) => {
  const category = String(req.params.category ?? '');
  const id = String(req.params.id ?? '');
  if (!CATEGORIES.has(category) || !id) {
    res
      .status(404)
      .type('html')
      .send('<!doctype html><title>Dahabi</title><p>Listing not found.</p>');
    return;
  }
  const appUrl = listingAppUrl(category, id);
  const safeApp = appUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Dahabi</title>
<style>
  body { font-family: sans-serif; margin: 0; padding: 32px 20px; color: #222; background: #fffaf3; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { color: #666; line-height: 1.4; }
  a.store { display: block; margin-top: 12px; padding: 14px 16px; border-radius: 10px; background: #c4a35a; color: #fff; text-decoration: none; font-weight: 700; text-align: center; }
  #install { display: none; max-width: 420px; }
</style>
</head>
<body>
<div id="install">
  <h1>Dahabi</h1>
  <p>Install Dahabi to open this listing. If you already have the app, open it and sign in — this listing will be waiting.</p>
  <a class="store" href="${PLAY_STORE}">Get it on Google Play</a>
  <a class="store" href="${APP_STORE}">Get it on the App Store</a>
  <a class="store" href="${safeApp}">Open in the app</a>
</div>
<script>
  var appUrl = ${JSON.stringify(appUrl)};
  var opened = false;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) opened = true;
  });
  window.location.replace(appUrl);
  setTimeout(function () {
    if (!opened) document.getElementById('install').style.display = 'block';
  }, 1500);
</script>
</body>
</html>`);
});
