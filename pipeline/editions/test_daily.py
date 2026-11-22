from datetime import date
import unittest

from daily import day_pins, iso


class DayBoundaries(unittest.TestCase):
    def test_utc_midnight_carry_forward_and_partial_observation(self):
        commits = [("a",iso("2026-11-19T23:08:00-05:00")),
                   ("b",iso("2026-11-22T01:00:00+01:00")),
                   ("c",iso("2026-11-22T12:00:01Z"))]
        self.assertEqual(list(day_pins(commits,date(2026,11,19),iso("2026-11-22T12:00:00Z"))),
                         [("2026-11-20","a",True),("2026-11-21","a",True),("2026-11-22","b",False)])

    def test_a_backdated_child_cannot_appear_before_its_parent(self):
        rows=[("a",iso("2026-11-20T12:00:00Z")),("b",iso("2026-11-22T01:00:00Z")),
              ("c",iso("2026-11-21T06:00:00Z"))]
        days=list(day_pins(rows,date(2026,11,20),iso("2026-11-22T01:00:00Z")))
        self.assertEqual([x[1] for x in days],["a","a","c"])

    def test_timezone_is_required(self):
        with self.assertRaises(ValueError):
            iso("2026-11-22T03:00:00")


if __name__=="__main__":
    unittest.main()
