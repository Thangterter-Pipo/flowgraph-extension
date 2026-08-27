# Google Flow RC2 Test Suite

This directory contains two layers:

- `test_flow.py`: 76 offline evidence/regression/security/SDK tests. No network and no credit consumption.
- `test_live_paid.py`: 12 opt-in live E2E tests. These use the authorized Google Flow account and may consume credits.

## Install

```bash
pip install -r tests/requirements-test.txt
```

## Offline

```bash
pytest tests/test_flow.py -q
```

## Full collection (live remains skipped unless enabled)

```bash
pytest -q
```

## Live paid

```bash
set FLOW_RUN_LIVE_PAID=1
pytest tests/test_live_paid.py -m live_paid -vv -s
```

Each mutation test needs a fresh legitimate browser-generated reCAPTCHA token supplied by environment variable. The suite contains no CAPTCHA bypass or token synthesis logic.

See `tests/TEST_PLAN.md` for the complete case matrix and environment variables.
