# Flight Price Alert CLI

A simple CLI to monitor flight prices and alert when they drop below a threshold.

## Installation

```bash
pip install flight-alert-cli
```

## Quick start

```bash
flight-alert-cli --origin JFK --destination LAX --start_date 2026-07-01 --end_date 2026-07-15 --threshold 250
```

## Arguments

| Argument       | Type   | Required | Description                              |
|----------------|--------|----------|------------------------------------------|
| --origin       | str    | Yes      | Origin airport IATA code (e.g. JFK)       |
| --destination  | str    | Yes      | Destination airport IATA code (e.g. LAX)  |
| --start_date   | str    | Yes      | Start date in YYYY-MM-DD format          |
| --end_date     | str    | Yes      | End date in YYYY-MM-DD format            |
| --threshold    | float  | Yes      | Price threshold (e.g. 250.00)            |

## Examples

- Monitor JFK→LAX for prices below $250 between July 1-15, 2026

```bash
flight-alert-cli --origin JFK --destination LAX --start_date 2026-07-01 --end_date 2026-07-15 --threshold 250
```

- Check prices from London to Barcelona for $300 or less

```bash
flight-alert-cli --origin LHR --destination BCN --start_date 2026-07-01 --end_date 2026-07-10 --threshold 300
```

## Output

The CLI prints alerts to stdout as they occur and saves logs to `flight_alert.log`.

## Uninstall

```bash
pip uninstall flight-alert-cli
```