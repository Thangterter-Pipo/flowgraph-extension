# Auth & Session

Separates Extension Google Identity (`chrome.identity`) from Google Flow runtime session state. The extension may persist non-secret profile/connection metadata, but not Google cookies, Flow OAuth access tokens, refresh tokens, reCAPTCHA tokens or signed media URLs.
