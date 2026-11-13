"""
backend/planner.py
MNC-Grade Deterministic Academic Scheduling Engine for Planify.

Responsibilities:
- Sleep-aware capacity calculation across 4 study phases.
- Dynamic urgency and difficulty priority weighting.
- Permanent date-stamped task ID generation to eliminate day-rollover collisions.
- Two-pass schedule generation with intelligent multi-day skip rescheduling.
"""

from datetime import date, datetime, timedelta
import math


def round_to_10(num):
    return int(round(num / 10.0) * 10)


def calculate_phase_limits(sleep_hours):
    """
    Calculates 4 daily study phase capacities (in minutes) based on sleep hours.
    Allocation: Phase 1 (65%), Phase 2 (70%), Phase 3 (65%), Phase 4 Revision (70%).
    """
    try:
        numeric_sleep = float(sleep_hours)
    except (TypeError, ValueError):
        numeric_sleep = 0.0

    if not 0.0 <= numeric_sleep < 24.0:
        numeric_sleep = 0.0

    available_mins = (24.0 - numeric_sleep) * 60.0
    base_mins = available_mins / 4.0

    limits = [
        round_to_10(base_mins * 0.65),  # Phase 1
        round_to_10(base_mins * 0.70),  # Phase 2
        round_to_10(base_mins * 0.65),  # Phase 3
        round_to_10(base_mins * 0.70),  # Phase 4: Revision & Recovery
    ]
    return limits


def get_rolling_week(start_date=None):
    """
    Returns a 7-day rolling calendar starting from today (or start_date).
    Format: [{'day': 'Mon', 'date': 'YYYY-MM-DD'}, ...]
    """
    if start_date is None:
        current = date.today()
    elif isinstance(start_date, str):
        current = date.fromisoformat(start_date)
    else:
        current = start_date

    days_array = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    week = []
    for i in range(7):
        d = current + timedelta(days=i)
        week.append({
            "day": days_array[d.weekday()],
            "date": d.isoformat(),
        })
    return week


def get_subject_priority(subject, today_date_str):
    """
    Calculates priority score combining base difficulty and exam urgency.
    """
    difficulty_weights = {"Easy": 1, "Medium": 3, "Hard": 5}
    diff = subject.get("difficulty", "Medium")
    base_weight = difficulty_weights.get(diff, 3)

    urgency = 0
    exam_date_str = subject.get("examDate") or subject.get("exam_date")
    if exam_date_str:
        try:
            exam_d = date.fromisoformat(exam_date_str)
            today_d = date.fromisoformat(today_date_str)
            days_until_exam = (exam_d - today_d).days
            if days_until_exam <= 3:
                urgency = 6
            elif days_until_exam <= 7:
                urgency = 4
            elif days_until_exam <= 14:
                urgency = 2
        except (ValueError, TypeError):
            pass

    return base_weight + urgency


