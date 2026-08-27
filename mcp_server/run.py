"""Load .env next to this script so the server picks up FLOW_VEO_MCP_* vars."""
import os
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass

from server import main  # noqa: E402

if __name__ == "__main__":
    main()
