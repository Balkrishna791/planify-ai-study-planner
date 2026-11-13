import { buildSchedule, getSubjectPriority } from './WeeklyPlan';

describe('buildSchedule', () => {
  test('calculates phase limits from sleep hours using 65/70/65/70 allocation', () => {
    const { week } = buildSchedule([], 8, []);
    // 24 - 8 = 16 hours; each base phase is 4 hours (240 minutes).
    expect(week[0].phases.map((phase) => phase.limit)).toEqual([160, 170, 160, 170]);
    expect(week[0].totalLimit).toBe(660);
  });

  test('does not use the old implicit eight-hour fallback for zero sleep', () => {
    const { week } = buildSchedule([], 0, []);
    expect(week[0].phases.map((phase) => phase.limit)).toEqual([230, 250, 230, 250]);
  });

  test('gives a near exam higher priority than a distant harder subject', () => {
    expect(getSubjectPriority({ difficulty: 'Easy', examDate: '2026-09-02' }, '2026-08-31'))
      .toBeGreaterThan(getSubjectPriority({ difficulty: 'Hard', examDate: '2027-12-31' }, '2026-08-31'));
  });

  test('reschedules a skipped phase-three task into revision and updates capacity', () => {
    const plan = [{
      name: 'Mathematics',
      difficulty: 'Medium',
      topics: Array.from({ length: 8 }, (_, index) => ({ name: `Topic ${index + 1}` })),
    }];
    const initial = buildSchedule(plan, 0, []);
    const phaseThreeTask = { name: 'Synthetic Phase 3 Task', durationMins: 45 };

    const updated = buildSchedule(plan, 0, [{
      name: phaseThreeTask.name,
      fromPhase: 2,
      targetPhase: 3,
      day: 0,
    }]);
    const rescheduledTasks = updated.week.flatMap((day) => day.phases.flatMap((phase) => phase.tasks))
      .filter((task) => task.name.includes('Rescheduled'));
    expect(rescheduledTasks.length).toBe(1);
    expect(updated.week[0].usedHours).toBeGreaterThanOrEqual(initial.week[0].usedHours);
  });

});
