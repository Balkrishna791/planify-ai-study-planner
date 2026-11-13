import { fireEvent, render, screen } from "@testing-library/react";
import FirstPlanGuide from "./FirstPlanGuide";

test("shows the required first-plan steps and sends the student to setup", () => {
  const onChooseStep = jest.fn();
  render(<FirstPlanGuide hasSubjects={false} hasSleepHours={false} onChooseStep={onChooseStep} onDismiss={jest.fn()} />);

  expect(screen.getByRole("heading", { name: /build your first study plan/i })).toBeInTheDocument();
  expect(screen.getByText(/optionally analyse your syllabus/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /continue setup/i }));
  expect(onChooseStep).toHaveBeenCalledWith("subjects");
});

test("offers plan generation only after subject and sleep setup are complete", () => {
  const onChooseStep = jest.fn();
  render(<FirstPlanGuide hasSubjects hasSleepHours onChooseStep={onChooseStep} onDismiss={jest.fn()} />);

  fireEvent.click(screen.getByRole("button", { name: /generate my first plan/i }));
  expect(onChooseStep).toHaveBeenCalledWith("generate");
});
