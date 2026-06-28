import argparse
import datetime
import json
import sys

from flight_price_alert import FlightPriceAlert


def main():
    parser = argparse.ArgumentParser(description="Flight Price Alert CLI")
    parser.add_argument("--origin", type=str, help="Origin airport IATA code", required=True)
    parser.add_argument("--destination", type=str, help="Destination airport IATA code", required=True)
    parser.add_argument("--start_date", type=str, help="Start date in YYYY-MM-DD format", required=True)
    parser.add_argument("--end_date", type=str, help="End date in YYYY-MM-DD format", required=True)
    parser.add_argument("--threshold", type=float, help="Price threshold", required=True)
    args = parser.parse_args()

    try:
        alert = FlightPriceAlert(args.origin, args.destination, args.start_date, args.end_date, args.threshold)
        alert.run()
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()