"""
Unit tests for date parsing utilities.

Ensures that scenario dates (YYYY-MM-DD format from backend) are parsed
correctly without timezone shifting by 1 day.
"""

import unittest
from datetime import date


def parse_scenario_date(iso_string: str) -> date:
    """
    Parse ISO date string (YYYY-MM-DD) as a local date.

    The backend returns dates as date.isoformat() which produces YYYY-MM-DD strings.
    We must parse these as local dates, not as UTC timestamps, to avoid
    timezone-related day shifting.

    Args:
        iso_string: Date in YYYY-MM-DD format (e.g., "2026-01-29")

    Returns:
        date object representing the local date

    Example:
        >>> parse_scenario_date('2026-01-29')
        date(2026, 1, 29)
    """
    if not iso_string:
        return None

    # Use date.fromisoformat for simple YYYY-MM-DD parsing
    # This avoids timezone conversions that can shift the day
    return date.fromisoformat(iso_string)


class TestDateParsing(unittest.TestCase):
    """Test date parsing to ensure no timezone day-shift bugs."""

    def test_parse_scenario_date_basic(self):
        """Test basic YYYY-MM-DD parsing."""
        result = parse_scenario_date('2026-01-29')
        self.assertEqual(result, date(2026, 1, 29))

    def test_parse_scenario_date_preserves_day(self):
        """
        Verify that parseScenarioDate('YYYY-MM-DD') produces a Date
        whose local YYYY-MM-DD equals the input.

        This is critical because timezone conversions can shift the day
        (e.g., 2026-01-29 UTC -> 2026-01-28 PST in some JS implementations).
        """
        test_cases = [
            ('2026-01-01', date(2026, 1, 1)),
            ('2026-01-29', date(2026, 1, 29)),
            ('2026-12-31', date(2026, 12, 31)),
            ('2025-02-28', date(2025, 2, 28)),
        ]

        for iso_string, expected in test_cases:
            with self.subTest(iso_string=iso_string):
                result = parse_scenario_date(iso_string)
                self.assertEqual(result, expected)
                self.assertEqual(result.year, expected.year)
                self.assertEqual(result.month, expected.month)
                self.assertEqual(result.day, expected.day)

    def test_parse_scenario_date_none(self):
        """Test parsing None/empty string."""
        self.assertIsNone(parse_scenario_date(None))
        self.assertIsNone(parse_scenario_date(''))

    def test_parse_scenario_date_roundtrip(self):
        """Test that date -> isoformat -> parse_scenario_date is lossless."""
        original = date(2026, 1, 29)
        iso_string = original.isoformat()  # "2026-01-29"
        parsed = parse_scenario_date(iso_string)
        self.assertEqual(parsed, original)


if __name__ == "__main__":
    unittest.main()
