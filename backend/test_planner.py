import unittest
from datetime import date, timedelta
from backend.planner import (
    calculate_phase_limits,
    get_rolling_week,
    get_subject_priority,
    generate_study_schedule,
)


class PlannerUnitTests(unittest.TestCase):
    def test_calculate_phase_limits_standard_sleep(self):
        # 8 hrs sleep -> 16 hrs available (960 min) -> 240 base min
        limits = calculate_phase_limits(8)
        # Phase 1 (65% of 240 = 156 -> 160)
        # Phase 2 (70% of 240 = 168 -> 170)
        # Phase 3 (65% of 240 = 156 -> 160)
        # Phase 4 (70% of 240 = 168 -> 170)
        self.assertEqual(limits, [160, 170, 160, 170])
        self.assertEqual(sum(limits), 660)

    def test_calculate_phase_limits_zero_sleep(self):
        limits = calculate_phase_limits(0)
        self.assertEqual(limits, [230, 250, 230, 250])

    def test_calculate_phase_limits_invalid_sleep_fallback(self):
        limits = calculate_phase_limits(-5)
        self.assertEqual(limits, [230, 250, 230, 250])
        limits_overflow = calculate_phase_limits(25)
        self.assertEqual(limits_overflow, [230, 250, 230, 250])

    def test_get_rolling_week_length_and_dates(self):
        start = "2026-09-01"
        week = get_rolling_week(start)
        self.assertEqual(len(week), 7)
        self.assertEqual(week[0]["date"], "2026-09-01")
        self.assertEqual(week[6]["date"], "2026-09-07")

    def test_priority_scoring_difficulty_and_urgency(self):
        today = "2026-09-01"
        # Easy subject with urgent exam (2 days away) vs Hard subject with distant exam (30 days away)
        urgent_easy = {"name": "History", "difficulty": "Easy", "examDate": "2026-09-03"}
        distant_hard = {"name": "Physics", "difficulty": "Hard", "examDate": "2026-10-01"}

        p_urgent = get_subject_priority(urgent_easy, today)
        p_distant = get_subject_priority(distant_hard, today)

        # Easy(1) + Urgency(6) = 7
        # Hard(5) + Urgency(0) = 5
        self.assertEqual(p_urgent, 7)
        self.assertEqual(p_distant, 5)
        self.assertGreater(p_urgent, p_distant)

    def test_generate_schedule_date_stamped_task_ids(self):
        subjects = [
            {
                "name": "Mathematics",
                "difficulty": "Hard",
                "examDate": "2026-09-10",
                "topics": [{"name": "Calculus"}, {"name": "Algebra"}],
            },
            {
                "name": "Physics",
                "difficulty": "Medium",
                "examDate": "2026-09-12",
                "topics": [{"name": "Optics"}],
            }
        ]
        res = generate_study_schedule(subjects, 8, start_date="2026-09-01")
        week = res["week"]
        self.assertEqual(len(week), 7)
        self.assertGreater(res["total_tasks"], 0)

        # Ensure task IDs start with the ISO date of that day (eliminates rolling collision)
        day0_tasks = [t for p in week[0]["phases"] for t in p["tasks"]]
        self.assertTrue(all(t["id"].startswith("t-2026-09-01-") or t["id"].startswith("rev-2026-09-01-") for t in day0_tasks))

    def test_schedule_with_skipped_task_rescheduling(self):
        subjects = [
            {
                "name": "Chemistry",
                "difficulty": "Medium",
                "topics": [{"name": "Organic Chemistry"}, {"name": "Periodic Table"}],
            }
        ]
        initial = generate_study_schedule(subjects, 8, start_date="2026-09-01")
        day0_phase0_task = initial["week"][0]["phases"][0]["tasks"][0]

        skipped = [{
            "name": day0_phase0_task["name"],
            "fromPhase": 0,
            "targetPhase": 1,
            "day": 0,
        }]

        updated = generate_study_schedule(subjects, 8, start_date="2026-09-01", skipped_tasks=skipped)
        all_rescheduled = [
            t for d in updated["week"] for p in d["phases"] for t in p["tasks"] if "↩️ Rescheduled" in t["name"]
        ]
        self.assertEqual(len(all_rescheduled), 1)
        self.assertIn(day0_phase0_task["name"], all_rescheduled[0]["name"])


if __name__ == "__main__":
    unittest.main()
