import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import FocusMode from "./FocusMode";

describe("FocusMode Component - Exact Timetable Allocation & No Breaks", () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    sessionStorage.clear();
  });

  test("1. 30-minute task starts timer at EXACTLY 00:30:00", () => {
    const task = { id: "task-30", name: "Math: Calculus", durationMins: 30, difficulty: "Medium", originalPhase: 0 };
    render(<FocusMode task={task} onComplete={jest.fn()} onExit={jest.fn()} />);
    
    expect(screen.getByText("00:30:00")).toBeInTheDocument();
    expect(screen.getByText(/30 Minutes/i)).toBeInTheDocument();
    expect(screen.queryByText(/break/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pomodoro/i)).not.toBeInTheDocument();
  });

  test("2. 45-minute task starts timer at EXACTLY 00:45:00", () => {
    const task = { id: "task-45", name: "DBMS: Normalization", durationMins: 45, difficulty: "Medium", originalPhase: 1 };
    render(<FocusMode task={task} onComplete={jest.fn()} onExit={jest.fn()} />);
    
    expect(screen.getByText("00:45:00")).toBeInTheDocument();
    expect(screen.getByText(/45 Minutes/i)).toBeInTheDocument();
  });

  test("3. 1-hour task starts timer at EXACTLY 01:00:00", () => {
    const task = { id: "task-60", name: "DSA: Arrays", durationMins: 60, difficulty: "Hard", originalPhase: 0 };
    render(<FocusMode task={task} onComplete={jest.fn()} onExit={jest.fn()} />);
    
    expect(screen.getByText("01:00:00")).toBeInTheDocument();
    expect(screen.getByText(/1 Hour/i)).toBeInTheDocument();
  });

  test("4. 1.5-hour (90 mins) task starts timer at EXACTLY 01:30:00", () => {
    const task = { id: "task-90", name: "OS: Deadlock", durationMins: 90, difficulty: "Hard", originalPhase: 2 };
    render(<FocusMode task={task} onComplete={jest.fn()} onExit={jest.fn()} />);
    
    expect(screen.getByText("01:30:00")).toBeInTheDocument();
    expect(screen.getByText(/1h 30m/i)).toBeInTheDocument();
  });

  test("5. 2-hour (120 mins) task starts timer at EXACTLY 02:00:00", () => {
    const task = { id: "task-120", name: "Algorithms: Graph Theory", durationMins: 120, difficulty: "Hard", originalPhase: 1 };
    render(<FocusMode task={task} onComplete={jest.fn()} onExit={jest.fn()} />);
    
    expect(screen.getByText("02:00:00")).toBeInTheDocument();
    expect(screen.getByText(/2 Hours/i)).toBeInTheDocument();
  });

  test("Pause and Resume freeze and continue at exact second", () => {
    const task = { id: "task-pause", name: "Physics: Optics", durationMins: 60, difficulty: "Medium" };
    render(<FocusMode task={task} onComplete={jest.fn()} onExit={jest.fn()} />);

    // Advance 5 seconds
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByText("00:59:55")).toBeInTheDocument();

    // Click Pause
    const pauseBtn = screen.getByRole("button", { name: /pause timer/i });
    fireEvent.click(pauseBtn);

    expect(screen.getByText(/Paused/i)).toBeInTheDocument();

    // Advance 10 more seconds while paused - time should remain frozen at 00:59:55
    act(() => {
      jest.advanceTimersByTime(10000);
    });
    expect(screen.getByText("00:59:55")).toBeInTheDocument();

    // Click Resume
    const resumeBtn = screen.getByRole("button", { name: /resume timer/i });
    fireEvent.click(resumeBtn);

    // Advance 2 seconds after resume
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByText("00:59:53")).toBeInTheDocument();
  });

  test("Explicit Complete Task triggers onComplete with task ID", async () => {
    const onCompleteMock = jest.fn();
    const task = { id: "task-complete-test", name: "Chemistry: Organic", durationMins: 45 };
    render(<FocusMode task={task} onComplete={onCompleteMock} onExit={jest.fn()} />);

    const completeBtn = screen.getByRole("button", { name: /mark task complete/i });
    await act(async () => {
      fireEvent.click(completeBtn);
    });

    expect(onCompleteMock).toHaveBeenCalledWith("task-complete-test");
    expect(screen.getByText("Completed ✓")).toBeInTheDocument();
  });

  test("Early Exit confirms with user and DOES NOT call onComplete", () => {
    const onCompleteMock = jest.fn();
    const onExitMock = jest.fn();
    window.confirm = jest.fn(() => true);

    const task = { id: "task-early-exit", name: "Biology: Cells", durationMins: 45 };
    render(<FocusMode task={task} onComplete={onCompleteMock} onExit={onExitMock} />);

    const exitBtn = screen.getByRole("button", { name: /exit session/i });
    fireEvent.click(exitBtn);

    expect(window.confirm).toHaveBeenCalled();
    expect(onCompleteMock).not.toHaveBeenCalled();
    expect(onExitMock).toHaveBeenCalled();
  });

  test("SessionStorage restores state on page refresh without resetting to start", () => {
    const task = { id: "task-refresh", name: "AI: Neural Networks", durationMins: 60 };

    // Simulate existing saved session with 2500 seconds remaining (~41 mins)
    sessionStorage.setItem("planify:activeFocusSession", JSON.stringify({
      taskId: "task-refresh",
      allocatedSeconds: 3600,
      remainingSeconds: 2500,
      status: "paused",
      endTimestamp: null
    }));

    render(<FocusMode task={task} onComplete={jest.fn()} onExit={jest.fn()} />);

    // 2500 seconds = 00:41:40
    expect(screen.getByText("00:41:40")).toBeInTheDocument();
    expect(screen.getByText(/Paused/i)).toBeInTheDocument();
  });

  test("does not invent a duration for a malformed task", () => {
    render(<FocusMode task={{ id: "bad-task", name: "Broken task" }} onComplete={jest.fn()} onExit={jest.fn()} />);

    expect(screen.getByText(/cannot start Focus Mode/i)).toBeInTheDocument();
    expect(screen.queryByText("00:45:00")).not.toBeInTheDocument();
  });
});
