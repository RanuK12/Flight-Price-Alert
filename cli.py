import os
import argparse
from typing import Optional

# Hard-coded list of premium license keys (placeholder)
PREMIUM_KEYS = {
    "PREMIUM_KEY_1",
    "PREMIUM_KEY_2",
    "PREMIUM_KEY_3",
}


def validate_license_key(key: Optional[str]) -> bool:
    """Validate the provided license key against the hard-coded list."""
    return key is not None and key.strip().upper() in PREMIUM_KEYS


def main():
    parser = argparse.ArgumentParser(description="Flight Price Alert CLI")
    parser.add_argument("--premium", action="store_true", help="Enable premium features (multi-city monitoring, email notifications)")
    args = parser.parse_args()

    # Read LICENSE_KEY from environment variable
    license_key = os.getenv("LICENSE_KEY")

    if args.premium:
        if not validate_license_key(license_key):
            print("❌ Error: Invalid or missing license key. Premium features require a valid LICENSE_KEY.")
            print("Please set the LICENSE_KEY environment variable with a premium key.")
            return
        print("✅ Premium mode enabled. Advanced features active: multi-city monitoring, email notifications.")
    else:
        print("ℹ️ Running in free mode. Basic features only.")

    # Placeholder for actual functionality
    print("🛠️  CLI initialized successfully.")


if __name__ == "__main__":
    main()