def generate_study_schedule(subjects, sleep_hours, start_date=None, skipped_tasks=None):
    """
    Core Planner Engine:
    - Generates 7-day schedule with phase limits and task lists.
    - Employs permanent date-stamped task IDs (t-{YYYY-MM-DD}-p{phase}-{idx}).
    - Balances topics across days by priority and incorporates revision.
    """
    limits = calculate_phase_limits(sleep_hours)
    total_day_limit = sum(limits)
    week_template = get_rolling_week(start_date)

    week = []
    for item in week_template:
        week.append({
            "day": item["day"],
            "date": item["date"],
            "totalLimit": total_day_limit,
            "usedHours": 0,  # stores total minutes
            "phases": [
                {"limit": limits[0], "tasks": []},
                {"limit": limits[1], "tasks": []},
                {"limit": limits[2], "tasks": []},
                {"limit": limits[3], "tasks": []},
            ],
        })

    if not subjects:
        return {"week": week, "total_tasks": 0, "total_mins": 0}

    pool_ptr = 0

    for d_idx in range(7):
        today_date_str = week[d_idx]["date"]
        tasks_studied_today = []
        day_used_mins = 0

        # Filter active subjects (exam not passed before today)
        active_subjects = []
        for sub in subjects:
            ex_date = sub.get("examDate") or sub.get("exam_date")
            if not ex_date or today_date_str < ex_date:
                active_subjects.append(sub)

        # Sort by dynamic priority
        active_subjects.sort(
            key=lambda s: get_subject_priority(s, today_date_str),
            reverse=True
        )

        # Build weighted topic pool for today
        day_weighted_pool = []
        for sub in active_subjects:
            diff = sub.get("difficulty", "Medium")
            weight = 5 if diff == "Hard" else 3 if diff == "Medium" else 1
            topics = sub.get("topics", [])
            sub_name = sub.get("name") or sub.get("subject_name", "Subject")

            sub_items = []
            if topics:
                for t in topics:
                    tname = t.get("name") if isinstance(t, dict) else str(t)
                    # Syllabus/PYQ intelligence is deliberately capped at two
                    # extra pool entries. Raw paper frequency never becomes a
                    # raw multiplier, so difficulty and exam urgency remain
                    # the planner's primary allocation factors.
                    try:
                        priority_signal = float(t.get("prioritySignal", 0)) if isinstance(t, dict) else 0.0
                    except (TypeError, ValueError):
                        priority_signal = 0.0
                    repetitions = 1 + max(0, min(2, int(round(priority_signal))))
                    item = {
                        "name": f"{sub_name}: {tname}",
                        "difficulty": diff,
                        "subject_name": sub_name,
                        "priority_signal": priority_signal,
                    }
                    for _ in range(repetitions):
                        sub_items.append(item)
            else:
                sub_items.append({
                    "name": sub_name,
                    "difficulty": diff,
                    "subject_name": sub_name
                })

            for _ in range(weight):
                day_weighted_pool.extend(sub_items)

        if day_weighted_pool:
            # Phases 1, 2, 3 (Primary Focus Phases)
            for p in range(3):
                phase_tasks = []
                used = 0
                cap = limits[p]
                attempts = 0

                while used < cap and attempts < len(day_weighted_pool):
                    top = day_weighted_pool[pool_ptr % len(day_weighted_pool)]
                    is_dup = any(t["name"] == top["name"] for t in tasks_studied_today)

                    if not is_dup:
                        base_duration = 70 if top["difficulty"] == "Hard" else 60 if top["difficulty"] == "Medium" else 45
                        remaining = cap - used

                        duration = 0
                        if base_duration <= remaining:
                            duration = base_duration
                        elif remaining >= 20:
                            duration = remaining

                        if duration > 0:
                            task_id = f"t-{today_date_str}-p{p}-{pool_ptr}"
                            phase_tasks.append({
                                "id": task_id,
                                "name": top["name"],
                                "durationMins": duration,
                                "difficulty": top["difficulty"],
                                "originalPhase": p,
                                "subjectName": top["subject_name"],
                                "isCritical": top["difficulty"] == "Hard" and get_subject_priority(top, today_date_str) >= 7,
                            })
                            used += duration
                            day_used_mins += duration
                            tasks_studied_today.append(top)
                            pool_ptr += 1
                        else:
                            break
                    else:
                        pool_ptr += 1
                    attempts += 1

                week[d_idx]["phases"][p]["tasks"] = phase_tasks

        # Phase 4 (Revision & Recovery)
        rev_tasks = []
        rev_used = 0
        rev_cap = limits[3]

        # Prioritize hardest topics for revision
        sorted_for_rev = sorted(
            tasks_studied_today,
            key=lambda x: 3 if x["difficulty"] == "Hard" else 2 if x["difficulty"] == "Medium" else 1,
            reverse=True
        )

        for i, t in enumerate(sorted_for_rev):
            rev_duration = 30
            if rev_used + rev_duration <= rev_cap:
                rev_id = f"rev-{today_date_str}-{i}"
                rev_tasks.append({
                    "id": rev_id,
                    "name": f"Revision: {t['name']}",
                    "durationMins": rev_duration,
                    "isCritical": t["difficulty"] == "Hard",
                    "difficulty": t["difficulty"],
                    "originalPhase": 3,
                    "subjectName": t["subject_name"],
                })
                rev_used += rev_duration
                day_used_mins += rev_duration

        week[d_idx]["phases"][3]["tasks"] = rev_tasks
        week[d_idx]["usedHours"] = day_used_mins

    # PASS 2: Apply Skipped Tasks Rescheduling
    if skipped_tasks:
        for skipped in skipped_tasks:
            task_name = skipped.get("name", "")
            day_idx = skipped.get("day", 0)
            from_phase = skipped.get("fromPhase", 0)
            target_phase = skipped.get("targetPhase", min(from_phase + 1, 3))

            if 0 <= day_idx < len(week):
                from_tasks = week[day_idx]["phases"][from_phase]["tasks"]
                removed_mins = 45
                diff = "Medium"
                sub_name = ""

                # Find and remove original task
                found_idx = -1
                for idx, t in enumerate(from_tasks):
                    if t["name"] == task_name:
                        found_idx = idx
                        removed_mins = t.get("durationMins", 45)
                        diff = t.get("difficulty", "Medium")
                        sub_name = t.get("subjectName", "")
                        break

                if found_idx != -1:
                    from_tasks.pop(found_idx)
                    week[day_idx]["usedHours"] -= removed_mins

                resched_name = f"↩️ Rescheduled: {task_name}"
                # Search for capacity in target phase or subsequent days
                placed = False
                for cand_day in range(day_idx, len(week)):
                    start_p = target_phase if cand_day == day_idx else 0
                    for cand_p in range(start_p, 4):
                        phase_obj = week[cand_day]["phases"][cand_p]
                        used_in_p = sum(item.get("durationMins", 0) for item in phase_obj["tasks"])
                        if phase_obj["limit"] - used_in_p >= removed_mins:
                            cand_date = week[cand_day]["date"]
                            phase_obj["tasks"].insert(0, {
                                "id": f"s-{cand_date}-p{cand_p}-{task_name}",
                                "name": resched_name,
                                "durationMins": removed_mins,
                                "difficulty": diff,
                                "isSkipped": True,
                                "subjectName": sub_name,
                            })
                            week[cand_day]["usedHours"] += removed_mins
                            placed = True
                            break
                    if placed:
                        break

    # Calculate overall task stats
    total_tasks_count = 0
    total_mins_count = 0
    for d in week:
        for p in d["phases"]:
            for t in p["tasks"]:
                total_tasks_count += 1
                total_mins_count += t.get("durationMins", 0)

    return {
        "week": week,
        "total_tasks": total_tasks_count,
        "total_mins": total_mins_count,
    }
