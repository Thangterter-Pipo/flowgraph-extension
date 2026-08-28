# Google Flow API Reference 2.0.0 Test Suite

This directory contains three layers:

- `test_flow.py`: 78 offline evidence/regression/security/SDK tests. No network and no credit consumption.
- `test_live_paid.py`: 12 opt-in direct live E2E tests. These use explicit authorized runtime inputs and may consume credits.
- `test_live_browser.py`: 12 opt-in Chrome/CDP live tests covering Auth, Credits, Image Upload, invalid-reCAPTCHA negative control, T2V, credit deduction, I2V, interpolation, Reference Images, Edit/Extend, Download, and Cancel-active behavior. Browser secrets stay inside the authorized Flow page and are not exported to environment variables.

## Install

```bash
pip install -r tests/requirements-test.txt
```

## Offline regression

```bash
pytest tests/test_flow.py -q
```

Expected release baseline: `78 passed`.

## Full collection (live remains skipped unless enabled)

```bash
pytest -q
```

## Live paid — direct API mode

```bash
set FLOW_RUN_LIVE_PAID=1
pytest tests/test_live_paid.py -m live_paid -vv -s
```

Each mutation test needs a fresh legitimate browser-generated reCAPTCHA token supplied by environment variable. The suite contains no CAPTCHA bypass or token synthesis logic.

## Live browser/CDP mode

Open an authorized Google Flow project in Chrome with CDP enabled on port `9222`, then run either:

```bash
set FLOW_RUN_LIVE_BROWSER=1
pytest tests/test_live_browser.py -m live_paid -vv -s
```

or the repo helper:

```bash
_ctl\run_browser_live.cmd
```

This mode keeps the browser session cookie, OAuth access token, and reCAPTCHA material inside the authorized Chrome context. The default upload/start-frame fixture is `_ctl/g3_image.png`; the default end-frame fixture is `_ctl/asset_menu.png`. Override them with `FLOW_BROWSER_UPLOAD_IMAGE`, `FLOW_BROWSER_START_IMAGE_PATH`, or `FLOW_BROWSER_END_IMAGE_PATH` when needed.

`Cancel-active` remains intentionally unverified when the backend returns `400 FAILED_PRECONDITION`; the test records that state instead of claiming a false success. Long sequential CDP runs can still be transport-flaky even when the individual generation endpoints have already succeeded independently; see `GOOGLE_FLOW_API_REFERENCE.md` §18.2 and `evidence/runtime/browser_live_2026-08-28.md`.

See `tests/TEST_PLAN.md` for the complete case matrix and environment variables.
